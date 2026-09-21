// Cover templates: ready-made cover designs an author can start from.
//
// The data (js/data/cover-templates.js) is twenty pieces of text-free artwork,
// each with the palette and type treatment that reads well over it. This file is
// the logic around that data, shared by the browser (the gallery on the Create a
// book page, the Cover step), the server (which turns a chosen template into a
// real cover row) and the demo, so all three build exactly the same cover.
//
// A template is a starting point, not a finished cover: it becomes an ordinary
// book_covers row that the author can edit, replace, or set beside AI concepts.

import { COVER_TEMPLATES } from "../data/cover-templates.js";

export { COVER_TEMPLATES };

/** Roles the cover renderer understands, in the order they are stored. */
export const PALETTE_ROLES = ["background", "title", "subtitle", "author", "accent"];

const ID = /^[a-z0-9-]{1,40}$/;

export function coverTemplateById(id) {
  if (typeof id !== "string" || !ID.test(id)) return null;
  return COVER_TEMPLATES.find((t) => t.id === id) || null;
}

/** Collections shown first in the filters, in this order, then the rest by size. */
export const FEATURED_COLLECTIONS = ["Travel", "Kids", "Marketing"];

/** How many templates carry each tag: [["Travel", 10], ...] in the order the chips appear. */
export function templateGenreCounts(templates = COVER_TEMPLATES) {
  const counts = new Map();
  for (const t of templates) for (const g of t.genres) counts.set(g, (counts.get(g) || 0) + 1);
  const rank = (g) => { const i = FEATURED_COLLECTIONS.indexOf(g); return i === -1 ? FEATURED_COLLECTIONS.length : i; };
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The genre chips, in order. */
export const templateGenres = (templates = COVER_TEMPLATES) => templateGenreCounts(templates).map(([g]) => g);

export const paletteRows = (palette) => PALETTE_ROLES.filter((r) => palette[r]).map((role) => ({ role, hex: palette[role] }));

/**
 * A cover object for a template, in the shape coverPreview() draws. Used for
 * thumbnails before any project exists: the title is a stand-in and says so.
 */
export function sampleCover(template, { author = "" } = {}) {
  return {
    concept_name: template.name,
    palette: paletteRows(template.palette),
    layout: { ...template.layout },
    title_text: "Your Book Title",
    subtitle_text: null,
    author_text: author.trim() || "Author Name",
    // The gallery shows a small thumbnail; the full-size art is what a real cover uses.
    image_url: template.thumb || template.image,
  };
}

/**
 * The book_covers row for a template, filled in from the project.
 *
 * Not selected: the author hasn't seen their own title on it yet, and choosing
 * a cover is what approves the cover stage, so that stays their decision.
 *
 * `origin` makes the artwork an absolute address (the column holds URLs, and
 * exports fetch it); without one the artwork is left out and the palette carries
 * the cover, rather than storing a path that would not resolve.
 */
export function coverFromTemplate(template, { title = "", subtitle = "", author = "", origin = "" } = {}) {
  const clean = (s) => String(s || "").trim();
  const untitled = !clean(title) || clean(title) === "Untitled book";
  return {
    concept_name: template.name,
    rationale: `${template.blurb} Started from the "${template.name}" template.`,
    genre_signals: template.genres.slice(0, 4),
    palette: paletteRows(template.palette),
    layout: { ...template.layout },
    title_text: untitled ? null : clean(title).slice(0, 300),
    subtitle_text: clean(subtitle).slice(0, 300) || null,
    author_text: clean(author).slice(0, 200) || null,
    image_url: origin ? `${String(origin).replace(/\/$/, "")}${template.image}` : null,
    is_selected: false,
  };
}
