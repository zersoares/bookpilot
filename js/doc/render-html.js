// The page previewer.
//
// Renders laid-out pages as HTML. Same input as the PDF writer — the
// output of doc/layout.js — so the preview in the app is not an
// approximation of the printed page, it is the same page drawn with a
// different pen. A book that looks right in the previewer prints right,
// which is the only useful definition of a preview.
//
// The type is set in Times New Roman and Arial because those are
// metrically compatible with the PDF base-14 faces the exporter writes.
// Substituting a prettier webfont here would put the preview and the
// print out of step by a few points per line, which is exactly the class
// of bug a previewer exists to catch.

import { verticalFor } from "./metrics.js";

// Single quotes, not double: these go into a style="" attribute, and a
// double quote there ends the attribute — which silently drops every
// declaration after font-family and renders the whole book in the
// fallback face at the fallback size.
const CSS_FAMILY = {
  "Times-Roman": ["'Times New Roman'", "Times", "serif"],
  "Times-Bold": ["'Times New Roman'", "Times", "serif"],
  "Times-Italic": ["'Times New Roman'", "Times", "serif"],
  "Times-BoldItalic": ["'Times New Roman'", "Times", "serif"],
  Helvetica: ["Helvetica", "Arial", "sans-serif"],
  "Helvetica-Bold": ["Helvetica", "Arial", "sans-serif"],
  "Helvetica-Oblique": ["Helvetica", "Arial", "sans-serif"],
  "Helvetica-BoldOblique": ["Helvetica", "Arial", "sans-serif"],
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const pt = (n) => `${Math.round(n * 100) / 100}pt`;

function colorOf(rgb) {
  const [r, g, b] = rgb || [0.1, 0.1, 0.12];
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function opHtml(op) {
  if (op.op === "rect") {
    return `<div style="position:absolute;left:${pt(op.x)};top:${pt(op.y)};width:${pt(op.w)};height:${pt(op.h)};background:${colorOf(op.fill)}"></div>`;
  }
  if (op.op === "line") {
    const width = Math.abs(op.x2 - op.x1);
    const height = Math.max(op.width || 0.6, Math.abs(op.y2 - op.y1));
    return `<div style="position:absolute;left:${pt(Math.min(op.x1, op.x2))};top:${pt(Math.min(op.y1, op.y2))};width:${pt(width)};height:${pt(height)};background:${colorOf(op.color)}"></div>`;
  }
  if (op.op === "image") {
    return `<img src="${escapeHtml(op.src || "")}" alt="${escapeHtml(op.alt || "")}" style="position:absolute;left:${pt(op.x)};top:${pt(op.y)};width:${pt(op.w)};height:${pt(op.h)};object-fit:cover">`;
  }
  if (op.op !== "text" || !op.text) return "";

  const family = (CSS_FAMILY[op.font] || CSS_FAMILY["Times-Roman"]).join(",");
  const bold = /Bold/.test(op.font);
  const italic = /Italic|Oblique/.test(op.font);
  // The op carries a baseline; CSS positions a box. Offsetting by the
  // face's ascender puts the glyphs where the PDF will put them.
  const top = op.y - verticalFor(op.font).ascender * op.size;
  const styles = [
    "position:absolute",
    `left:${pt(op.x)}`,
    `top:${pt(top)}`,
    `font-family:${family}`,
    `font-size:${pt(op.size)}`,
    "line-height:1",
    "white-space:pre",
    `color:${colorOf(op.color)}`,
    bold ? "font-weight:700" : "font-weight:400",
    italic ? "font-style:italic" : "",
    op.wordSpacing ? `word-spacing:${pt(op.wordSpacing)}` : "",
  ].filter(Boolean);
  return `<span style="${styles.join(";")}">${escapeHtml(op.text)}</span>`;
}

/**
 * One page as HTML.
 *
 * @param {object} page   a page from layoutBook()
 * @param {object} trim   { width, height } in points
 * @param {object} options { scale, className, label }
 */
export function renderPage(page, trim, { scale = 1, className = "", label = "" } = {}) {
  const inner = page.items.map(opHtml).join("");
  return `<div class="bb-page ${className}" data-page="${escapeHtml(page.folio || "")}" ${
    label ? `aria-label="${escapeHtml(label)}"` : ""
  } style="position:relative;width:${pt(trim.width)};height:${pt(trim.height)};background:#fff;overflow:hidden;${
    scale === 1 ? "" : `transform:scale(${scale});transform-origin:top left;`
  }">${inner}</div>`;
}

/** Every page, in order. */
export function renderPages(laid, options = {}) {
  return laid.pages
    .map((page, index) =>
      renderPage(page, laid.trim, { ...options, label: `Page ${page.folio || index + 1}` })
    )
    .join("");
}

/**
 * A complete standalone HTML document of the laid-out book.
 *
 * Used by the HTML export (spec 23) and by the print preview. It is a
 * facsimile: the pages are the pages, not a reflowed web version.
 */
export function renderDocument(laid, meta = {}) {
  const pages = laid.pages
    .map((page, index) => renderPage(page, laid.trim, { label: `Page ${page.folio || index + 1}` }))
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(meta.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title || "Book")}</title>
<meta name="author" content="${escapeHtml(meta.author || "")}">
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 24px 12px 48px;
    background: #e9e7e2;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .bb-book { display: flex; flex-direction: column; align-items: center; gap: 22px; }
  .bb-page {
    box-shadow: 0 2px 6px rgba(0,0,0,.09), 0 16px 34px -18px rgba(0,0,0,.35);
    /* Points are a real CSS unit, so a page declared in points is the
       size it will print at — at 100% zoom on a 96dpi screen. */
  }
  @media print {
    body { background: #fff; padding: 0; }
    .bb-book { gap: 0; }
    .bb-page { box-shadow: none; page-break-after: always; break-after: page; }
    @page { margin: 0; size: ${Math.round(laid.trim.width)}pt ${Math.round(laid.trim.height)}pt; }
  }
</style>
</head>
<body>
<div class="bb-book">
${pages}
</div>
</body>
</html>`;
}
