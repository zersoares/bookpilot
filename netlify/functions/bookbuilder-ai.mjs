// Book Builder — the authoring agents.
//
//   /api/bb-ai/*
//
// Same shape as bookpilot-ai.mjs: authenticate, rate-limit, charge
// credits, run the agent, persist, return. A generation that fails after
// the charge is refunded, so an author never pays for a chapter they did
// not receive.
//
// Every handler loads the Book Bible and passes it to the model. That is
// not a convenience — it is the thing that makes this a book rather than
// twelve essays about the same subject.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit, aiHourlyLimit } from "./bookpilot-lib/ratelimit.js";
import { charge, refund } from "./bookpilot-lib/credits.js";
import { generate } from "./bookpilot-lib/ai.js";
import { capabilities } from "./bookpilot-lib/env.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import {
  loadBookData, assembleBook, bibleForPrompt, chapterLine, outlineForPrompt,
  saveChapterVersion,
} from "./bookpilot-lib/book-assembly.js";
import { layoutBook } from "../../js/doc/layout.js";
import { wordCount, blocksToText, parseManuscript } from "../../js/doc/markdown.js";
import { isDrawn } from "../../js/doc/figures.js";

const PREFIX = "/api/bb-ai";
const AI_CALLS_PER_HOUR = 60;

// ---------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------

async function billed(ctx, operation, projectId, run) {
  const { credits } = await charge(ctx.user.id, operation, {
    bookId: null,
    available: ctx.profile.ai_credits,
    profile: ctx.profile,
  });
  try {
    const result = await run();
    await audit.record(ctx.user.id, `bb.${operation}`, {
      entity: "book_project", entityId: projectId, detail: { credits },
    });
    return { result, credits };
  } catch (err) {
    const reason = err?.diagnostic ? `${operation}|${err.diagnostic}` : operation;
    await refund(ctx.user.id, credits, reason);
    throw err;
  }
}

async function loadProject(ctx, id) {
  const project = await ctx.db.selectOne("book_projects", { eq: { id: v.uuid(id, "Project") } });
  if (!project) throw Errors.notFound("book project");
  return project;
}

async function loadChapter(ctx, id) {
  const chapter = await ctx.db.selectOne("book_chapters", { eq: { id: v.uuid(id, "Chapter") } });
  if (!chapter) throw Errors.notFound("chapter");
  return chapter;
}

async function loadBible(ctx, project) {
  const bible = await ctx.db.selectOne("book_bible", { eq: { project_id: project.id } });
  return { bible, text: bibleForPrompt(bible, project) };
}

async function stage(ctx, project, name, state, extra = {}) {
  const stages = { ...(project.stages || {}), [name]: state };
  return ctx.db.update("book_projects", { stages, ...extra }, { eq: { id: project.id } });
}

const lengthLabel = (project) =>
  project.target_pages
    ? `about ${project.target_pages} pages`
    : project.target_words
      ? `about ${project.target_words} words`
      : "not specified";

// ---------------------------------------------------------------------
// 1. Positioning (spec 5)
// ---------------------------------------------------------------------

async function positioning(ctx, body) {
  const project = await loadProject(ctx, body.project_id);

  const { result, credits } = await billed(ctx, "book_positioning", project.id, () =>
    generate("book_positioning", {
      idea: project.idea,
      genre: project.genre,
      audience: project.audience,
      purpose: project.purpose,
      length: lengthLabel(project),
      writing_style: project.writing_style,
      language: project.language,
      author_name: project.author_name,
      notes: body.notes,
    })
  );

  const d = result.data;
  const row = await ctx.db.insert("book_positioning", {
    project_id: project.id,
    title_ideas: d.title_ideas || [],
    subtitle_ideas: d.subtitle_ideas || [],
    promise: d.promise,
    target_reader: d.target_reader,
    reader_problem: d.reader_problem,
    transformation: d.transformation,
    unique_angle: d.unique_angle,
    category: d.category,
    comparable_titles: d.comparable_titles || [],
    reasoning: d.reasoning,
    model: result.model,
  });

  await stage(ctx, project, "positioning", "generated", { status: "positioning" });
  return json({ positioning: row, creditsUsed: credits });
}

/**
 * Approving positioning is what turns a set of suggestions into the
 * book's identity: the chosen title and subtitle become the project's,
 * and the promise seeds the Bible.
 */
async function approvePositioning(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const row = await ctx.db.selectOne("book_positioning", {
    eq: { project_id: project.id }, order: "created_at.desc",
  });
  if (!row) throw Errors.invalid("Generate positioning first.");

  const title = v.str(body.title, "Title", { max: 300, required: true });
  const subtitle = v.str(body.subtitle, "Subtitle", { max: 300 });

  await ctx.db.update("book_positioning", { approved_at: new Date().toISOString() },
    { eq: { id: row.id } });

  const updated = await ctx.db.update("book_projects", {
    title,
    subtitle,
    audience: v.str(body.target_reader, "Reader", { max: 400 }) || row.target_reader || project.audience,
    stages: { ...(project.stages || {}), positioning: "approved" },
    status: project.status === "draft" || project.status === "positioning" ? "architecture" : project.status,
  }, { eq: { id: project.id } });

  await ctx.db.update("book_bible", {
    promise: row.promise,
    transformation: row.transformation,
    audience: row.target_reader,
  }, { eq: { project_id: project.id } });

  return json({ project: updated, positioning: { ...row, approved_at: new Date().toISOString() } });
}

// ---------------------------------------------------------------------
// 2. Architecture (spec 6, 7)
// ---------------------------------------------------------------------

async function architecture(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const positioningRow = await ctx.db.selectOne("book_positioning", {
    eq: { project_id: project.id }, order: "created_at.desc",
  });

  let templateText = "";
  if (project.template_id) {
    const template = await ctx.db.selectOne("book_templates", { eq: { id: project.template_id } });
    if (template?.structure?.parts) {
      templateText = template.structure.parts
        .map((part) => `${part.title}\n${(part.chapters || []).map((c) => `  - ${c}`).join("\n")}`)
        .join("\n\n");
    }
  }

  const { result, credits } = await billed(ctx, "book_architecture", project.id, () =>
    generate("book_architecture", {
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      idea: project.idea,
      positioning: positioningText(positioningRow),
      genre: project.genre,
      audience: project.audience,
      purpose: project.purpose,
      writing_style: project.writing_style,
      length: lengthLabel(project),
      target_words: project.target_words || 50000,
      language: project.language,
      template: templateText,
    })
  );

  const d = result.data;

  // Regenerating replaces the plan, but never silently discards written
  // work: chapters that already hold text are kept and reattached at the
  // end for the author to place or delete.
  const existing = await ctx.db.select("book_chapters", {
    select: "id,content,word_count,title", eq: { project_id: project.id }, limit: 400,
  });
  const written = existing.filter((c) => String(c.content || "").trim());
  const writtenIds = new Set(written.map((c) => c.id));
  const disposable = existing.filter((c) => !writtenIds.has(c.id)).map((c) => c.id);

  if (disposable.length) {
    await ctx.db.remove("book_chapters", { in: { id: disposable } });
  }
  await ctx.db.remove("book_parts", { eq: { project_id: project.id } });

  let order = 0;
  const chapterRows = [];

  if (d.introduction) {
    chapterRows.push({
      project_id: project.id,
      kind: "introduction",
      title: d.introduction.title || "Introduction",
      purpose: d.introduction.purpose,
      promise: d.introduction.promise,
      target_words: d.introduction.target_words || 1500,
      estimated_pages: Math.max(1, Math.round((d.introduction.target_words || 1500) / 260)),
      sort_order: order += 1,
      status: "planned",
    });
  }

  let chapterNumber = 0;
  for (const [partIndex, part] of (d.parts || []).entries()) {
    const partRow = await ctx.db.insert("book_parts", {
      project_id: project.id,
      number: partIndex + 1,
      title: part.title,
      purpose: part.purpose,
      sort_order: partIndex,
    });
    for (const chapter of part.chapters || []) {
      chapterNumber += 1;
      chapterRows.push({
        project_id: project.id,
        part_id: partRow.id,
        kind: "chapter",
        number: chapterNumber,
        title: chapter.title,
        subtitle: chapter.subtitle || null,
        purpose: chapter.purpose,
        promise: chapter.promise,
        key_concepts: chapter.key_concepts || [],
        target_words: chapter.target_words || 2000,
        estimated_pages: chapter.estimated_pages || Math.round((chapter.target_words || 2000) / 260),
        visual_opportunities: chapter.visual_opportunities || [],
        exercises: chapter.exercises || [],
        case_studies: chapter.case_studies || [],
        sort_order: order += 1,
        status: "planned",
      });
    }
  }

  if (d.conclusion) {
    chapterRows.push({
      project_id: project.id,
      kind: "conclusion",
      title: d.conclusion.title || "Conclusion",
      purpose: d.conclusion.purpose,
      target_words: d.conclusion.target_words || 1500,
      estimated_pages: Math.max(1, Math.round((d.conclusion.target_words || 1500) / 260)),
      sort_order: order += 1,
      status: "planned",
    });
  }

  for (const bonus of d.bonus || []) {
    chapterRows.push({
      project_id: project.id,
      kind: "bonus",
      front_type: bonus.front_type || "resources",
      title: bonus.title,
      purpose: bonus.purpose,
      target_words: 800,
      sort_order: order += 1,
      status: "planned",
    });
  }

  const chapters = chapterRows.length ? await ctx.db.insert("book_chapters", chapterRows) : [];

  if (written.length) {
    // Written chapters keep their text and move to the end, clearly out
    // of the new plan's numbering, rather than being deleted.
    for (const [index, chapter] of written.entries()) {
      await ctx.db.update("book_chapters", {
        sort_order: order + 1 + index,
        part_id: null,
        number: null,
        kind: "bonus",
      }, { eq: { id: chapter.id } });
    }
  }

  await stage(ctx, project, "blueprint", "generated", { status: "architecture" });

  return json({
    chapters,
    parts: await ctx.db.select("book_parts", { eq: { project_id: project.id }, order: "sort_order" }),
    reasoning: d.reasoning,
    kept: written.map((c) => ({ id: c.id, title: c.title, words: c.word_count })),
    creditsUsed: credits,
  });
}

function positioningText(row) {
  if (!row) return "(not generated)";
  return [
    `Promise: ${row.promise}`,
    `Target reader: ${row.target_reader}`,
    `Reader problem: ${row.reader_problem}`,
    `Transformation: ${row.transformation}`,
    `Unique angle: ${row.unique_angle}`,
    `Category: ${row.category}`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------
// 3. The Book Bible (spec 8)
// ---------------------------------------------------------------------

async function buildBible(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const [positioningRow, chapters] = await Promise.all([
    ctx.db.selectOne("book_positioning", { eq: { project_id: project.id }, order: "created_at.desc" }),
    ctx.db.select("book_chapters", {
      select: "number,title,purpose,kind,part_id,status,word_count",
      eq: { project_id: project.id }, order: "sort_order", limit: 400,
    }),
  ]);
  const parts = await ctx.db.select("book_parts", { eq: { project_id: project.id }, order: "sort_order" });

  const { result, credits } = await billed(ctx, "book_bible", project.id, () =>
    generate("book_bible", {
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      language: project.language,
      writing_style: project.writing_style,
      idea: project.idea,
      positioning: positioningText(positioningRow),
      architecture: outlineForPrompt(chapters, parts),
      notes: body.notes,
    })
  );

  const d = result.data;
  const current = await ctx.db.selectOne("book_bible", { eq: { project_id: project.id } });

  const bible = await ctx.db.update("book_bible", {
    audience: d.audience,
    tone: d.tone,
    writing_style: d.writing_style,
    promise: d.promise,
    transformation: d.transformation,
    voice_rules: d.voice_rules || [],
    terminology: d.terminology || [],
    key_concepts: d.key_concepts || [],
    recurring_examples: d.recurring_examples || [],
    characters: d.characters || [],
    facts: d.facts || [],
    visual_style: d.visual_style,
    image_style: d.image_style,
    // Chapter summaries are written as chapters land, so a regenerated
    // Bible must not wipe what the book already knows about itself.
    chapter_summaries: current?.chapter_summaries || [],
    notes: d.notes || current?.notes || null,
  }, { eq: { project_id: project.id } });

  await stage(ctx, project, "bible", "generated");
  return json({ bible, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// 4. Writing (spec 9)
// ---------------------------------------------------------------------

async function writeChapter(ctx, body) {
  const chapter = await loadChapter(ctx, body.chapter_id);
  const project = await loadProject(ctx, chapter.project_id);
  const { bible, text: bibleText } = await loadBible(ctx, project);

  const [siblings, sources, part] = await Promise.all([
    ctx.db.select("book_chapters", {
      select: "id,number,title,purpose,sort_order,kind,word_count",
      eq: { project_id: project.id }, order: "sort_order", limit: 400,
    }),
    ctx.db.select("book_research_sources", {
      eq: { project_id: project.id }, order: "created_at.desc", limit: 40,
    }),
    chapter.part_id
      ? ctx.db.selectOne("book_parts", { eq: { id: chapter.part_id } })
      : Promise.resolve(null),
  ]);

  const index = siblings.findIndex((c) => c.id === chapter.id);
  const previous = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  const { result, credits } = await billed(ctx, "chapter_write", project.id, () =>
    generate("chapter_write", {
      bible: bibleText,
      title: project.title,
      subtitle: project.subtitle,
      part: part ? `${part.title}${part.purpose ? ` — ${part.purpose}` : ""}` : "(no part)",
      number: chapter.number || "",
      chapter_title: chapter.title,
      previous: chapterLine(previous),
      next: chapterLine(next),
      purpose: chapter.purpose,
      promise: chapter.promise,
      key_concepts: (chapter.key_concepts || []).join("; "),
      target_words: chapter.target_words || 2000,
      exercises: describeList(chapter.exercises, (e) => `${e.title}: ${e.purpose}`),
      case_studies: describeList(chapter.case_studies, (c) => `${c.title} — needs: ${c.what_is_needed}`),
      visuals: describeList(chapter.visual_opportunities, (vis) => `${vis.kind}: ${vis.title} (${vis.purpose})`),
      sources: describeList(sources, (s) =>
        `${s.title}${s.author_org ? `, ${s.author_org}` : ""}${s.url ? ` (${s.url})` : ""} [${s.kind}, ${s.verification}]`),
      notes: body.notes,
    })
  );

  const content = String(result.data.content || "").trim();
  if (!content) throw Errors.aiUnavailable();

  // The previous draft is never simply replaced.
  if (String(chapter.content || "").trim()) {
    await saveChapterVersion(ctx, project.id, chapter.id, chapter,
      "Before the AI rewrote it", "generate", result.model);
  }

  const updated = await ctx.db.update("book_chapters", {
    content,
    status: "draft",
  }, { eq: { id: chapter.id } });

  // The Bible learns what this chapter established, so the next chapter
  // is written knowing it.
  if (result.data.summary) {
    const summaries = [...(bible?.chapter_summaries || [])]
      .filter((s) => s.id !== chapter.id);
    summaries.push({
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      summary: String(result.data.summary).slice(0, 900),
    });
    summaries.sort((a, b) => (a.number || 0) - (b.number || 0));
    await ctx.db.update("book_bible", { chapter_summaries: summaries.slice(0, 80) },
      { eq: { project_id: project.id } });
  }

  if (project.status === "architecture" || project.status === "positioning") {
    await stage(ctx, project, "writing", "in_progress", { status: "writing" });
  }

  return json({
    chapter: updated,
    placeholders: result.data.placeholders || [],
    notes_for_author: result.data.notes_for_author || null,
    creditsUsed: credits,
  });
}

function describeList(items, format) {
  if (!Array.isArray(items) || !items.length) return "(none)";
  return items.slice(0, 12).map((item) => `- ${format(item)}`).join("\n");
}

/**
 * Revise a passage.
 *
 * The result is returned, not saved. Every AI action in the product
 * offers Generate → Preview → Approve (spec 40), and a rewrite that
 * silently replaced the author's paragraph would break that rule in the
 * place it matters most.
 */
async function reviseChapter(ctx, body) {
  const chapter = await loadChapter(ctx, body.chapter_id);
  const project = await loadProject(ctx, chapter.project_id);
  const { text: bibleText } = await loadBible(ctx, project);

  const instruction = v.str(body.instruction, "Instruction", { max: 2000, required: true });
  const passage = v.str(body.passage, "Passage", { max: 60000 }) || chapter.content || "";
  if (!passage.trim()) throw Errors.invalid("There is nothing to revise yet.");

  const siblings = await ctx.db.select("book_chapters", {
    select: "id,number,title,purpose,sort_order",
    eq: { project_id: project.id }, order: "sort_order", limit: 400,
  });
  const index = siblings.findIndex((c) => c.id === chapter.id);

  const { result, credits } = await billed(ctx, "chapter_revise", project.id, () =>
    generate("chapter_revise", {
      instruction,
      bible: bibleText,
      title: project.title,
      number: chapter.number || "",
      chapter_title: chapter.title,
      purpose: chapter.purpose,
      neighbours: `${chapterLine(siblings[index - 1])} / ${chapterLine(siblings[index + 1])}`,
      passage,
    })
  );

  return json({
    content: result.data.content,
    what_changed: result.data.what_changed,
    notes_for_author: result.data.notes_for_author || null,
    is_selection: Boolean(body.passage),
    creditsUsed: credits,
  });
}

async function continueChapter(ctx, body) {
  const chapter = await loadChapter(ctx, body.chapter_id);
  const project = await loadProject(ctx, chapter.project_id);
  const { text: bibleText } = await loadBible(ctx, project);

  const existing = String(chapter.content || "").trim();
  if (!existing) throw Errors.invalid("Write the opening of this chapter first.");

  const siblings = await ctx.db.select("book_chapters", {
    select: "id,number,title,purpose,sort_order",
    eq: { project_id: project.id }, order: "sort_order", limit: 400,
  });
  const index = siblings.findIndex((c) => c.id === chapter.id);
  const written = wordCount(existing);

  const { result, credits } = await billed(ctx, "chapter_revise", project.id, () =>
    generate("chapter_continue", {
      bible: bibleText,
      number: chapter.number || "",
      chapter_title: chapter.title,
      purpose: chapter.purpose,
      promise: chapter.promise,
      remaining: (chapter.key_concepts || []).join("; ") || "(the architecture lists no remaining concepts)",
      written_words: written,
      target_words: chapter.target_words || 2000,
      next: chapterLine(siblings[index + 1]),
      // The tail rather than the whole chapter: continuing needs the
      // voice and the argument's current position, not every word.
      tail: existing.slice(-4000),
    })
  );

  return json({
    content: result.data.content,
    appendTo: chapter.id,
    creditsUsed: credits,
  });
}

// ---------------------------------------------------------------------
// 5. Front and back matter (spec 20, 21)
// ---------------------------------------------------------------------

async function matter(ctx, body, which) {
  const project = await loadProject(ctx, body.project_id);
  const requested = v.stringArray(body.sections, "Sections", { maxItems: 8 }) || [];
  const positioningRow = await ctx.db.selectOne("book_positioning", {
    eq: { project_id: project.id }, order: "created_at.desc",
  });

  const isFront = which === "front";
  const operation = isFront ? "front_matter" : "back_matter";
  const promptKey = isFront ? "book_front_matter" : "book_back_matter";
  const bible = await ctx.db.selectOne("book_bible", { eq: { project_id: project.id } });

  const { result, credits } = await billed(ctx, operation, project.id, () =>
    generate(promptKey, {
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      publisher: project.metadata?.publisher || "",
      year: new Date().getFullYear(),
      language: project.language,
      genre: project.genre,
      subjects: [project.genre, project.audience].filter(Boolean).join("; "),
      positioning: positioningText(positioningRow),
      author_bio: body.author_bio || "",
      cta_target: body.cta_target || "",
      terminology: (bible?.terminology || [])
        .slice(0, 20).map((t) => `${t.term}: ${t.definition}`).join("\n"),
      sections: requested.length ? requested.join(", ") : "(choose what this book needs)",
    })
  );

  const existing = await ctx.db.select("book_chapters", {
    select: "id,front_type,sort_order", eq: { project_id: project.id }, limit: 400,
  });
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.sort_order || 0), 0);

  const rows = [];
  for (const [index, section] of (result.data.sections || []).entries()) {
    const previous = existing.find((c) => c.front_type === section.front_type);
    if (previous) {
      await ctx.db.update("book_chapters", {
        title: section.title,
        content: section.content,
      }, { eq: { id: previous.id } });
      continue;
    }
    rows.push({
      project_id: project.id,
      kind: isFront ? "front" : "back",
      front_type: section.front_type,
      title: section.title,
      content: section.content,
      status: "draft",
      // Front matter sorts before everything; back matter after.
      sort_order: isFront ? -100 + index : maxOrder + 10 + index,
    });
  }

  const created = rows.length ? await ctx.db.insert("book_chapters", rows) : [];
  const sections = await ctx.db.select("book_chapters", {
    select: "id,kind,front_type,title,word_count,sort_order",
    eq: { project_id: project.id }, order: "sort_order", limit: 400,
  });

  return json({
    created: created.length,
    sections,
    replaceable: (result.data.sections || [])
      .filter((s) => s.author_must_replace)
      .map((s) => s.front_type),
    creditsUsed: credits,
  });
}

// ---------------------------------------------------------------------
// 6. Editorial review (spec 11)
// ---------------------------------------------------------------------

async function review(ctx, body) {
  const chapter = await loadChapter(ctx, body.chapter_id);
  const project = await loadProject(ctx, chapter.project_id);
  const { bible, text: bibleText } = await loadBible(ctx, project);

  const content = String(chapter.content || "").trim();
  if (!content) throw Errors.invalid("There is nothing to review in this chapter yet.");

  const siblings = await ctx.db.select("book_chapters", {
    select: "id,number,title,purpose,sort_order", eq: { project_id: project.id },
    order: "sort_order", limit: 400,
  });
  const index = siblings.findIndex((c) => c.id === chapter.id);

  const { result, credits } = await billed(ctx, "editorial_review", project.id, () =>
    generate("editorial_review", {
      bible: bibleText,
      number: chapter.number || "",
      chapter_title: chapter.title,
      purpose: chapter.purpose,
      promise: chapter.promise,
      previous: chapterLine(siblings[index - 1]),
      next: chapterLine(siblings[index + 1]),
      established: (bible?.chapter_summaries || [])
        .filter((s) => (s.number || 0) < (chapter.number || 999))
        .slice(-8)
        .map((s) => `${s.title}: ${s.summary}`)
        .join("\n") || "(this is the first chapter)",
      content,
    })
  );

  const d = result.data;
  const quality = {
    scores: d.scores,
    verdict: d.verdict,
    recommendations: d.recommendations || [],
    consistency_notes: d.consistency_notes || [],
    claims_to_check: d.claims_to_check || [],
    repetition: d.repetition || [],
    reviewed_at: new Date().toISOString(),
    model: result.model,
  };

  // The chapter carries its latest verdict; the report table keeps the
  // history. Written with the service role because a client that could
  // write its own scores could award itself a 98.
  await dbAsService().update("book_chapters", { quality, status: "reviewed" },
    { eq: { id: chapter.id } });
  await dbAsService().insert("book_quality_reports", {
    project_id: project.id,
    scope: "chapter",
    chapter_id: chapter.id,
    readiness: Math.round(
      (Object.values(d.scores || {}).reduce((a, b) => a + b, 0) || 0) /
      Math.max(1, Object.keys(d.scores || {}).length)
    ),
    scores: d.scores || {},
    issues: d.recommendations || [],
    summary: d.verdict,
    model: result.model,
  }, { returning: false });

  return json({ quality, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// 7. Research (spec 12)
// ---------------------------------------------------------------------

async function research(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const chapter = body.chapter_id ? await loadChapter(ctx, body.chapter_id) : null;
  const topic = v.str(body.topic, "Topic", { max: 4000, required: true });

  const existing = await ctx.db.select("book_research_sources", {
    select: "title,author_org,url,kind,verification",
    eq: { project_id: project.id }, limit: 40,
  });

  const { result, credits } = await billed(ctx, "research_brief", project.id, () =>
    generate("research_brief", {
      title: project.title,
      chapter_title: chapter?.title || "(whole book)",
      purpose: chapter?.purpose || "",
      topic,
      content: chapter?.content ? String(chapter.content).slice(0, 12000) : "",
      existing_sources: describeList(existing, (s) =>
        `${s.title}${s.author_org ? `, ${s.author_org}` : ""} [${s.kind}, ${s.verification}]`),
    })
  );

  const d = result.data;

  // Every claim the agent could not source becomes a row the author has
  // to resolve. Nothing is marked verified by the software.
  const rows = [];
  for (const where of d.where_to_look || []) {
    rows.push({
      project_id: project.id,
      chapter_id: chapter?.id || null,
      title: where.certain_document || `${where.source_type.replace(/_/g, " ")} — ${where.publisher_or_body}`,
      author_org: where.publisher_or_body,
      claim: where.for_claim,
      summary: `Search terms: ${where.search_terms}`,
      kind: "fact",
      verification: "unverified",
      notes: where.certain_document
        ? "Named by the research agent. Confirm it exists and says what the chapter claims."
        : "No specific document named. Find one before the claim goes to print.",
    });
  }
  const created = rows.length ? await ctx.db.insert("book_research_sources", rows) : [];

  return json({
    claims: d.claims || [],
    open_questions: d.open_questions || [],
    sources: created,
    creditsUsed: credits,
  });
}

// ---------------------------------------------------------------------
// 8. Visual direction (spec 13)
// ---------------------------------------------------------------------

async function visualDirection(ctx, body) {
  const chapter = await loadChapter(ctx, body.chapter_id);
  const project = await loadProject(ctx, chapter.project_id);
  const { text: bibleText } = await loadBible(ctx, project);

  const content = String(chapter.content || "").trim();
  if (!content) throw Errors.invalid("Write the chapter before choosing its figures.");

  const { result, credits } = await billed(ctx, "visual_direction", project.id, () =>
    generate("visual_direction", {
      bible: bibleText,
      number: chapter.number || "",
      chapter_title: chapter.title,
      purpose: chapter.purpose,
      planned: describeList(chapter.visual_opportunities, (vis) => `${vis.kind}: ${vis.title}`),
      content: content.slice(0, 20000),
    })
  );

  await ctx.db.remove("book_visuals", { eq: { chapter_id: chapter.id, status: "suggested" } });

  const rows = (result.data.visuals || []).map((visual, index) => ({
    project_id: project.id,
    chapter_id: chapter.id,
    kind: visual.kind,
    title: visual.title,
    purpose: visual.purpose,
    placement: visual.placement,
    brief: visual.brief || null,
    prompt: visual.prompt || null,
    alt_text: visual.alt_text,
    caption: visual.caption || null,
    data: visual.data || {},
    // A drawn figure is ready the moment it is approved; an imaged one
    // still needs a renderer, and the status says so.
    status: "suggested",
    sort_order: index,
  }));

  const visuals = rows.length ? await ctx.db.insert("book_visuals", rows) : [];

  return json({
    visuals: visuals.map((visual) => ({ ...visual, drawn: isDrawn(visual.kind) })),
    reasoning: result.data.reasoning,
    imageProviderConfigured: capabilities().imageGeneration,
    creditsUsed: credits,
  });
}

/**
 * Turn an approved imaged figure into a prompt.
 *
 * This is the point where the product has to be honest: there is no
 * image provider configured, so what comes back is art direction and a
 * prompt, recorded against the figure, with a row in book_images whose
 * status is 'unavailable'. Nothing pretends a picture was made.
 */
async function imagePrompt(ctx, body) {
  const visual = await ctx.db.selectOne("book_visuals", { eq: { id: v.uuid(body.visual_id, "Visual") } });
  if (!visual) throw Errors.notFound("figure");
  const project = await loadProject(ctx, visual.project_id);
  const bible = await ctx.db.selectOne("book_bible", { eq: { project_id: project.id } });
  const chapter = visual.chapter_id ? await loadChapter(ctx, visual.chapter_id) : null;

  const style = v.str(body.style, "Style", { max: 60 }) || "editorial";
  const aspect = v.oneOf(body.aspect_ratio, "Aspect ratio",
    ["1:1", "3:2", "2:3", "4:3", "16:9"]) || "3:2";

  const { result, credits } = await billed(ctx, "book_image", project.id, () =>
    generate("image_direction", {
      title: project.title,
      visual_title: visual.title,
      kind: visual.kind,
      purpose: visual.purpose,
      image_style: bible?.image_style || "",
      style,
      aspect_ratio: aspect,
      brand_colors: (bible?.brand_colors || []).join(", "),
      context: chapter?.content ? String(chapter.content).slice(0, 3000) : "",
    })
  );

  const d = result.data;
  const image = await ctx.db.insert("book_images", {
    project_id: project.id,
    visual_id: visual.id,
    chapter_id: visual.chapter_id,
    prompt: d.prompt,
    style,
    aspect_ratio: aspect,
    status: capabilities().imageGeneration ? "pending" : "unavailable",
    metadata: { negative_prompt: d.negative_prompt, notes: d.notes || null },
  });

  const updated = await ctx.db.update("book_visuals", {
    prompt: d.prompt,
    alt_text: d.alt_text || visual.alt_text,
    caption: d.caption || visual.caption,
  }, { eq: { id: visual.id } });

  return json({
    visual: updated,
    image,
    imageProviderConfigured: capabilities().imageGeneration,
    creditsUsed: credits,
  });
}

// ---------------------------------------------------------------------
// 9. Covers (spec 18, 19)
// ---------------------------------------------------------------------

async function coverConcepts(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const count = v.int(body.count ?? 6, "Count", { min: 2, max: 8 });
  const [positioningRow, bible] = await Promise.all([
    ctx.db.selectOne("book_positioning", { eq: { project_id: project.id }, order: "created_at.desc" }),
    ctx.db.selectOne("book_bible", { eq: { project_id: project.id } }),
  ]);

  const { result, credits } = await billed(ctx, "cover_concepts", project.id, () =>
    generate("cover_concepts", {
      count,
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      genre: project.genre,
      audience: project.audience,
      promise: positioningRow?.promise || bible?.promise || "",
      positioning: positioningText(positioningRow),
      brand_colors: (bible?.brand_colors || []).join(", "),
      trim_size: project.trim_size,
    })
  );

  const rows = (result.data.concepts || []).slice(0, 8).map((concept) => ({
    project_id: project.id,
    concept_name: concept.name,
    rationale: concept.rationale,
    genre_signals: concept.genre_signals || [],
    palette: concept.palette || [],
    layout: { ...concept.layout, approach: concept.approach },
    title_text: project.title,
    subtitle_text: project.subtitle,
    author_text: project.author_name,
    spine_text: concept.spine_text || `${project.title} · ${project.author_name || ""}`.trim(),
    back_blurb: concept.back_blurb,
  }));
  if (!rows.length) throw Errors.aiUnavailable();

  const covers = await ctx.db.insert("book_covers", rows);

  // The artwork brief for image-led concepts is recorded so it is not
  // lost, with the same honest status as any other unrendered image.
  for (const [index, concept] of (result.data.concepts || []).entries()) {
    if (!concept.artwork_prompt || !covers[index]) continue;
    await ctx.db.insert("book_images", {
      project_id: project.id,
      prompt: concept.artwork_prompt,
      style: concept.approach,
      aspect_ratio: "2:3",
      status: capabilities().imageGeneration ? "pending" : "unavailable",
      metadata: { for: "cover", cover_id: covers[index].id, brief: concept.artwork_brief },
    }, { returning: false });
  }

  await stage(ctx, project, "cover", "generated", { status: "designing" });

  return json({
    covers,
    imageProviderConfigured: capabilities().imageGeneration,
    creditsUsed: credits,
  });
}

async function coverCheck(ctx, body) {
  const cover = await ctx.db.selectOne("book_covers", { eq: { id: v.uuid(body.cover_id, "Cover") } });
  if (!cover) throw Errors.notFound("cover");
  const project = await loadProject(ctx, cover.project_id);

  const { result, credits } = await billed(ctx, "cover_check", project.id, () =>
    generate("cover_check", {
      title: cover.title_text || project.title,
      title_length: (cover.title_text || project.title || "").length,
      subtitle: cover.subtitle_text,
      author_name: cover.author_text,
      genre: project.genre,
      concept: `${cover.concept_name}: ${cover.rationale}`,
      palette: JSON.stringify(cover.palette),
      layout: JSON.stringify(cover.layout),
      trim_size: project.trim_size,
    })
  );

  const report = { ...result.data, checked_at: new Date().toISOString(), model: result.model };
  await dbAsService().update("book_covers", { check_report: report }, { eq: { id: cover.id } });

  return json({ report, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// 10. The publication check (spec 22)
// ---------------------------------------------------------------------

/**
 * What the layout engine can prove.
 *
 * These findings are measured, not judged: the book really is 212 pages,
 * chapter 7 really is empty, there really are four unresolved author
 * placeholders. They go to the model as facts so it spends its judgement
 * on the things that need judgement.
 */
function mechanicalFindings(data, laid) {
  const findings = [];
  const { project, chapters } = data;

  const body = chapters.filter((c) => c.include !== false && c.kind !== "front" && c.kind !== "back");
  const empty = body.filter((c) => !String(c.content || "").trim());
  const thin = body.filter((c) => {
    const target = c.target_words || 0;
    return target > 0 && c.word_count > 0 && c.word_count < target * 0.55;
  });

  const placeholders = [];
  for (const chapter of chapters) {
    const matches = String(chapter.content || "").match(/\[author:[^\]]*\]/gi) || [];
    if (matches.length) placeholders.push(`${chapter.title}: ${matches.length}`);
  }

  const fronts = new Set(chapters.filter((c) => c.kind === "front").map((c) => c.front_type));
  const missingFront = ["title_page", "copyright"].filter((t) => !fronts.has(t));

  const unrendered = (data.visuals || []).filter(
    (visual) => !isDrawn(visual.kind) && visual.status !== "skipped"
  );

  const totalWords = body.reduce((sum, c) => sum + (c.word_count || 0), 0);

  findings.push(`Pages when set at ${project.trim_size}: ${laid.pages.length} (${laid.frontCount} of front matter)`);
  findings.push(`Words in the body: ${totalWords}${project.target_words ? ` against a target of ${project.target_words}` : ""}`);
  findings.push(`Sections: ${chapters.length}; body chapters: ${body.length}`);
  if (empty.length) findings.push(`Empty sections: ${empty.map((c) => c.title).join("; ")}`);
  if (thin.length) {
    findings.push(`Well under their word budget: ${thin.map((c) => `${c.title} (${c.word_count}/${c.target_words})`).join("; ")}`);
  }
  if (placeholders.length) findings.push(`Unresolved [author: ...] placeholders: ${placeholders.join("; ")}`);
  if (missingFront.length) findings.push(`Front matter missing: ${missingFront.join(", ")}`);
  if (!chapters.some((c) => c.kind === "back" || c.front_type === "about_author")) {
    findings.push("No back matter: there is no about-the-author page.");
  }
  if (unrendered.length) {
    findings.push(`Figures that need an image renderer and have none: ${unrendered.length}`);
  }
  if (!data.cover) findings.push("No cover has been selected.");

  // The layout engine guarantees these, so saying so stops the model
  // inventing design faults it cannot see.
  findings.push(
    "Layout guarantees already verified by the engine: no text overflows the measure, " +
    "no text overlaps a figure, no widows or orphans, no heading left at the foot of a page."
  );

  return {
    text: findings.join("\n"),
    counts: {
      pages: laid.pages.length,
      words: totalWords,
      chapters: body.length,
      empty: empty.length,
      thin: thin.length,
      placeholders: placeholders.length,
      missingFront: missingFront.length,
      unrenderedFigures: unrendered.length,
      hasCover: Boolean(data.cover),
    },
  };
}

async function qualityReport(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const data = await loadBookData(ctx.db, project.id);
  if (!data.chapters.length) throw Errors.invalid("There is no book to check yet.");

  const assembled = assembleBook(data, { includeEmpty: false });
  const laid = layoutBook(assembled, { print: false });
  const mechanical = mechanicalFindings(data, laid);

  const samples = data.chapters
    .filter((c) => String(c.content || "").trim())
    .slice(0, 24)
    .map((chapter) => {
      const text = blocksToText(parseManuscript(chapter.content));
      return `--- ${chapter.number ? `${chapter.number}. ` : ""}${chapter.title}\nOPENS: ${text.slice(0, 340)}\nCLOSES: ${text.slice(-260)}`;
    })
    .join("\n\n");

  const { result, credits } = await billed(ctx, "quality_report", project.id, () =>
    generate("book_quality", {
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      language: project.language,
      target_pages: project.target_pages || "not set",
      bible: bibleForPrompt(data.bible, project),
      structure: outlineForPrompt(data.chapters, data.parts),
      samples,
      matter: data.chapters
        .filter((c) => c.kind === "front" || c.kind === "back")
        .map((c) => `${c.front_type || c.kind}: ${c.title}`)
        .join("; ") || "(none)",
      visuals: (data.visuals || [])
        .map((vis) => `${vis.kind}: ${vis.title} [${vis.status}]`)
        .join("; ") || "(none)",
      mechanical: mechanical.text,
    })
  );

  const d = result.data;
  const report = await dbAsService().insert("book_quality_reports", {
    project_id: project.id,
    scope: "book",
    readiness: d.readiness,
    scores: d.scores || {},
    issues: d.issues || [],
    summary: d.summary,
    model: result.model,
  });

  return json({
    report,
    measured: mechanical.counts,
    pageCount: laid.pages.length,
    creditsUsed: credits,
  });
}

// ---------------------------------------------------------------------
// 11. Marketing and repurposing (spec 25, 26)
// ---------------------------------------------------------------------

const MARKETING_SCOPES = {
  social: "30 Instagram posts, 20 Facebook posts, 10 LinkedIn posts, 20 Pinterest ideas",
  video: "5 TikTok or Reels scripts, 3 YouTube Shorts, 3 long-form YouTube scripts, one book trailer script",
  email: "a launch announcement, a five-email sequence, a follow-up for people who looked but did not buy, a reader follow-up",
  sales: "the book description, a landing page, a sales page, an author bio, an FAQ and calls to action",
  advertising: "headline variations, ad copy, image concepts and video ad scripts",
};

async function marketing(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const scope = v.oneOf(body.scope, "Scope", Object.keys(MARKETING_SCOPES), { required: true });

  const data = await loadBookData(ctx.db, project.id);
  const written = data.chapters.filter((c) => String(c.content || "").trim());
  if (!written.length) throw Errors.invalid("Write some of the book before building its campaign.");

  const positioningRow = await ctx.db.selectOne("book_positioning", {
    eq: { project_id: project.id }, order: "created_at.desc",
  });

  // Excerpts rather than the manuscript: the opening of each chapter is
  // where its argument is stated, which is what a post needs.
  const excerpts = written.slice(0, 20).map((chapter) => {
    const text = blocksToText(parseManuscript(chapter.content));
    return `[${chapter.number ? `Chapter ${chapter.number}` : chapter.title}] ${text.slice(0, 700)}`;
  }).join("\n\n");

  const { result, credits } = await billed(ctx, "marketing_campaign", project.id, () =>
    generate("book_marketing", {
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      audience: project.audience,
      promise: positioningRow?.promise || data.bible?.promise || "",
      positioning: positioningText(positioningRow),
      sales_url: body.sales_url || "",
      language: project.language,
      outline: outlineForPrompt(data.chapters, data.parts),
      excerpts,
      scope: MARKETING_SCOPES[scope],
    })
  );

  const rows = (result.data.assets || []).map((asset, index) => ({
    project_id: project.id,
    user_id: ctx.user.id,
    channel: asset.channel,
    kind: asset.kind,
    title: asset.title,
    content: asset.content,
    body: {
      hook: asset.hook || null,
      from_chapter: asset.from_chapter || null,
      visual_idea: asset.visual_idea || null,
      hashtags: asset.hashtags || [],
    },
    sort_order: index,
  }));

  const assets = rows.length ? await ctx.db.insert("book_marketing_assets", rows) : [];
  return json({ assets, scope, creditsUsed: credits });
}

const REPURPOSE_FORMATS = {
  mini_ebook: "a short ebook that stands on its own",
  lead_magnet: "a lead magnet that solves one problem completely",
  workbook: "a workbook, mostly prompts and space to write",
  checklist: "a checklist someone can work through in one sitting",
  course_outline: "a course outline sequenced by what a learner can do",
  presentation: "a presentation, one idea per slide",
  newsletter_series: "a newsletter series",
  blog_series: "a blog series",
  social_series: "a series of social posts that build on each other",
};

async function repurpose(ctx, body) {
  const project = await loadProject(ctx, body.project_id);
  const format = v.oneOf(body.format, "Format", Object.keys(REPURPOSE_FORMATS), { required: true });
  const data = await loadBookData(ctx.db, project.id);
  const written = data.chapters.filter((c) => String(c.content || "").trim());
  if (!written.length) throw Errors.invalid("Write some of the book first.");

  const material = written.slice(0, 16).map((chapter) => {
    const text = blocksToText(parseManuscript(chapter.content));
    return `[${chapter.title}] ${text.slice(0, 900)}`;
  }).join("\n\n");

  const { result, credits } = await billed(ctx, "repurpose_book", project.id, () =>
    generate("book_repurpose", {
      format: REPURPOSE_FORMATS[format],
      title: project.title,
      subtitle: project.subtitle,
      author_name: project.author_name,
      audience: project.audience,
      promise: data.bible?.promise || "",
      outline: outlineForPrompt(data.chapters, data.parts),
      material,
      language: project.language,
    })
  );

  const d = result.data;
  const asset = await ctx.db.insert("book_marketing_assets", {
    project_id: project.id,
    user_id: ctx.user.id,
    channel: "repurpose",
    kind: format,
    title: d.title,
    content: (d.sections || [])
      .map((section) => `## ${section.title}\n\n${section.content}`)
      .join("\n\n"),
    body: { description: d.description, sections: d.sections || [] },
    sort_order: 0,
  });

  return json({ asset, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

const ROUTES = {
  positioning,
  "approve-positioning": approvePositioning,
  architecture,
  bible: buildBible,
  chapter: writeChapter,
  revise: reviseChapter,
  continue: continueChapter,
  "front-matter": (ctx, body) => matter(ctx, body, "front"),
  "back-matter": (ctx, body) => matter(ctx, body, "back"),
  review,
  research,
  visuals: visualDirection,
  "image-prompt": imagePrompt,
  covers: coverConcepts,
  "cover-check": coverCheck,
  quality: qualityReport,
  marketing,
  repurpose,
};

export default withGuards(async (req) => {
  if (req.method !== "POST") throw Errors.notFound("endpoint");

  const [operation] = pathSegments(req, PREFIX);
  const handler = ROUTES[operation];
  if (!handler) throw Errors.notFound("endpoint");

  const ctx = await authenticate(req);
  memoryLimit(`bb-ai:${ctx.user.id}`, 20, 60_000);
  await aiHourlyLimit(dbAsService(), ctx.user.id, AI_CALLS_PER_HOUR);

  const body = await readJson(req);
  return handler(ctx, body);
});

export const config = { path: "/api/bb-ai/*" };
