// Book Builder — project API.
//
//   /api/bb/*
//
// Same posture as bookpilot-api.mjs: every route authenticates, and the
// database client it gets back is signed with the caller's own JWT, so
// the RLS policies in sql/007_book_builder_rls.sql are the access
// boundary. A mistake in a filter here cannot return another author's
// manuscript.
//
// The one thing this file guards on its own is the plan's project
// allowance, which is an application rule rather than an access rule.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import { planFor } from "./bookpilot-lib/credits.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { saveChapterVersion } from "./bookpilot-lib/book-assembly.js";
import { themeList, TRIM_SIZES } from "../../js/doc/themes.js";
import { coverTemplateById, coverFromTemplate } from "../../js/core/cover-templates.js";
import { env } from "./bookpilot-lib/env.js";


const PREFIX = "/api/bb";

const PURPOSES = ["sell", "authority", "educate", "lead_generation", "personal", "business"];
const STYLES = [
  "professional", "conversational", "inspirational", "academic",
  "business", "practical", "mentor", "storytelling", "luxury_editorial",
];
const STATUSES = [
  "draft", "positioning", "architecture", "writing",
  "editing", "designing", "ready", "published", "archived",
];
const CHAPTER_KINDS = ["front", "introduction", "chapter", "conclusion", "back", "bonus"];
const CHAPTER_STATUSES = ["planned", "drafting", "draft", "reviewed", "approved", "final"];
const FRONT_TYPES = [
  "half_title", "title_page", "copyright", "disclaimer", "dedication", "epigraph",
  "toc", "foreword", "preface", "about_author", "resources", "references",
  "glossary", "notes", "workbook", "cta",
];
const VISUAL_KINDS = [
  "illustration", "diagram", "infographic", "timeline", "process", "comparison",
  "table", "checklist", "quote_card", "chapter_opener", "concept", "case_study",
];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function loadProject(ctx, id) {
  const project = await ctx.db.selectOne("book_projects", { eq: { id: v.uuid(id, "Project") } });
  if (!project) throw Errors.notFound("book project");
  return project;
}

/**
 * The plan's project allowance.
 *
 * Reuses the plan's book_limit rather than introducing a second number:
 * an author on the Free plan gets one book, and it should not matter
 * whether they came in through the marketing side or the writing side.
 */
async function assertCanAddProject(ctx) {
  const plan = await planFor(ctx.profile);
  if (!plan || plan.book_limit === null) return;
  const existing = await ctx.db.select("book_projects", {
    select: "id",
    eq: { user_id: ctx.user.id },
    filters: { status: "neq.archived" },
    limit: plan.book_limit + 1,
  });
  if (existing.length >= plan.book_limit) {
    throw Errors.planLimit(
      `Your ${plan.name} plan includes ${plan.book_limit} ${plan.book_limit === 1 ? "book" : "books"}. ` +
      "Upgrade to start another."
    );
  }
}

/** Mark a stage of the project done, without clobbering the others. */
async function setStage(ctx, project, stage, state, extra = {}) {
  const stages = { ...(project.stages || {}), [stage]: state };
  return ctx.db.update("book_projects", { stages, ...extra }, { eq: { id: project.id } });
}

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------

async function listProjects(ctx) {
  const projects = await ctx.db.select("book_projects", {
    select: "*",
    eq: { user_id: ctx.user.id },
    order: "updated_at.desc",
    limit: 200,
  });

  // Progress is derived from the chapters, not stored: a stored figure
  // drifts the moment a chapter is added or deleted.
  const ids = projects.map((p) => p.id);
  const chapters = ids.length
    ? await ctx.db.select("book_chapters", {
        select: "project_id,status,word_count,target_words,kind,include",
        in: { project_id: ids },
        limit: 4000,
      })
    : [];

  const byProject = new Map();
  for (const chapter of chapters) {
    if (!byProject.has(chapter.project_id)) byProject.set(chapter.project_id, []);
    byProject.get(chapter.project_id).push(chapter);
  }

  // The chosen cover, so the library shows the book the author designed
  // rather than a generic tile. Only the fields the preview draws.
  const covers = ids.length
    ? await ctx.db.select("book_covers", {
        select: "project_id,palette,layout,title_text,subtitle_text,author_text,image_url",
        in: { project_id: ids },
        filters: { is_selected: "eq.true" },
        limit: 200,
      })
    : [];
  const coverByProject = new Map(covers.map((cover) => [cover.project_id, cover]));

  return json({
    projects: projects.map((project) => ({
      ...project,
      progress: progressOf(project, byProject.get(project.id) || []),
      cover: coverByProject.get(project.id) || null,
    })),
  });
}

/**
 * Duplicate a project.
 *
 * Copies the plan, the manuscript and the Bible; deliberately does not
 * copy the version history, the quality reports or the export record.
 * Those describe what happened to the original book, and carrying them
 * over would make the copy's history a fiction.
 */
async function duplicateProject(ctx, id) {
  await assertCanAddProject(ctx);
  const source = await loadProject(ctx, id);

  const [parts, chapters, bible, visuals] = await Promise.all([
    ctx.db.select("book_parts", { eq: { project_id: id }, order: "sort_order", limit: 50 }),
    ctx.db.select("book_chapters", { eq: { project_id: id }, order: "sort_order", limit: 400 }),
    ctx.db.selectOne("book_bible", { eq: { project_id: id } }),
    ctx.db.select("book_visuals", { eq: { project_id: id }, order: "sort_order", limit: 400 }),
  ]);

  const copy = await ctx.db.insert("book_projects", {
    user_id: ctx.user.id,
    idea: source.idea,
    title: `${source.title} (copy)`.slice(0, 300),
    subtitle: source.subtitle,
    author_name: source.author_name,
    genre: source.genre,
    audience: source.audience,
    language: source.language,
    purpose: source.purpose,
    writing_style: source.writing_style,
    tone: source.tone,
    target_pages: source.target_pages,
    target_words: source.target_words,
    status: "draft",
    stages: source.stages,
    theme_id: source.theme_id,
    template_id: source.template_id,
    brand_kit_id: source.brand_kit_id,
    trim_size: source.trim_size,
    design: source.design,
    metadata: source.metadata,
  });

  const partMap = new Map();
  for (const part of parts) {
    const created = await ctx.db.insert("book_parts", {
      project_id: copy.id,
      number: part.number,
      title: part.title,
      purpose: part.purpose,
      sort_order: part.sort_order,
    });
    partMap.set(part.id, created.id);
  }

  const chapterMap = new Map();
  if (chapters.length) {
    for (const chapter of chapters) {
      const created = await ctx.db.insert("book_chapters", {
        project_id: copy.id,
        part_id: chapter.part_id ? partMap.get(chapter.part_id) || null : null,
        kind: chapter.kind,
        front_type: chapter.front_type,
        number: chapter.number,
        title: chapter.title,
        subtitle: chapter.subtitle,
        purpose: chapter.purpose,
        promise: chapter.promise,
        key_concepts: chapter.key_concepts,
        target_words: chapter.target_words,
        estimated_pages: chapter.estimated_pages,
        visual_opportunities: chapter.visual_opportunities,
        exercises: chapter.exercises,
        case_studies: chapter.case_studies,
        content: chapter.content,
        status: chapter.status,
        include: chapter.include,
        sort_order: chapter.sort_order,
      });
      chapterMap.set(chapter.id, created.id);
    }
  }

  if (bible) {
    await ctx.db.update("book_bible", {
      audience: bible.audience, tone: bible.tone, writing_style: bible.writing_style,
      promise: bible.promise, transformation: bible.transformation,
      voice_rules: bible.voice_rules, terminology: bible.terminology,
      key_concepts: bible.key_concepts, recurring_examples: bible.recurring_examples,
      characters: bible.characters, facts: bible.facts,
      visual_style: bible.visual_style, image_style: bible.image_style,
      brand_colors: bible.brand_colors, typography: bible.typography,
      chapter_summaries: bible.chapter_summaries, notes: bible.notes,
    }, { eq: { project_id: copy.id } });
  }

  for (const visual of visuals) {
    await ctx.db.insert("book_visuals", {
      project_id: copy.id,
      chapter_id: visual.chapter_id ? chapterMap.get(visual.chapter_id) || null : null,
      kind: visual.kind, title: visual.title, purpose: visual.purpose,
      placement: visual.placement, brief: visual.brief, prompt: visual.prompt,
      alt_text: visual.alt_text, caption: visual.caption, data: visual.data,
      status: visual.status, sort_order: visual.sort_order,
    }, { returning: false });
  }

  await audit.record(ctx.user.id, "book_project.duplicated", {
    entity: "book_project", entityId: copy.id, detail: { from: id },
  });

  return json({ project: copy }, 201);
}

/**
 * How far along a book is.
 *
 * Words written against words planned, because that is the thing an
 * author actually wants to know. Stage flags alone would show 60% for a
 * book with an approved outline and no prose in it.
 */
export function progressOf(project, chapters) {
  const body = chapters.filter((c) => c.include !== false && c.kind !== "front");
  const planned = body.reduce((sum, c) => sum + (c.target_words || 0), 0);
  const written = body.reduce((sum, c) => sum + (c.word_count || 0), 0);
  const done = body.filter((c) => ["draft", "reviewed", "approved", "final"].includes(c.status)).length;

  const stages = project.stages || {};
  const stageWeight =
    (stages.positioning === "approved" ? 8 : 0) +
    (stages.blueprint === "approved" ? 10 : 0) +
    (stages.design === "approved" ? 6 : 0) +
    (stages.cover === "approved" ? 6 : 0);

  const writing = planned > 0 ? Math.min(1, written / planned) : 0;
  const percent = Math.min(
    100,
    Math.round(stageWeight + writing * 70)
  );

  return {
    percent,
    chapters: body.length,
    chaptersWritten: done,
    words: written,
    plannedWords: planned,
    estimatedPages: Math.max(0, Math.round(written / 260)),
  };
}

async function createProject(ctx, body) {
  await assertCanAddProject(ctx);

  const idea = v.str(body.idea, "Book idea", { min: 10, max: 4000, required: true });
  const patch = {
    user_id: ctx.user.id,
    idea,
    title: v.str(body.title, "Title", { max: 300 }) || "Untitled book",
    subtitle: v.str(body.subtitle, "Subtitle", { max: 300 }),
    author_name: v.str(body.author_name, "Author name", { max: 200 }) || ctx.profile.full_name || null,
    genre: v.str(body.genre, "Genre", { max: 80 }),
    audience: v.str(body.audience, "Audience", { max: 400 }),
    language: v.str(body.language, "Language", { max: 10 }) || ctx.profile.language || "en",
    purpose: v.oneOf(body.purpose, "Purpose", PURPOSES),
    writing_style: v.oneOf(body.writing_style, "Writing style", STYLES),
    target_pages: v.int(body.target_pages, "Desired length", { min: 10, max: 1200 }),
    template_id: v.str(body.template_id, "Template", { max: 60 }),
    theme_id: v.str(body.theme_id, "Theme", { max: 60 }),
    trim_size: v.oneOf(body.trim_size, "Trim size", Object.keys(TRIM_SIZES)) || "6x9",
    brand_kit_id: body.brand_kit_id ? v.uuid(body.brand_kit_id, "Brand kit") : null,
    status: "draft",
    stages: {},
    // A cover template picked on the Create page. Remembered on the project and
    // turned into a real cover when the author reaches the Cover step, once
    // their title exists. An id that is not a real template is simply dropped.
    design: coverTemplateById(body.cover_template) ? { cover_template: body.cover_template } : {},
  };

  // A page target implies a word target. 260 words to the page is the
  // trade non-fiction average at 6x9 — near enough that the architect's
  // budget lands within a few pages of what the layout engine sets.
  if (patch.target_pages) patch.target_words = Math.round(patch.target_pages * 260);

  if (patch.template_id) {
    const template = await ctx.db.selectOne("book_templates", { eq: { id: patch.template_id } });
    if (template) {
      patch.theme_id = patch.theme_id || template.theme_id;
      patch.purpose = patch.purpose || template.purpose;
      patch.writing_style = patch.writing_style || template.writing_style;
      if (!patch.target_pages && template.target_pages) {
        patch.target_pages = template.target_pages;
        patch.target_words = Math.round(template.target_pages * 260);
      }
    } else {
      patch.template_id = null;
    }
  }
  if (!patch.theme_id) patch.theme_id = "editorial";

  const project = await ctx.db.insert("book_projects", patch);

  // The Bible exists from the first moment, empty. Every generation
  // reads it, so a missing row would mean a special case in eleven
  // different places.
  await ctx.db.insert("book_bible", {
    project_id: project.id,
    audience: patch.audience,
    writing_style: patch.writing_style,
  }, { returning: false });

  await audit.record(ctx.user.id, "book_project.created", {
    entity: "book_project", entityId: project.id,
    detail: { template: patch.template_id, genre: patch.genre },
  });

  return json({ project }, 201);
}

async function getProject(ctx, id) {
  const project = await loadProject(ctx, id);
  const [positioning, bible, parts, chapters, visuals, covers, quality, exports, sources] = await Promise.all([
    ctx.db.selectOne("book_positioning", { eq: { project_id: id }, order: "created_at.desc" }),
    ctx.db.selectOne("book_bible", { eq: { project_id: id } }),
    ctx.db.select("book_parts", { eq: { project_id: id }, order: "sort_order", limit: 50 }),
    ctx.db.select("book_chapters", {
      // Content is deliberately left out of the overview: a 60-chapter
      // book would otherwise ship the entire manuscript to render a list.
      select: "id,project_id,part_id,kind,front_type,number,title,subtitle,purpose,promise," +
              "key_concepts,target_words,estimated_pages,visual_opportunities,exercises," +
              "case_studies,word_count,status,quality,include,sort_order,updated_at",
      eq: { project_id: id }, order: "sort_order", limit: 400,
    }),
    ctx.db.select("book_visuals", { eq: { project_id: id }, order: "sort_order", limit: 400 }),
    ctx.db.select("book_covers", { eq: { project_id: id }, order: "created_at.desc", limit: 40 }),
    ctx.db.selectOne("book_quality_reports", {
      eq: { project_id: id, scope: "book" }, order: "created_at.desc",
    }),
    ctx.db.select("book_exports", { eq: { project_id: id }, order: "created_at.desc", limit: 20 }),
    ctx.db.select("book_research_sources", { eq: { project_id: id }, order: "created_at.desc", limit: 200 }),
  ]);

  return json({
    project: { ...project, progress: progressOf(project, chapters) },
    positioning,
    bible,
    parts,
    chapters,
    visuals,
    covers,
    quality,
    exports,
    sources,
  });
}

async function updateProject(ctx, id, body) {
  await loadProject(ctx, id);
  const patch = v.pick(body, {
    idea: (x) => v.str(x, "Book idea", { min: 10, max: 4000 }),
    title: (x) => v.str(x, "Title", { max: 300 }),
    subtitle: (x) => v.str(x, "Subtitle", { max: 300 }),
    author_name: (x) => v.str(x, "Author name", { max: 200 }),
    genre: (x) => v.str(x, "Genre", { max: 80 }),
    audience: (x) => v.str(x, "Audience", { max: 400 }),
    language: (x) => v.str(x, "Language", { max: 10 }),
    purpose: (x) => v.oneOf(x, "Purpose", PURPOSES),
    writing_style: (x) => v.oneOf(x, "Writing style", STYLES),
    tone: (x) => v.str(x, "Tone", { max: 200 }),
    target_pages: (x) => v.int(x, "Desired length", { min: 10, max: 1200 }),
    target_words: (x) => v.int(x, "Target words", { min: 2000, max: 400000 }),
    status: (x) => v.oneOf(x, "Status", STATUSES),
    theme_id: (x) => v.str(x, "Theme", { max: 60 }),
    template_id: (x) => v.str(x, "Template", { max: 60 }),
    trim_size: (x) => v.oneOf(x, "Trim size", Object.keys(TRIM_SIZES)),
    brand_kit_id: (x) => (x === null ? null : v.uuid(x, "Brand kit")),
    stages: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
    design: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
    metadata: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
  });
  if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
  if (patch.target_pages && !patch.target_words) patch.target_words = Math.round(patch.target_pages * 260);

  const project = await ctx.db.update("book_projects", patch, { eq: { id } });
  return json({ project });
}

async function deleteProject(ctx, id) {
  await loadProject(ctx, id);
  await ctx.db.remove("book_projects", { eq: { id } });
  await audit.record(ctx.user.id, "book_project.deleted", { entity: "book_project", entityId: id });
  return json({ deleted: true });
}

/**
 * Hand a finished book to the marketing side.
 *
 * This is the join between the two halves of the product: the book the
 * author wrote here becomes the book BookPilot advertises, carrying its
 * positioning across rather than asking them to retype it.
 */
async function promoteProject(ctx, id) {
  const project = await loadProject(ctx, id);
  if (project.book_id) {
    const existing = await ctx.db.selectOne("books", { eq: { id: project.book_id } });
    if (existing) return json({ book: existing, created: false });
  }

  const [positioning, cover] = await Promise.all([
    ctx.db.selectOne("book_positioning", { eq: { project_id: id }, order: "created_at.desc" }),
    ctx.db.selectOne("book_covers", { eq: { project_id: id, is_selected: true } }),
  ]);

  const book = await ctx.db.insert("books", {
    user_id: ctx.user.id,
    title: project.title,
    subtitle: project.subtitle,
    author_name: project.author_name,
    genre: project.genre,
    description: positioning?.promise || project.idea,
    cover_url: cover?.image_url || null,
    currency: ctx.profile.currency || "EUR",
    status: "draft",
  });

  await ctx.db.update("book_projects", { book_id: book.id }, { eq: { id } });
  await audit.record(ctx.user.id, "book_project.promoted", {
    entity: "book_project", entityId: id, detail: { book_id: book.id },
  });
  return json({ book, created: true }, 201);
}

// ---------------------------------------------------------------------
// The manuscript
// ---------------------------------------------------------------------

/** Everything the previewer and the exporter need, in one call. */
async function getManuscript(ctx, id) {
  const project = await loadProject(ctx, id);
  const [parts, chapters, visuals, bible] = await Promise.all([
    ctx.db.select("book_parts", { eq: { project_id: id }, order: "sort_order", limit: 50 }),
    ctx.db.select("book_chapters", { eq: { project_id: id }, order: "sort_order", limit: 400 }),
    ctx.db.select("book_visuals", { eq: { project_id: id }, order: "sort_order", limit: 400 }),
    ctx.db.selectOne("book_bible", { eq: { project_id: id } }),
  ]);
  // `progress` travels with the project everywhere it is returned, so a
  // screen that loads the manuscript rather than the overview does not
  // render a header full of zeroes.
  return json({
    project: { ...project, progress: progressOf(project, chapters) },
    parts, chapters, visuals, bible,
  });
}

// ---------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------

function chapterPatch(body) {
  return v.pick(body, {
    part_id: (x) => (x === null ? null : v.uuid(x, "Part")),
    kind: (x) => v.oneOf(x, "Kind", CHAPTER_KINDS),
    front_type: (x) => (x === null ? null : v.oneOf(x, "Section type", FRONT_TYPES)),
    number: (x) => (x === null ? null : v.int(x, "Chapter number", { min: 0, max: 999 })),
    title: (x) => v.str(x, "Title", { max: 300 }),
    subtitle: (x) => v.str(x, "Subtitle", { max: 300 }),
    purpose: (x) => v.str(x, "Purpose", { max: 2000 }),
    promise: (x) => v.str(x, "Promise", { max: 2000 }),
    key_concepts: (x) => v.stringArray(x, "Key concepts", { maxItems: 20 }),
    target_words: (x) => v.int(x, "Target words", { min: 0, max: 20000 }),
    estimated_pages: (x) => v.int(x, "Estimated pages", { min: 0, max: 200 }),
    // The manuscript itself. 200 KB is roughly 30,000 words — far more
    // than one chapter, and well inside the request body cap.
    content: (x) => v.str(x, "Chapter text", { max: 200000 }),
    status: (x) => v.oneOf(x, "Status", CHAPTER_STATUSES),
    include: (x) => v.bool(x),
    sort_order: (x) => v.int(x, "Position", { min: 0, max: 10000 }),
  });
}

async function handleChapters(ctx, projectId, method, segments, body) {
  await loadProject(ctx, projectId);
  const chapterId = segments[3];

  if (method === "GET" && !chapterId) {
    const chapters = await ctx.db.select("book_chapters", {
      eq: { project_id: projectId }, order: "sort_order", limit: 400,
    });
    return json({ chapters });
  }

  if (method === "GET" && chapterId) {
    v.uuid(chapterId, "Chapter");
    const [chapter, versions, visuals] = await Promise.all([
      ctx.db.selectOne("book_chapters", { eq: { id: chapterId, project_id: projectId } }),
      ctx.db.select("book_chapter_versions", {
        select: "id,version,label,action,word_count,model,created_at",
        eq: { chapter_id: chapterId }, order: "version.desc", limit: 30,
      }),
      ctx.db.select("book_visuals", { eq: { chapter_id: chapterId }, order: "sort_order", limit: 40 }),
    ]);
    if (!chapter) throw Errors.notFound("chapter");
    return json({ chapter, versions, visuals });
  }

  if (method === "POST" && chapterId === "reorder") {
    const order = Array.isArray(body.order) ? body.order : null;
    if (!order) throw Errors.invalid("Send the new order as a list.");
    if (order.length > 400) throw Errors.invalid("That is more sections than a book can hold.");
    // One statement per row rather than a bulk upsert: an upsert would
    // need the whole row, and a partial one would blank the manuscript.
    for (const [index, item] of order.entries()) {
      const id = v.uuid(item.id, "Chapter");
      const patch = { sort_order: index };
      if ("part_id" in item) patch.part_id = item.part_id ? v.uuid(item.part_id, "Part") : null;
      if ("number" in item && item.number !== null) {
        patch.number = v.int(item.number, "Chapter number", { min: 0, max: 999 });
      }
      await ctx.db.update("book_chapters", patch, { eq: { id, project_id: projectId } });
    }
    const chapters = await ctx.db.select("book_chapters", {
      select: "id,part_id,number,title,kind,sort_order",
      eq: { project_id: projectId }, order: "sort_order", limit: 400,
    });
    return json({ chapters });
  }

  if (method === "POST" && !chapterId) {
    const patch = chapterPatch(body);
    if (!patch.title) throw Errors.invalid("A section needs a title.");
    const siblings = await ctx.db.select("book_chapters", {
      select: "id,sort_order", eq: { project_id: projectId }, order: "sort_order.desc", limit: 1,
    });
    const chapter = await ctx.db.insert("book_chapters", {
      project_id: projectId,
      kind: patch.kind || "chapter",
      sort_order: patch.sort_order ?? ((siblings[0]?.sort_order ?? -1) + 1),
      ...patch,
    });
    return json({ chapter }, 201);
  }

  if (method === "PATCH" && chapterId) {
    v.uuid(chapterId, "Chapter");
    const patch = chapterPatch(body);
    if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");

    // Editing the text always leaves the previous text behind. Losing a
    // draft to an autosave is the failure an author never forgives.
    if (patch.content !== undefined) {
      const current = await ctx.db.selectOne("book_chapters", {
        select: "id,content,word_count", eq: { id: chapterId, project_id: projectId },
      });
      if (!current) throw Errors.notFound("chapter");
      if (current.content && current.content !== patch.content) {
        await saveChapterVersion(ctx, projectId, chapterId, current, body.version_label || "Before editing", "manual");
      }
    }

    const chapter = await ctx.db.update("book_chapters", patch, {
      eq: { id: chapterId, project_id: projectId },
    });
    return json({ chapter });
  }

  if (method === "DELETE" && chapterId) {
    v.uuid(chapterId, "Chapter");
    await ctx.db.remove("book_chapters", { eq: { id: chapterId, project_id: projectId } });
    return json({ deleted: true });
  }

  throw Errors.notFound("endpoint");
}


async function handleChapterVersions(ctx, method, segments, body) {
  const chapterId = v.uuid(segments[1], "Chapter");
  const chapter = await ctx.db.selectOne("book_chapters", { eq: { id: chapterId } });
  if (!chapter) throw Errors.notFound("chapter");

  if (method === "GET" && !segments[2]) {
    const versions = await ctx.db.select("book_chapter_versions", {
      eq: { chapter_id: chapterId }, order: "version.desc", limit: 50,
    });
    return json({ versions });
  }

  if (method === "POST" && segments[2] === "restore") {
    const versionId = v.uuid(body.version_id, "Version");
    const version = await ctx.db.selectOne("book_chapter_versions", {
      eq: { id: versionId, chapter_id: chapterId },
    });
    if (!version) throw Errors.notFound("version");

    // Restoring is itself a change, so the text being replaced is kept
    // first. Nothing in this table is ever overwritten (spec 30).
    await saveChapterVersion(ctx, chapter.project_id, chapterId, chapter,
      `Before restoring v${version.version}`, "restore");
    const updated = await ctx.db.update("book_chapters", { content: version.content },
      { eq: { id: chapterId } });
    return json({ chapter: updated, restored: version.version });
  }

  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------

async function handleParts(ctx, projectId, method, segments, body) {
  await loadProject(ctx, projectId);
  const partId = segments[3];

  if (method === "GET") {
    const parts = await ctx.db.select("book_parts", {
      eq: { project_id: projectId }, order: "sort_order", limit: 50,
    });
    return json({ parts });
  }
  if (method === "POST") {
    const part = await ctx.db.insert("book_parts", {
      project_id: projectId,
      title: v.str(body.title, "Part title", { max: 200, required: true }),
      purpose: v.str(body.purpose, "Purpose", { max: 1000 }),
      number: v.int(body.number, "Part number", { min: 1, max: 99 }),
      sort_order: v.int(body.sort_order, "Position", { min: 0, max: 100 }) ?? 0,
    });
    return json({ part }, 201);
  }
  if (method === "PATCH" && partId) {
    v.uuid(partId, "Part");
    const patch = v.pick(body, {
      title: (x) => v.str(x, "Part title", { max: 200 }),
      purpose: (x) => v.str(x, "Purpose", { max: 1000 }),
      number: (x) => v.int(x, "Part number", { min: 1, max: 99 }),
      sort_order: (x) => v.int(x, "Position", { min: 0, max: 100 }),
    });
    const part = await ctx.db.update("book_parts", patch, { eq: { id: partId, project_id: projectId } });
    return json({ part });
  }
  if (method === "DELETE" && partId) {
    v.uuid(partId, "Part");
    await ctx.db.remove("book_parts", { eq: { id: partId, project_id: projectId } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// The Book Bible
// ---------------------------------------------------------------------

async function handleBible(ctx, projectId, method, body) {
  await loadProject(ctx, projectId);

  if (method === "GET") {
    const bible = await ctx.db.selectOne("book_bible", { eq: { project_id: projectId } });
    return json({ bible });
  }
  if (method === "PATCH") {
    const patch = v.pick(body, {
      audience: (x) => v.str(x, "Audience", { max: 1000 }),
      tone: (x) => v.str(x, "Tone", { max: 1000 }),
      writing_style: (x) => v.str(x, "Writing style", { max: 2000 }),
      promise: (x) => v.str(x, "Promise", { max: 1000 }),
      transformation: (x) => v.str(x, "Transformation", { max: 1000 }),
      voice_rules: (x) => v.stringArray(x, "Voice rules", { maxItems: 30, maxLength: 300 }),
      key_concepts: (x) => v.stringArray(x, "Key concepts", { maxItems: 30 }),
      brand_colors: (x) => v.stringArray(x, "Brand colours", { maxItems: 8, maxLength: 12 }),
      visual_style: (x) => v.str(x, "Visual style", { max: 2000 }),
      image_style: (x) => v.str(x, "Image style", { max: 2000 }),
      notes: (x) => v.str(x, "Notes", { max: 8000 }),
      terminology: (x) => jsonArray(x, "Terminology"),
      recurring_examples: (x) => jsonArray(x, "Recurring examples"),
      characters: (x) => jsonArray(x, "Characters"),
      facts: (x) => jsonArray(x, "Facts"),
      chapter_summaries: (x) => jsonArray(x, "Chapter summaries"),
      typography: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
    });
    if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
    const bible = await ctx.db.update("book_bible", patch, { eq: { project_id: projectId } });
    return json({ bible });
  }
  throw Errors.notFound("endpoint");
}

/** A JSON array column, size-capped. */
function jsonArray(value, field, max = 60) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw Errors.invalid(`${field} must be a list.`);
  if (value.length > max) throw Errors.invalid(`${field} can hold at most ${max} entries.`);
  const text = JSON.stringify(value);
  if (text.length > 120000) throw Errors.invalid(`${field} is too large.`);
  return value;
}

// ---------------------------------------------------------------------
// Visuals, sources, covers, marketing
// ---------------------------------------------------------------------

async function handleVisuals(ctx, projectId, method, segments, body) {
  await loadProject(ctx, projectId);
  const visualId = segments[3];

  if (method === "GET") {
    const visuals = await ctx.db.select("book_visuals", {
      eq: { project_id: projectId }, order: "sort_order", limit: 400,
    });
    return json({ visuals });
  }
  if (method === "POST") {
    const visual = await ctx.db.insert("book_visuals", {
      project_id: projectId,
      chapter_id: body.chapter_id ? v.uuid(body.chapter_id, "Chapter") : null,
      kind: v.oneOf(body.kind, "Kind", VISUAL_KINDS, { required: true }),
      title: v.str(body.title, "Title", { max: 300 }),
      purpose: v.str(body.purpose, "Purpose", { max: 1000 }),
      placement: v.str(body.placement, "Placement", { max: 300 }),
      brief: v.str(body.brief, "Brief", { max: 4000 }),
      prompt: v.str(body.prompt, "Prompt", { max: 4000 }),
      alt_text: v.str(body.alt_text, "Alt text", { max: 1000 }),
      caption: v.str(body.caption, "Caption", { max: 600 }),
      data: body.data && typeof body.data === "object" ? body.data : {},
      status: v.oneOf(body.status, "Status", ["suggested", "approved", "rendered", "skipped"]) || "suggested",
      sort_order: v.int(body.sort_order, "Position", { min: 0, max: 1000 }) ?? 0,
    });
    return json({ visual }, 201);
  }
  if (method === "PATCH" && visualId) {
    v.uuid(visualId, "Visual");
    const patch = v.pick(body, {
      chapter_id: (x) => (x === null ? null : v.uuid(x, "Chapter")),
      kind: (x) => v.oneOf(x, "Kind", VISUAL_KINDS),
      title: (x) => v.str(x, "Title", { max: 300 }),
      purpose: (x) => v.str(x, "Purpose", { max: 1000 }),
      placement: (x) => v.str(x, "Placement", { max: 300 }),
      brief: (x) => v.str(x, "Brief", { max: 4000 }),
      prompt: (x) => v.str(x, "Prompt", { max: 4000 }),
      alt_text: (x) => v.str(x, "Alt text", { max: 1000 }),
      caption: (x) => v.str(x, "Caption", { max: 600 }),
      data: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
      status: (x) => v.oneOf(x, "Status", ["suggested", "approved", "rendered", "skipped"]),
      sort_order: (x) => v.int(x, "Position", { min: 0, max: 1000 }),
    });
    const visual = await ctx.db.update("book_visuals", patch, { eq: { id: visualId, project_id: projectId } });
    return json({ visual });
  }
  if (method === "DELETE" && visualId) {
    v.uuid(visualId, "Visual");
    await ctx.db.remove("book_visuals", { eq: { id: visualId, project_id: projectId } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

async function handleSources(ctx, projectId, method, segments, body) {
  await loadProject(ctx, projectId);
  const sourceId = segments[3];

  if (method === "GET") {
    const sources = await ctx.db.select("book_research_sources", {
      eq: { project_id: projectId }, order: "created_at.desc", limit: 300,
    });
    return json({ sources });
  }
  if (method === "POST") {
    const source = await ctx.db.insert("book_research_sources", {
      project_id: projectId,
      chapter_id: body.chapter_id ? v.uuid(body.chapter_id, "Chapter") : null,
      title: v.str(body.title, "Source title", { max: 400, required: true }),
      author_org: v.str(body.author_org, "Author or organisation", { max: 300 }),
      published_on: v.str(body.published_on, "Publication date", { max: 40 }),
      url: body.url ? v.url(body.url, "Source URL") : null,
      summary: v.str(body.summary, "Summary", { max: 4000 }),
      claim: v.str(body.claim, "Claim", { max: 2000 }),
      kind: v.oneOf(body.kind, "Kind", ["fact", "interpretation", "example", "opinion"]) || "fact",
      verification: v.oneOf(body.verification, "Verification",
        ["unverified", "verified", "disputed"]) || "unverified",
      notes: v.str(body.notes, "Notes", { max: 4000 }),
      accessed_on: body.accessed_on ? v.isoDate(body.accessed_on, "Access date") : null,
    });
    return json({ source }, 201);
  }
  if (method === "PATCH" && sourceId) {
    v.uuid(sourceId, "Source");
    const patch = v.pick(body, {
      title: (x) => v.str(x, "Source title", { max: 400 }),
      author_org: (x) => v.str(x, "Author or organisation", { max: 300 }),
      published_on: (x) => v.str(x, "Publication date", { max: 40 }),
      url: (x) => (x === null ? null : v.url(x, "Source URL")),
      summary: (x) => v.str(x, "Summary", { max: 4000 }),
      claim: (x) => v.str(x, "Claim", { max: 2000 }),
      kind: (x) => v.oneOf(x, "Kind", ["fact", "interpretation", "example", "opinion"]),
      verification: (x) => v.oneOf(x, "Verification", ["unverified", "verified", "disputed"]),
      notes: (x) => v.str(x, "Notes", { max: 4000 }),
      accessed_on: (x) => (x === null ? null : v.isoDate(x, "Access date")),
    });
    const source = await ctx.db.update("book_research_sources", patch,
      { eq: { id: sourceId, project_id: projectId } });
    return json({ source });
  }
  if (method === "DELETE" && sourceId) {
    v.uuid(sourceId, "Source");
    await ctx.db.remove("book_research_sources", { eq: { id: sourceId, project_id: projectId } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

async function handleCovers(ctx, projectId, method, segments, body) {
  const project = await loadProject(ctx, projectId);
  const coverId = segments[3];

  if (method === "GET") {
    const covers = await ctx.db.select("book_covers", {
      eq: { project_id: projectId }, order: "created_at.desc", limit: 40,
    });
    return json({ covers });
  }
  if (method === "POST" && !coverId) {
    // A cover from a ready-made template. The server builds it from the template
    // it knows, using this project's own title and author, rather than storing
    // whatever design the browser describes.
    const template = coverTemplateById(body.template_id);
    if (!template) throw Errors.invalid("That cover template doesn't exist.");

    // Asking twice must not stack duplicates.
    const already = await ctx.db.selectOne("book_covers", {
      eq: { project_id: projectId, concept_name: template.name },
    });
    if (already) return json({ cover: already });

    const row = coverFromTemplate(template, {
      title: project.title, subtitle: project.subtitle, author: project.author_name, origin: env.siteUrl,
    });
    const cover = await ctx.db.insert("book_covers", { project_id: projectId, ...row });
    return json({ cover }, 201);
  }
  if (method === "PATCH" && coverId) {
    v.uuid(coverId, "Cover");
    const patch = v.pick(body, {
      concept_name: (x) => v.str(x, "Concept name", { max: 200 }),
      rationale: (x) => v.str(x, "Rationale", { max: 2000 }),
      title_text: (x) => v.str(x, "Title", { max: 300 }),
      subtitle_text: (x) => v.str(x, "Subtitle", { max: 300 }),
      author_text: (x) => v.str(x, "Author", { max: 200 }),
      spine_text: (x) => v.str(x, "Spine", { max: 300 }),
      back_blurb: (x) => v.str(x, "Back cover", { max: 4000 }),
      image_url: (x) => (x === null ? null : v.url(x, "Image URL")),
      palette: (x) => jsonArray(x, "Palette", 8),
      layout: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
      is_selected: (x) => v.bool(x),
    });
    if (patch.is_selected) {
      // One selected cover at a time, or the export has to guess.
      await ctx.db.update("book_covers", { is_selected: false },
        { eq: { project_id: projectId, is_selected: true } });
    }
    const cover = await ctx.db.update("book_covers", patch, { eq: { id: coverId, project_id: projectId } });
    if (patch.is_selected) {
      await setStage(ctx, project, "cover", "approved");
    }
    return json({ cover });
  }
  if (method === "DELETE" && coverId) {
    v.uuid(coverId, "Cover");
    await ctx.db.remove("book_covers", { eq: { id: coverId, project_id: projectId } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

async function handleMarketing(ctx, projectId, method, segments, body) {
  await loadProject(ctx, projectId);
  const assetId = segments[3];

  if (method === "GET") {
    const assets = await ctx.db.select("book_marketing_assets", {
      eq: { project_id: projectId }, order: "sort_order", limit: 400,
    });
    return json({ assets });
  }
  if (method === "PATCH" && assetId) {
    v.uuid(assetId, "Asset");
    const patch = v.pick(body, {
      title: (x) => v.str(x, "Title", { max: 300 }),
      content: (x) => v.str(x, "Content", { max: 20000 }),
      status: (x) => v.oneOf(x, "Status", ["draft", "approved", "used", "archived"]),
      sort_order: (x) => v.int(x, "Position", { min: 0, max: 1000 }),
    });
    const asset = await ctx.db.update("book_marketing_assets", patch,
      { eq: { id: assetId, project_id: projectId } });
    return json({ asset });
  }
  if (method === "DELETE" && assetId) {
    v.uuid(assetId, "Asset");
    await ctx.db.remove("book_marketing_assets", { eq: { id: assetId, project_id: projectId } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// Project versions
// ---------------------------------------------------------------------

async function handleProjectVersions(ctx, projectId, method, segments, body) {
  const project = await loadProject(ctx, projectId);

  if (method === "GET") {
    const versions = await ctx.db.select("book_project_versions", {
      select: "id,version,label,note,created_at",
      eq: { project_id: projectId }, order: "version.desc", limit: 50,
    });
    return json({ versions });
  }

  if (method === "POST" && segments[3] === "restore") {
    const versionId = v.uuid(body.version_id, "Version");
    const version = await ctx.db.selectOne("book_project_versions", {
      eq: { id: versionId, project_id: projectId },
    });
    if (!version) throw Errors.notFound("version");

    // Snapshot what is about to be replaced, then put the old text back
    // chapter by chapter. Chapters added since the snapshot are left
    // alone rather than deleted: destroying work the author did after
    // the snapshot would be a worse surprise than an extra chapter.
    await snapshot(ctx, project, `Before restoring v${version.version}`);
    const snap = version.snapshot || {};
    for (const chapter of snap.chapters || []) {
      if (!chapter.id) continue;
      await ctx.db.update("book_chapters", {
        title: chapter.title,
        content: chapter.content,
        status: chapter.status,
      }, { eq: { id: chapter.id, project_id: projectId } });
    }
    return json({ restored: version.version });
  }

  if (method === "POST") {
    const version = await snapshot(ctx, project, body.label, body.note);
    return json({ version }, 201);
  }

  throw Errors.notFound("endpoint");
}

async function snapshot(ctx, project, label, note = null) {
  const chapters = await ctx.db.select("book_chapters", {
    select: "id,title,content,status,sort_order,kind,number",
    eq: { project_id: project.id }, order: "sort_order", limit: 400,
  });
  const latest = await ctx.db.select("book_project_versions", {
    select: "version", eq: { project_id: project.id }, order: "version.desc", limit: 1,
  });
  const version = (latest[0]?.version || 0) + 1;

  return ctx.db.insert("book_project_versions", {
    project_id: project.id,
    version,
    label: v.str(label, "Label", { max: 120 }) || `Version ${version}`,
    note: v.str(note, "Note", { max: 2000 }),
    snapshot: {
      saved_at: new Date().toISOString(),
      project: {
        title: project.title, subtitle: project.subtitle, status: project.status,
        theme_id: project.theme_id, trim_size: project.trim_size, stages: project.stages,
      },
      chapters,
    },
  });
}

// ---------------------------------------------------------------------
// Brand kits, themes, templates
// ---------------------------------------------------------------------

async function handleBrandKits(ctx, method, segments, body) {
  const kitId = segments[1];

  if (method === "GET") {
    const kits = await ctx.db.select("brand_kits", {
      eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 50,
    });
    return json({ kits });
  }

  const patch = v.pick(body, {
    name: (x) => v.str(x, "Name", { max: 120 }),
    logo_url: (x) => (x === null ? null : v.url(x, "Logo URL")),
    author_photo_url: (x) => (x === null ? null : v.url(x, "Author photo URL")),
    author_bio: (x) => v.str(x, "Author bio", { max: 4000 }),
    company_name: (x) => v.str(x, "Company", { max: 200 }),
    company_details: (x) => v.str(x, "Company details", { max: 2000 }),
    colors: (x) => jsonArray(x, "Colours", 12),
    fonts: (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : undefined),
    is_default: (x) => v.bool(x),
  });

  if (method === "POST") {
    if (!patch.name) throw Errors.invalid("A brand kit needs a name.");
    if (patch.is_default) {
      await ctx.db.update("brand_kits", { is_default: false },
        { eq: { user_id: ctx.user.id, is_default: true } });
    }
    const kit = await ctx.db.insert("brand_kits", { user_id: ctx.user.id, ...patch });
    return json({ kit }, 201);
  }
  if (method === "PATCH" && kitId) {
    v.uuid(kitId, "Brand kit");
    if (patch.is_default) {
      await ctx.db.update("brand_kits", { is_default: false },
        { eq: { user_id: ctx.user.id, is_default: true } });
    }
    const kit = await ctx.db.update("brand_kits", patch, { eq: { id: kitId, user_id: ctx.user.id } });
    return json({ kit });
  }
  if (method === "DELETE" && kitId) {
    v.uuid(kitId, "Brand kit");
    await ctx.db.remove("brand_kits", { eq: { id: kitId, user_id: ctx.user.id } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

/**
 * Themes and trim sizes.
 *
 * Served from the layout engine's own definitions, with the database row
 * supplying the copy. If the reference table is empty — a deployment
 * that skipped the seed — the picker still works, because the engine can
 * always set a page.
 */
async function handleThemes(ctx) {
  let rows = [];
  try {
    rows = await ctx.db.select("book_design_themes", {
      eq: { is_active: true }, order: "sort_order", limit: 40,
    });
  } catch {
    rows = [];
  }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const themes = themeList().map((theme) => ({
    ...theme,
    name: byId[theme.id]?.name || theme.name,
    tagline: byId[theme.id]?.tagline || "",
    description: byId[theme.id]?.description || "",
  }));
  return json({
    themes,
    trimSizes: Object.entries(TRIM_SIZES).map(([id, size]) => ({ id, ...size })),
  });
}

async function handleTemplates(ctx) {
  const templates = await ctx.db.select("book_templates", {
    eq: { is_active: true }, order: "sort_order", limit: 100,
  });
  return json({ templates });
}

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const segments = pathSegments(req, PREFIX);
  const resource = segments[0];
  if (!resource) throw Errors.notFound("endpoint");

  const ctx = await authenticate(req);
  memoryLimit(`bb:${ctx.user.id}`, 400, 60_000);

  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readJson(req) : {};
  const method = req.method;

  if (resource === "themes" && method === "GET") return handleThemes(ctx);
  if (resource === "templates" && method === "GET") return handleTemplates(ctx);
  if (resource === "brand-kits") return handleBrandKits(ctx, method, segments, body);
  if (resource === "chapters") return handleChapterVersions(ctx, method, segments, body);

  if (resource === "projects") {
    const projectId = segments[1];
    const child = segments[2];

    if (!projectId) {
      if (method === "GET") return listProjects(ctx);
      if (method === "POST") return createProject(ctx, body);
      throw Errors.notFound("endpoint");
    }

    v.uuid(projectId, "Project");

    if (!child) {
      if (method === "GET") return getProject(ctx, projectId);
      if (method === "PATCH") return updateProject(ctx, projectId, body);
      if (method === "DELETE") return deleteProject(ctx, projectId);
      throw Errors.notFound("endpoint");
    }

    switch (child) {
      case "manuscript":
        if (method === "GET") return getManuscript(ctx, projectId);
        break;
      case "chapters":
        return handleChapters(ctx, projectId, method, segments, body);
      case "parts":
        return handleParts(ctx, projectId, method, segments, body);
      case "bible":
        return handleBible(ctx, projectId, method, body);
      case "visuals":
        return handleVisuals(ctx, projectId, method, segments, body);
      case "sources":
        return handleSources(ctx, projectId, method, segments, body);
      case "covers":
        return handleCovers(ctx, projectId, method, segments, body);
      case "marketing":
        return handleMarketing(ctx, projectId, method, segments, body);
      case "versions":
        return handleProjectVersions(ctx, projectId, method, segments, body);
      case "promote":
        if (method === "POST") return promoteProject(ctx, projectId);
        break;
      case "duplicate":
        if (method === "POST") return duplicateProject(ctx, projectId);
        break;
      default:
        break;
    }
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bb/*" };
