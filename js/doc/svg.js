// Figures as SVG.
//
// The same drawing operations the PDF writer turns into page content,
// rendered as an SVG instead. That is what lets one figure definition
// appear identically in the print PDF, in the reflowable EPUB, in the
// HTML edition and on the card in the app where the author approves it.
//
// Browser-safe: no Node imports.

import { figureFor } from "./figures.js";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const n = (value) => Math.round(value * 100) / 100;

function color(rgb) {
  const [r, g, b] = rgb || [0.1, 0.1, 0.12];
  const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const FAMILY = {
  Times: "Georgia, 'Times New Roman', serif",
  Helvetica: "'Helvetica Neue', Arial, sans-serif",
};

function fontAttrs(font, size) {
  const family = font.startsWith("Times") ? FAMILY.Times : FAMILY.Helvetica;
  const weight = /Bold/.test(font) ? "700" : "400";
  const style = /Italic|Oblique/.test(font) ? "italic" : "normal";
  return `font-family="${family}" font-size="${n(size)}" font-weight="${weight}" font-style="${style}"`;
}

/**
 * Render a visual as a standalone SVG.
 *
 * @returns {{svg:string, height:number}|null} null when the figure has
 *   nothing to draw — an illustration with no image, for instance. The
 *   caller leaves it out rather than showing an empty frame.
 */
export function figureSvg(visual, { width = 480, theme, background = null } = {}) {
  const figure = figureFor(visual, { width, theme });
  if (!figure) return null;

  const body = figure.ops
    .map((op) => {
      if (op.op === "rect") {
        return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${color(op.fill)}"/>`;
      }
      if (op.op === "line") {
        return `<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${color(op.color)}" stroke-width="${n(op.width || 0.6)}"/>`;
      }
      if (op.op === "image") {
        return `<image x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" href="${escapeXml(op.src || "")}" preserveAspectRatio="xMidYMid slice"/>`;
      }
      if (op.op !== "text" || !op.text) return "";
      return `<text x="${n(op.x)}" y="${n(op.y)}" ${fontAttrs(op.font, op.size)} fill="${color(op.color)}" xml:space="preserve">${escapeXml(op.text)}</text>`;
    })
    .join("");

  const title = visual.title || visual.alt_text || "Figure";
  const description = visual.alt_text || visual.caption || title;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(figure.height)}" ` +
    `width="100%" role="img" aria-label="${escapeXml(description)}">` +
    `<title>${escapeXml(title)}</title>` +
    (background ? `<rect width="${n(width)}" height="${n(figure.height)}" fill="${background}"/>` : "") +
    body +
    `</svg>`;

  return { svg, height: figure.height };
}
