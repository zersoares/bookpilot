// Drawn figures.
//
// The Visual Director sorts every figure into one of two kinds. These
// are the drawn ones: diagrams, processes, timelines, comparisons,
// tables, checklists, quote cards and chapter openers, built from
// structured data into vector drawing operations.
//
// They matter more than they look like they should. A figure that is
// drawn rather than rendered is resolution-independent, readable in
// greyscale, searchable in the PDF, described in the EPUB, and — the
// part that decides whether a book ships — available without an image
// provider. Most non-fiction figures are of this kind.
//
// An imaged figure with nothing to show returns null and is left out of
// the book. Nothing here draws a grey box labelled "image".

import { fontName, textWidth } from "./metrics.js";

const DRAWN = new Set([
  "diagram", "process", "timeline", "comparison", "table",
  "checklist", "quote_card", "chapter_opener",
]);

export function isDrawn(kind) {
  return DRAWN.has(kind);
}

/**
 * Lay out a figure.
 *
 * @returns {{height:number, ops:Array}|null} ops are in a local
 *   coordinate system whose origin is the figure's top-left.
 */
export function figureFor(visual, { width, theme }) {
  if (!visual) return null;

  // A supplied image is embedded as an image op; the PDF writer decides
  // whether it can actually carry the bytes.
  if (visual.image && visual.image.data) {
    return imageFigure(visual, { width, theme });
  }

  if (!isDrawn(visual.kind)) return null;

  const data = visual.data || {};
  const ctx = {
    width,
    theme,
    accent: theme.accentRgb,
    rule: [0.82, 0.81, 0.78],
    tint: [0.972, 0.968, 0.958],
    muted: [0.42, 0.42, 0.42],
    ink: [0.1, 0.1, 0.12],
    label: fontName(theme.heading, { bold: true }),
    labelSize: theme.type.caption,
    body: fontName(theme.body, {}),
    bodySize: theme.type.container,
    lead: theme.type.container * 1.34,
  };

  switch (visual.kind) {
    case "process":
    case "diagram":
      return stepsFigure(visual, ctx, { arrows: visual.kind === "process" });
    case "timeline":
      return timelineFigure(visual, ctx);
    case "comparison":
    case "table":
      return tableFigure(visual, ctx);
    case "checklist":
      return checklistFigure(visual, ctx);
    case "quote_card":
      return quoteFigure(visual, ctx);
    case "chapter_opener":
      return openerFigure(visual, ctx);
    default:
      return null;
  }
  void data;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Wrap text to a width, returning lines. Figures set ragged-right. */
function wrap(text, font, size, width) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, font, size) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function textOps(lines, x, y, font, size, lead, color) {
  return lines.map((line, index) => ({
    op: "text", x, y: y + lead * (index + 0.75), font, size, text: line, color,
  }));
}

function titleOps(visual, ctx) {
  if (!visual.title) return { ops: [], height: 0 };
  const lines = wrap(visual.title, ctx.label, ctx.labelSize, ctx.width);
  const lead = ctx.labelSize * 1.35;
  return {
    ops: textOps(lines.map((l) => l.toUpperCase()), 0, 0, ctx.label, ctx.labelSize, lead, ctx.accent),
    height: lead * lines.length + ctx.labelSize * 0.7,
  };
}

// ---------------------------------------------------------------------
// Figure kinds
// ---------------------------------------------------------------------

/** A sequence of steps, or a set of related boxes. */
function stepsFigure(visual, ctx, { arrows }) {
  const items = (visual.data?.steps || visual.data?.nodes || []).slice(0, 8);
  if (!items.length) return null;

  const head = titleOps(visual, ctx);
  const ops = [...head.ops];
  let y = head.height;

  const numberWidth = arrows ? ctx.bodySize * 2.2 : 0;
  const gap = ctx.bodySize * 0.55;

  items.forEach((item, index) => {
    const labelLines = wrap(item.label, fontName(ctx.theme.body, { bold: true }), ctx.bodySize, ctx.width - numberWidth - ctx.bodySize * 2);
    const detailLines = item.detail
      ? wrap(item.detail, ctx.body, ctx.bodySize * 0.95, ctx.width - numberWidth - ctx.bodySize * 2)
      : [];
    const boxHeight = ctx.bodySize * 0.9
      + ctx.lead * labelLines.length
      + (detailLines.length ? ctx.lead * 0.92 * detailLines.length : 0)
      + ctx.bodySize * 0.9;

    ops.push({ op: "rect", x: 0, y, w: ctx.width, h: boxHeight, fill: ctx.tint });
    ops.push({ op: "rect", x: 0, y, w: 2.2, h: boxHeight, fill: ctx.accent });

    if (arrows) {
      ops.push({
        op: "text",
        x: ctx.bodySize * 0.9,
        y: y + ctx.bodySize * 0.9 + ctx.lead * 0.75,
        font: fontName(ctx.theme.heading, { bold: true }),
        size: ctx.bodySize * 1.15,
        text: String(index + 1),
        color: ctx.accent,
      });
    }

    const textX = ctx.bodySize * 0.9 + numberWidth;
    ops.push(...textOps(labelLines, textX, y + ctx.bodySize * 0.9,
      fontName(ctx.theme.body, { bold: true }), ctx.bodySize, ctx.lead, ctx.ink));
    if (detailLines.length) {
      ops.push(...textOps(detailLines, textX,
        y + ctx.bodySize * 0.9 + ctx.lead * labelLines.length,
        ctx.body, ctx.bodySize * 0.95, ctx.lead * 0.92, ctx.muted));
    }

    y += boxHeight;

    // The connector between steps, drawn as a short stem and a chevron
    // so it reads as a sequence rather than as a list.
    if (arrows && index < items.length - 1) {
      const midX = ctx.width / 2;
      ops.push({ op: "rect", x: midX - 0.6, y: y + gap * 0.2, w: 1.2, h: gap * 0.6, fill: ctx.rule });
      y += gap;
    } else if (index < items.length - 1) {
      y += gap * 0.55;
    }
  });

  return { height: y, ops };
}

/** Dated events down a rule. */
function timelineFigure(visual, ctx) {
  const items = (visual.data?.steps || []).slice(0, 10);
  if (!items.length) return null;

  const head = titleOps(visual, ctx);
  const ops = [...head.ops];
  let y = head.height;

  const whenWidth = Math.min(
    ctx.width * 0.26,
    Math.max(...items.map((i) => textWidth(i.when || "", ctx.label, ctx.labelSize))) + ctx.bodySize
  );
  const railX = whenWidth + ctx.bodySize * 0.9;
  const textX = railX + ctx.bodySize * 1.3;
  const top = y;

  items.forEach((item, index) => {
    const labelLines = wrap(item.label, fontName(ctx.theme.body, { bold: true }), ctx.bodySize, ctx.width - textX);
    const detailLines = item.detail ? wrap(item.detail, ctx.body, ctx.bodySize * 0.95, ctx.width - textX) : [];
    const blockHeight = ctx.lead * labelLines.length
      + (detailLines.length ? ctx.lead * 0.92 * detailLines.length : 0)
      + ctx.bodySize * 0.85;

    if (item.when) {
      ops.push({
        op: "text", x: 0, y: y + ctx.lead * 0.75,
        font: ctx.label, size: ctx.labelSize, text: item.when, color: ctx.accent,
      });
    }
    ops.push({ op: "rect", x: railX - 3, y: y + ctx.lead * 0.3, w: 6, h: 6, fill: ctx.accent });
    ops.push(...textOps(labelLines, textX, y, fontName(ctx.theme.body, { bold: true }), ctx.bodySize, ctx.lead, ctx.ink));
    if (detailLines.length) {
      ops.push(...textOps(detailLines, textX, y + ctx.lead * labelLines.length,
        ctx.body, ctx.bodySize * 0.95, ctx.lead * 0.92, ctx.muted));
    }
    y += blockHeight;
    void index;
  });

  // The rail is drawn last so it sits behind nothing and stops exactly
  // at the final marker rather than trailing into white space.
  ops.splice(head.ops.length, 0, {
    op: "rect", x: railX - 0.6, y: top + ctx.lead * 0.5, w: 1.2,
    h: Math.max(0, y - top - ctx.lead * 0.9), fill: ctx.rule,
  });

  return { height: y, ops };
}

/** A table, or a two-column comparison. */
function tableFigure(visual, ctx) {
  const columns = (visual.data?.columns || []).slice(0, 4);
  const rows = (visual.data?.rows || []).slice(0, 12);
  if (!rows.length) return null;

  const count = columns.length || Math.max(...rows.map((r) => (r.cells || []).length), 1);
  const colWidth = ctx.width / count;
  const pad = ctx.bodySize * 0.55;

  const head = titleOps(visual, ctx);
  const ops = [...head.ops];
  let y = head.height;

  if (columns.length) {
    const headLines = columns.map((c) => wrap(c, ctx.label, ctx.labelSize, colWidth - pad * 2));
    const headHeight = Math.max(...headLines.map((l) => l.length)) * ctx.labelSize * 1.3 + pad * 1.6;
    ops.push({ op: "rect", x: 0, y, w: ctx.width, h: headHeight, fill: ctx.accent });
    headLines.forEach((lines, index) => {
      ops.push(...textOps(lines.map((l) => l.toUpperCase()), index * colWidth + pad, y + pad * 0.5,
        ctx.label, ctx.labelSize, ctx.labelSize * 1.3, [1, 1, 1]));
    });
    y += headHeight;
  }

  rows.forEach((row, rowIndex) => {
    const cells = (row.cells || []).slice(0, count);
    const cellLines = [];
    for (let i = 0; i < count; i += 1) {
      cellLines.push(wrap(cells[i] || "", ctx.body, ctx.bodySize, colWidth - pad * 2));
    }
    const rowHeight = Math.max(...cellLines.map((l) => l.length)) * ctx.lead + pad * 1.4;
    if (rowIndex % 2 === 1) {
      ops.push({ op: "rect", x: 0, y, w: ctx.width, h: rowHeight, fill: ctx.tint });
    }
    cellLines.forEach((lines, index) => {
      const bold = index === 0 && count > 1;
      ops.push(...textOps(lines, index * colWidth + pad, y + pad * 0.35,
        bold ? fontName(ctx.theme.body, { bold: true }) : ctx.body, ctx.bodySize, ctx.lead, ctx.ink));
    });
    ops.push({ op: "rect", x: 0, y: y + rowHeight - 0.5, w: ctx.width, h: 0.5, fill: ctx.rule });
    y += rowHeight;
  });

  return { height: y, ops };
}

/** Items with a box to tick. */
function checklistFigure(visual, ctx) {
  const items = (visual.data?.items || []).slice(0, 14);
  if (!items.length) return null;

  const head = titleOps(visual, ctx);
  const ops = [...head.ops];
  let y = head.height + ctx.bodySize * 0.4;

  const boxSize = ctx.bodySize * 0.82;
  const textX = boxSize + ctx.bodySize * 0.8;

  for (const item of items) {
    const lines = wrap(item, ctx.body, ctx.bodySize, ctx.width - textX);
    ops.push({ op: "rect", x: 0, y: y + ctx.lead * 0.22, w: boxSize, h: boxSize, fill: [1, 1, 1] });
    ops.push({ op: "rect", x: 0, y: y + ctx.lead * 0.22, w: boxSize, h: 0.8, fill: ctx.accent });
    ops.push({ op: "rect", x: 0, y: y + ctx.lead * 0.22 + boxSize - 0.8, w: boxSize, h: 0.8, fill: ctx.accent });
    ops.push({ op: "rect", x: 0, y: y + ctx.lead * 0.22, w: 0.8, h: boxSize, fill: ctx.accent });
    ops.push({ op: "rect", x: boxSize - 0.8, y: y + ctx.lead * 0.22, w: 0.8, h: boxSize, fill: ctx.accent });
    ops.push(...textOps(lines, textX, y, ctx.body, ctx.bodySize, ctx.lead, ctx.ink));
    y += ctx.lead * lines.length + ctx.bodySize * 0.55;
  }

  return { height: y, ops };
}

/** A pull quote set as a card. */
function quoteFigure(visual, ctx) {
  const quote = visual.data?.quote;
  if (!quote) return null;

  const size = ctx.theme.type.quote * 1.15;
  const font = fontName(ctx.theme.heading, {});
  const inset = ctx.bodySize * 1.6;
  const lines = wrap(quote, font, size, ctx.width - inset * 2);
  const lead = size * 1.34;
  const attribution = visual.data?.attribution;
  const attrLines = attribution ? wrap(`— ${attribution}`, ctx.body, ctx.labelSize, ctx.width - inset * 2) : [];

  const height = inset + lead * lines.length
    + (attrLines.length ? ctx.labelSize * 1.4 * attrLines.length + ctx.bodySize * 0.6 : 0)
    + inset;

  const ops = [
    { op: "rect", x: 0, y: 0, w: ctx.width, h: height, fill: ctx.tint },
    { op: "rect", x: 0, y: 0, w: ctx.width, h: 2, fill: ctx.accent },
    ...textOps(lines, inset, inset * 0.6, font, size, lead, ctx.ink),
  ];
  if (attrLines.length) {
    ops.push(...textOps(attrLines, inset, inset * 0.6 + lead * lines.length + ctx.bodySize * 0.4,
      ctx.body, ctx.labelSize, ctx.labelSize * 1.4, ctx.muted));
  }
  return { height, ops };
}

/** The key points panel some themes set under a chapter title. */
function openerFigure(visual, ctx) {
  const items = (visual.data?.items || []).slice(0, 6);
  if (!items.length) return null;

  const ops = [];
  let y = 0;
  const label = visual.title || "In this chapter";
  ops.push({
    op: "text", x: 0, y: ctx.labelSize * 1.1,
    font: ctx.label, size: ctx.labelSize, text: label.toUpperCase(), color: ctx.accent,
  });
  y += ctx.labelSize * 2;
  ops.push({ op: "rect", x: 0, y: y - ctx.labelSize * 0.6, w: 34, h: 1, fill: ctx.accent });

  for (const item of items) {
    const lines = wrap(item, ctx.body, ctx.bodySize, ctx.width - ctx.bodySize);
    ops.push({ op: "rect", x: 0, y: y + ctx.lead * 0.45, w: 3, h: 3, fill: ctx.accent });
    ops.push(...textOps(lines, ctx.bodySize, y, ctx.body, ctx.bodySize, ctx.lead, ctx.muted));
    y += ctx.lead * lines.length + ctx.bodySize * 0.3;
  }
  return { height: y, ops };
}

/**
 * A supplied or generated image.
 *
 * The bytes are attached by the export pipeline (doc/images.js) only
 * when it could decode them. A figure whose image failed to decode never
 * reaches here, so there is no placeholder path.
 */
function imageFigure(visual, { width, theme }) {
  const image = visual.image;
  const ratio = image.height && image.width ? image.height / image.width : 0.66;
  const drawWidth = width;
  const drawHeight = Math.min(width * ratio, 520);
  return {
    height: drawHeight,
    ops: [{
      op: "image",
      x: 0,
      y: 0,
      w: drawWidth,
      h: drawHeight,
      ref: image.ref,
      alt: visual.alt_text || visual.title || "",
    }],
  };
  void theme;
}
