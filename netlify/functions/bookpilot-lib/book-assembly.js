// Assembling a book, server side.
//
// The shaping logic lives in js/doc/assemble.js, shared with the page
// previewer. What stays here is everything that needs a database client
// or a prompt: loading the rows, and turning them into the variables the
// authoring agents read.

import { wordCount } from "../../../js/doc/markdown.js";
import { assembleBook } from "../../../js/doc/assemble.js";

export { assembleBook };

/** Load every row a book needs, with the caller's own database client. */
export async function loadBookData(db, projectId) {
  const [project, parts, chapters, visuals, bible, covers] = await Promise.all([
    db.selectOne("book_projects", { eq: { id: projectId } }),
    db.select("book_parts", { eq: { project_id: projectId }, order: "sort_order", limit: 50 }),
    db.select("book_chapters", { eq: { project_id: projectId }, order: "sort_order", limit: 400 }),
    db.select("book_visuals", { eq: { project_id: projectId }, order: "sort_order", limit: 400 }),
    db.selectOne("book_bible", { eq: { project_id: projectId } }),
    db.select("book_covers", { eq: { project_id: projectId, is_selected: true }, limit: 1 }),
  ]);
  return { project, parts, chapters, visuals, bible, cover: covers[0] || null };
}

/**
 * The Book Bible, as a prompt variable.
 *
 * Every authoring agent receives this. Kept compact on purpose: the
 * whole point is that it fits in front of every generation, so an
 * unbounded notes field cannot push the chapter plan out of the prompt.
 */
export function bibleForPrompt(bible, project) {
  if (!bible) {
    return [
      `Title: ${project.title}`,
      project.subtitle ? `Subtitle: ${project.subtitle}` : "",
      `Author: ${project.author_name || "not set"}`,
      `Audience: ${project.audience || "not set"}`,
      `Requested style: ${project.writing_style || "not set"}`,
      "(The Book Bible has not been written yet.)",
    ].filter(Boolean).join("\n");
  }

  const list = (items, format) =>
    (items || []).slice(0, 14).map(format).filter(Boolean).join("\n");

  return [
    `Title: ${project.title}`,
    project.subtitle ? `Subtitle: ${project.subtitle}` : "",
    `Author: ${project.author_name || "not set"}`,
    `Language: ${project.language || "en"}`,
    `Audience: ${bible.audience || project.audience || "not set"}`,
    `Tone: ${bible.tone || "not set"}`,
    `Writing style: ${bible.writing_style || project.writing_style || "not set"}`,
    `Promise: ${bible.promise || "not set"}`,
    `Transformation: ${bible.transformation || "not set"}`,
    bible.voice_rules?.length ? `\nVoice rules:\n${list(bible.voice_rules, (r) => `- ${r}`)}` : "",
    bible.key_concepts?.length ? `\nKey concepts: ${bible.key_concepts.slice(0, 14).join("; ")}` : "",
    bible.terminology?.length
      ? `\nTerminology (use these words this way):\n${list(bible.terminology, (t) => `- ${t.term}: ${t.definition}`)}`
      : "",
    bible.recurring_examples?.length
      ? `\nRecurring examples:\n${list(bible.recurring_examples, (e) => `- ${e.name}: ${e.description}`)}`
      : "",
    bible.characters?.length
      ? `\nPeople in this book:\n${list(bible.characters, (c) => `- ${c.name}: ${c.description}`)}`
      : "",
    bible.facts?.length
      ? `\nClaims and their status:\n${list(bible.facts, (f) => `- ${f.claim} [${f.status}${f.source ? `; ${f.source}` : ""}]`)}`
      : "",
    bible.chapter_summaries?.length
      ? `\nWhat has been written so far:\n${list(bible.chapter_summaries, (s) => `- ${s.title}: ${s.summary}`)}`
      : "",
    bible.visual_style ? `\nVisual style: ${bible.visual_style}` : "",
    bible.notes ? `\nAuthor's notes: ${String(bible.notes).slice(0, 1200)}` : "",
  ].filter(Boolean).join("\n");
}

/** A one-line description of a chapter, for "what came before" context. */
export function chapterLine(chapter) {
  if (!chapter) return "(nothing — this is the opening)";
  const label = chapter.number ? `Chapter ${chapter.number}: ${chapter.title}` : chapter.title;
  return chapter.purpose ? `${label} — ${chapter.purpose}` : label;
}

/** The outline as the marketing and quality agents need to read it. */
export function outlineForPrompt(chapters, parts) {
  const partById = new Map((parts || []).map((p) => [p.id, p]));
  const lines = [];
  let lastPart = null;
  for (const chapter of chapters) {
    if (chapter.part_id && chapter.part_id !== lastPart) {
      lastPart = chapter.part_id;
      const part = partById.get(chapter.part_id);
      if (part) lines.push(`\nPART: ${part.title}${part.purpose ? ` — ${part.purpose}` : ""}`);
    }
    const label = chapter.number ? `${chapter.number}. ${chapter.title}` : chapter.title;
    lines.push(
      `${label} [${chapter.status}, ${chapter.word_count || 0} words]` +
      (chapter.purpose ? `\n   Purpose: ${chapter.purpose}` : "")
    );
  }
  return lines.join("\n");
}

/**
 * Append a chapter version.
 *
 * Lives here rather than in either function module so both the editor's
 * save path and the AI's rewrite path use exactly the same one: two
 * implementations of "keep the old draft" is one implementation that
 * eventually does not.
 */
export async function saveChapterVersion(ctx, projectId, chapterId, current, label, action, model = null) {
  const latest = await ctx.db.select("book_chapter_versions", {
    select: "version", eq: { chapter_id: chapterId }, order: "version.desc", limit: 1,
  });
  const version = (latest[0]?.version || 0) + 1;
  await ctx.db.insert("book_chapter_versions", {
    chapter_id: chapterId,
    project_id: projectId,
    version,
    label: String(label || `Version ${version}`).slice(0, 120),
    content: current.content,
    word_count: current.word_count ?? wordCount(current.content),
    action,
    model,
  }, { returning: false });
  return version;
}
