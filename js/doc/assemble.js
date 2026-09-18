// Turning rows into a book.
//
// The pure half of assembly: given a project, its parts, its chapters
// and its figures, produce the single object the layout engine, the
// EPUB writer, the DOCX writer and the publication check all consume.
//
// It lives beside the document engine rather than in the server's lib
// because the page previewer in the browser has to assemble a book
// exactly the way the exporter does. Two implementations would drift,
// and the first anyone would know of it is a PDF that does not match
// the preview it was approved from.

import { parseManuscript, wordCount } from "./markdown.js";

// Front matter runs in this order whatever order the rows are in: a
// dedication printed before the title page is a mistake no author asked
// for, and sort_order is a thing a drag-and-drop can get wrong.
const FRONT_ORDER = [
  "half_title", "title_page", "copyright", "disclaimer",
  "dedication", "epigraph", "toc", "foreword", "preface",
];

const BACK_ORDER = [
  "about_author", "workbook", "resources", "glossary", "notes", "references", "cta",
];

/**
 * Build the object the document engine takes.
 *
 * @param {object} data { project, parts, chapters, visuals, bible, cover }
 * @param {object} options { includeEmpty: boolean }
 */
export function assembleBook(data, options = {}) {
  const { project, parts = [], chapters = [], visuals = [], cover = null } = data;
  const includeEmpty = Boolean(options.includeEmpty);

  const partById = new Map(parts.map((p) => [p.id, p]));

  const usable = chapters
    .filter((c) => c.include !== false)
    .filter((c) => includeEmpty || c.kind === "front" || String(c.content || "").trim() || c.front_type)
    .slice()
    .sort(byPosition);

  const front = usable
    .filter((c) => c.kind === "front")
    .sort((a, b) => frontRank(a) - frontRank(b));
  const body = usable.filter((c) => c.kind !== "front" && c.kind !== "back" && c.kind !== "bonus");
  const back = usable
    .filter((c) => c.kind === "back" || c.kind === "bonus")
    .sort((a, b) => backRank(a) - backRank(b));

  const toSection = (chapter) => ({
    id: chapter.id,
    kind: chapter.kind,
    front_type: chapter.front_type,
    number: chapter.number,
    title: chapter.title,
    subtitle: chapter.subtitle,
    part: chapter.part_id ? partById.get(chapter.part_id) || null : null,
    blocks: parseManuscript(chapter.content || ""),
    wordCount: chapter.word_count ?? wordCount(chapter.content || ""),
  });

  return {
    title: project.title,
    subtitle: project.subtitle,
    author: project.author_name,
    language: project.language || "en",
    publisher: project.metadata?.publisher || "",
    themeId: project.theme_id || "editorial",
    trimId: project.trim_size || "6x9",
    design: project.design || {},
    cover,
    sections: [...front, ...body, ...back].map(toSection),
    visuals: visuals.filter((visual) => visual.status !== "skipped"),
  };
}

function byPosition(a, b) {
  if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0);
  return (a.number || 0) - (b.number || 0);
}

function frontRank(chapter) {
  const index = FRONT_ORDER.indexOf(chapter.front_type);
  return index < 0 ? FRONT_ORDER.length + (chapter.sort_order || 0) : index;
}

function backRank(chapter) {
  const index = BACK_ORDER.indexOf(chapter.front_type);
  return index < 0 ? BACK_ORDER.length + (chapter.sort_order || 0) : index;
}
