// The typesetting engine.
//
// Turns a book — front matter, chapters, figures, back matter — into
// positioned pages. Everything downstream (the PDF writer, the page
// previewer in the browser) draws what this produces; neither of them
// knows what a paragraph is.
//
// The output is deliberately device-independent: pages of drawing
// operations in a top-left coordinate system, in points. The PDF writer
// flips the axis; the previewer scales it.
//
// What this engine guarantees, because a book that breaks these is not
// publishable (spec 15):
//
//   * Text never overflows the measure. Lines are broken against the
//     same font metrics the reader will draw with, and a word longer
//     than the measure is broken rather than allowed to run off.
//   * Text never overlaps a figure. A figure that does not fit in the
//     remaining space moves to the next page whole.
//   * No widows and no orphans. A paragraph never leaves one line
//     behind at the foot of a page or carries one alone to the top.
//   * A heading never ends a page. It travels with the first lines of
//     what it introduces.

import { fontName, textWidth, verticalFor } from "./metrics.js";
import { resolveTheme, trimSize, marginsFor } from "./themes.js";
import { figureFor } from "./figures.js";

const MIN_LINES_AT_BREAK = 2; // widow and orphan control

// ---------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------

/**
 * Break a run list into lines that fit `width`.
 *
 * Greedy rather than optimal (Knuth-Plass): a first-fit line breaker
 * with justification is what a trade book actually needs, and an
 * optimal breaker without a hyphenation dictionary produces worse
 * rivers, not better ones.
 */
function breakLines(runs, width, { family, size, bold = false, italic = false, firstIndent = 0 }) {
  const tokens = [];
  for (const run of runs) {
    const font = fontName(family, { bold: bold || run.bold, italic: italic || run.italic });
    // Split keeping the spaces, so a run boundary inside a sentence does
    // not swallow the space between two words.
    const parts = String(run.text).split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      tokens.push({
        text: space ? " " : part,
        space,
        font,
        width: textWidth(space ? " " : part, font, size),
      });
    }
  }

  const lines = [];
  let current = [];
  let currentWidth = 0;
  let indent = firstIndent;

  const push = () => {
    // Drop a trailing space: it would push a justified line's last word
    // past the measure.
    while (current.length && current[current.length - 1].space) current.pop();
    lines.push({ tokens: current, width: currentWidth, indent });
    current = [];
    currentWidth = 0;
    indent = 0;
  };

  for (const token of tokens) {
    const available = width - indent;
    if (token.space && !current.length) continue; // no leading spaces

    if (currentWidth + token.width <= available || !current.length) {
      // A single word wider than the measure has to be broken, or it
      // runs off the page and the reader loses the end of it.
      if (!current.length && !token.space && token.width > available) {
        let rest = token.text;
        while (rest.length > 1 && textWidth(rest, token.font, size) > available) {
          let cut = rest.length - 1;
          while (cut > 1 && textWidth(`${rest.slice(0, cut)}-`, token.font, size) > available) cut -= 1;
          const head = `${rest.slice(0, cut)}-`;
          lines.push({
            tokens: [{ text: head, space: false, font: token.font, width: textWidth(head, token.font, size) }],
            width: textWidth(head, token.font, size),
            indent,
          });
          indent = 0;
          rest = rest.slice(cut);
        }
        current = [{ text: rest, space: false, font: token.font, width: textWidth(rest, token.font, size) }];
        currentWidth = current[0].width;
        continue;
      }
      current.push(token);
      currentWidth += token.width;
    } else {
      push();
      if (token.space) continue;
      current.push(token);
      currentWidth = token.width;
    }
  }
  if (current.length) push();

  // Recompute widths after trailing spaces were dropped.
  for (const line of lines) {
    line.width = line.tokens.reduce((sum, t) => sum + t.width, 0);
    line.spaces = line.tokens.filter((t) => t.space).length;
  }
  return lines;
}

/** Drawing ops for one line, justified or ragged. */
function drawLine(line, x, baseline, size, { justify = false, measure = 0, align = "left", color = null } = {}) {
  const ops = [];
  let wordSpacing = 0;
  let startX = x + line.indent;

  if (justify && line.spaces > 0) {
    const slack = measure - line.indent - line.width;
    // A line needing more than a third of its width in extra space is a
    // line that should stay ragged: forcing it produces the gaps that
    // make a page look broken.
    if (slack > 0 && slack < measure * 0.34) wordSpacing = slack / line.spaces;
  } else if (align === "center") {
    startX = x + (measure - line.width) / 2;
  } else if (align === "right") {
    startX = x + measure - line.width;
  }

  let cursor = startX;
  let buffer = null;
  for (const token of line.tokens) {
    if (!buffer || buffer.font !== token.font) {
      if (buffer) {
        ops.push({ op: "text", x: buffer.x, y: baseline, font: buffer.font, size, text: buffer.text, wordSpacing, color });
      }
      buffer = { x: cursor, font: token.font, text: "" };
    }
    buffer.text += token.text;
    cursor += token.width + (token.space ? wordSpacing : 0);
  }
  if (buffer && buffer.text) {
    ops.push({ op: "text", x: buffer.x, y: baseline, font: buffer.font, size, text: buffer.text, wordSpacing, color });
  }
  return ops;
}

// ---------------------------------------------------------------------
// Atoms — the things that get placed on a page
// ---------------------------------------------------------------------

/**
 * An atom is one vertically placeable unit: a line of text, a space, a
 * rule, a whole figure. Pagination only ever moves atoms, which is what
 * makes "a figure never overlaps text" structurally true rather than a
 * rule someone remembered to apply.
 */
function atom(height, render, extra = {}) {
  return { height, render, keepWithNext: false, group: null, ...extra };
}

function composeParagraph(runs, ctx, options = {}) {
  const {
    size = ctx.theme.type.body,
    family = ctx.theme.body,
    bold = false,
    italic = false,
    align = "left",
    justify = ctx.justify,
    indentFirst = 0,
    color = null,
    measure = ctx.measure,
    offsetX = 0,
    groupId = null,
  } = options;

  const lead = size * ctx.theme.leading;
  const lines = breakLines(runs, measure, { family, size, bold, italic, firstIndent: indentFirst });
  const ascender = verticalFor(fontName(family, { bold, italic })).ascender;

  return lines.map((line, index) =>
    atom(
      lead,
      (x, y) =>
        drawLine(line, x + offsetX, y + lead * 0.5 + (ascender * size) / 2 - size * 0.08, size, {
          justify: justify && index < lines.length - 1,
          measure,
          align,
          color,
        }),
      { group: groupId, groupIndex: index, groupSize: lines.length }
    )
  );
}

// A blank atom. Marked so pagination knows never to start a page
// with one.
const space = (height) => atom(height, () => [], { blank: true });

// ---------------------------------------------------------------------
// Blocks -> atoms
// ---------------------------------------------------------------------

let groupCounter = 0;

function composeBlocks(blocks, ctx, opts = {}) {
  const atoms = [];
  const measure = opts.measure ?? ctx.measure;
  const offsetX = opts.offsetX ?? 0;
  const theme = ctx.theme;
  let firstParagraph = opts.firstParagraph !== false;

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const size = block.level === 2 ? theme.type.h2 : theme.type.h3;
        atoms.push(space(block.level === 2 ? theme.space.beforeH2 : theme.space.beforeH3));
        const head = composeParagraph(block.runs, ctx, {
          size,
          family: theme.heading,
          bold: true,
          justify: false,
          measure,
          offsetX,
          groupId: `h${groupCounter += 1}`,
        });
        // A heading is never the last thing on a page.
        head.forEach((a) => { a.keepWithNext = true; });
        atoms.push(...head);
        // The gap under a heading travels with it, or a break can land
        // between the heading and its own white space.
        atoms.push({ ...space(block.level === 2 ? theme.space.afterH2 : theme.space.afterH3),
                     keepWithNext: true });
        firstParagraph = true;
        break;
      }

      case "paragraph": {
        if (!firstParagraph && theme.space.paragraph) atoms.push(space(theme.space.paragraph));
        atoms.push(...composeParagraph(block.runs, ctx, {
          measure,
          offsetX,
          // The first paragraph after a heading is never indented — the
          // heading has already signalled the break.
          indentFirst: firstParagraph ? 0 : theme.firstLineIndent || 0,
          groupId: `p${groupCounter += 1}`,
        }));
        firstParagraph = false;
        break;
      }

      case "quote": {
        atoms.push(space(theme.space.beforeQuote));
        const inset = theme.type.body * 1.6;
        const quoteAtoms = composeParagraph(block.runs, ctx, {
          size: theme.type.quote,
          family: theme.body,
          italic: true,
          justify: false,
          measure: measure - inset * 2,
          offsetX: offsetX + inset,
          color: theme.accentRgb,
          groupId: `q${groupCounter += 1}`,
        });
        // The accent rule beside a pull quote is drawn per line so it
        // survives the quote breaking across a page.
        atoms.push(...quoteAtoms.map((a) =>
          atom(a.height, (x, y) => [
            { op: "rect", x: x + offsetX + inset * 0.45, y, w: 1.2, h: a.height, fill: theme.accentRgb },
            ...a.render(x, y),
          ], { group: a.group, groupIndex: a.groupIndex, groupSize: a.groupSize })
        ));
        atoms.push(space(theme.space.beforeQuote));
        firstParagraph = true;
        break;
      }

      case "list": {
        atoms.push(space(theme.space.beforeList));
        const marker = theme.type.body * 1.5;
        block.items.forEach((item, index) => {
          const lines = composeParagraph(item, ctx, {
            justify: false,
            measure: measure - marker,
            offsetX: offsetX + marker,
            groupId: `li${groupCounter += 1}`,
          });
          const label = block.ordered ? `${index + 1}.` : "•";
          const labelFont = fontName(theme.body, {});
          if (lines.length) {
            const first = lines[0];
            lines[0] = atom(first.height, (x, y) => [
              {
                op: "text",
                x: x + offsetX + marker - textWidth(`${label} `, labelFont, theme.type.body),
                y: y + first.height * 0.5 + (verticalFor(labelFont).ascender * theme.type.body) / 2 - theme.type.body * 0.08,
                font: labelFont,
                size: theme.type.body,
                text: label,
                color: block.ordered ? theme.accentRgb : null,
              },
              ...first.render(x, y),
            ], { group: first.group, groupIndex: 0, groupSize: first.groupSize });
          }
          atoms.push(...lines);
          if (index < block.items.length - 1) atoms.push(space(theme.space.listItem));
        });
        atoms.push(space(theme.space.beforeList));
        firstParagraph = true;
        break;
      }

      case "break": {
        atoms.push(space(theme.space.break));
        atoms.push(atom(theme.type.body, (x, y) => [{
          op: "text",
          x: x + offsetX + measure / 2 - textWidth("• • •", fontName(theme.body, {}), theme.type.body) / 2,
          y: y + theme.type.body * 0.8,
          font: fontName(theme.body, {}),
          size: theme.type.body,
          text: "• • •",
          color: [0.55, 0.55, 0.55],
        }]));
        atoms.push(space(theme.space.break));
        firstParagraph = true;
        break;
      }

      case "container": {
        atoms.push(...composeContainer(block, ctx, { measure, offsetX }));
        firstParagraph = true;
        break;
      }

      case "visual": {
        const visual = ctx.takeVisual(block.description);
        if (visual) atoms.push(...composeFigure(visual, ctx, { measure, offsetX }));
        firstParagraph = true;
        break;
      }

      default:
        break;
    }
  }

  return atoms;
}

const CONTAINER_LABEL = {
  callout: "",
  exercise: "Exercise",
  case: "Case study",
  checklist: "Checklist",
  takeaways: "Key takeaways",
};

/**
 * A boxed panel — exercise, case study, checklist, takeaways.
 *
 * The panel's rule is drawn per atom rather than once around the whole
 * block, so a panel that has to break across a page keeps its left
 * marker on both halves instead of leaving an unexplained indent.
 */
function composeContainer(block, ctx, { measure, offsetX }) {
  const theme = ctx.theme;
  const pad = theme.space.containerPad;
  const innerMeasure = measure - pad * 2;
  const atoms = [];

  atoms.push(space(theme.space.container));

  const label = block.title || CONTAINER_LABEL[block.variant] || "";
  const inner = [];

  if (label) {
    inner.push(...composeParagraph([{ text: label.toUpperCase(), bold: true }], ctx, {
      size: theme.type.caption,
      family: theme.heading,
      bold: true,
      justify: false,
      measure: innerMeasure,
      offsetX: offsetX + pad,
      color: theme.accentRgb,
      groupId: `ct${groupCounter += 1}`,
    }));
    inner.push(space(theme.type.caption * 0.5));
  }

  inner.push(...composeBlocks(block.blocks, ctx, {
    measure: innerMeasure,
    offsetX: offsetX + pad,
    firstParagraph: true,
  }));

  const total = inner.reduce((sum, a) => sum + a.height, 0);
  const tint = block.variant === "callout" || block.variant === "takeaways";

  // Top and bottom padding are their own atoms so the panel's edges
  // land exactly where the background starts and stops.
  const padded = [space(pad * 0.8), ...inner, space(pad * 0.8)];
  padded.forEach((a, index) => {
    const isFirst = index === 0;
    const isLast = index === padded.length - 1;
    atoms.push(atom(a.height, (x, y) => [
      tint
        ? { op: "rect", x: x + offsetX, y, w: measure, h: a.height, fill: [0.97, 0.965, 0.95] }
        : null,
      { op: "rect", x: x + offsetX, y, w: 2, h: a.height, fill: theme.accentRgb },
      isFirst ? { op: "rect", x: x + offsetX, y, w: measure, h: 0.6, fill: [0.86, 0.85, 0.82] } : null,
      isLast ? { op: "rect", x: x + offsetX, y: y + a.height - 0.6, w: measure, h: 0.6, fill: [0.86, 0.85, 0.82] } : null,
      ...a.render(x, y),
    ].filter(Boolean), { group: a.group, groupIndex: a.groupIndex, groupSize: a.groupSize }));
  });

  atoms.push(space(theme.space.container));
  void total;
  return atoms;
}

/**
 * A figure.
 *
 * Figures are atomic: one atom carrying the whole drawing. That is what
 * makes it impossible for text to be set on top of one — a figure that
 * does not fit in what is left of the page cannot be split, so it moves
 * down whole.
 */
function composeFigure(visual, ctx, { measure, offsetX }) {
  const theme = ctx.theme;
  const figure = figureFor(visual, { width: measure, theme });
  if (!figure) return [];

  const atoms = [space(theme.space.visual)];
  atoms.push(atom(figure.height, (x, y) =>
    figure.ops.map((op) => shiftOp(op, x + offsetX, y))
  ));

  if (visual.caption) {
    atoms.push(space(theme.space.caption));
    atoms.push(...composeParagraph([{ text: visual.caption }], ctx, {
      size: theme.type.caption,
      family: theme.heading,
      justify: false,
      measure,
      offsetX,
      color: [0.42, 0.42, 0.42],
      groupId: `cap${groupCounter += 1}`,
    }));
  }
  atoms.push(space(theme.space.visual));
  return atoms;
}

function shiftOp(op, dx, dy) {
  if (op.op === "text") return { ...op, x: op.x + dx, y: op.y + dy };
  if (op.op === "rect") return { ...op, x: op.x + dx, y: op.y + dy };
  if (op.op === "line") return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
  return op;
}

// ---------------------------------------------------------------------
// Chapter openers
// ---------------------------------------------------------------------

function composeChapterOpener(section, ctx) {
  const theme = ctx.theme;
  const atoms = [];
  const measure = ctx.measure;
  const centred = theme.chapterStyle === "display" || theme.chapterStyle === "rule";
  const align = centred ? "center" : "left";

  // The opener sits a third of the way down the page — the classic
  // "sink" — rather than at the top margin.
  const sink = ctx.contentHeight * (theme.chapterStyle === "band" ? 0.06 : 0.2);
  atoms.push(space(sink));

  const numberText = section.number ? `${section.number}` : "";

  if (theme.chapterStyle === "band" && numberText) {
    const bandHeight = theme.type.chapterNumber * 1.5;
    atoms.push(atom(bandHeight, (x, y) => [
      { op: "rect", x, y, w: measure, h: bandHeight, fill: theme.accentRgb },
      {
        op: "text",
        x: x + theme.type.body,
        y: y + bandHeight * 0.72,
        font: fontName(theme.heading, { bold: true }),
        size: theme.type.chapterNumber,
        text: numberText,
        color: [1, 1, 1],
      },
    ]));
    atoms.push(space(theme.type.body * 1.6));
  } else if (numberText) {
    const label = theme.chapterStyle === "numbered"
      ? `Chapter ${numberText}`
      : numberText;
    atoms.push(...composeParagraph([{ text: label }], ctx, {
      size: theme.chapterStyle === "numbered" ? theme.type.runningHead : theme.type.chapterNumber,
      family: theme.heading,
      bold: theme.chapterStyle !== "numbered",
      justify: false,
      align,
      color: theme.accentRgb,
    }));
    atoms.push(space(theme.type.body * 0.9));
  }

  if (theme.chapterStyle === "rule") {
    atoms.push(atom(theme.type.body, (x, y) => [
      { op: "rect", x: x + measure / 2 - 26, y: y + theme.type.body / 2, w: 52, h: 0.8, fill: theme.accentRgb },
    ]));
    atoms.push(space(theme.type.body));
  }

  const titleAtoms = composeParagraph([{ text: section.title }], ctx, {
    size: theme.type.chapterTitle,
    family: theme.heading,
    bold: theme.chapterStyle !== "display",
    justify: false,
    align,
  });
  titleAtoms.forEach((a) => { a.keepWithNext = true; });
  atoms.push(...titleAtoms);

  if (section.subtitle) {
    atoms.push(space(theme.type.body * 0.5));
    const sub = composeParagraph([{ text: section.subtitle }], ctx, {
      size: theme.type.h3,
      family: theme.body,
      italic: true,
      justify: false,
      align,
      color: [0.38, 0.38, 0.38],
    });
    sub.forEach((a) => { a.keepWithNext = true; });
    atoms.push(...sub);
  }

  if (theme.accentRule) {
    atoms.push(space(theme.type.body));
    atoms.push(atom(2, (x, y) => [
      { op: "rect", x: centred ? x + measure / 2 - 20 : x, y, w: 40, h: 1.4, fill: theme.accentRgb },
    ]));
  }

  atoms.push(space(theme.type.body * 2.2));
  return atoms;
}

function composePartOpener(part, ctx) {
  const theme = ctx.theme;
  const atoms = [space(ctx.contentHeight * 0.32)];
  if (part.number) {
    atoms.push(...composeParagraph([{ text: `Part ${romanize(part.number)}` }], ctx, {
      size: theme.type.partNumber,
      family: theme.heading,
      bold: true,
      justify: false,
      align: "center",
      color: theme.accentRgb,
    }));
    atoms.push(space(theme.type.body));
  }
  atoms.push(...composeParagraph([{ text: part.title }], ctx, {
    size: theme.type.partTitle,
    family: theme.heading,
    justify: false,
    align: "center",
  }));
  if (part.purpose) {
    atoms.push(space(theme.type.body * 1.4));
    atoms.push(...composeParagraph([{ text: part.purpose }], ctx, {
      size: theme.type.h3,
      family: theme.body,
      italic: true,
      justify: false,
      align: "center",
      measure: ctx.measure * 0.72,
      offsetX: ctx.measure * 0.14,
      color: [0.4, 0.4, 0.4],
    }));
  }
  return atoms;
}

export function romanize(n) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
                 [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let value = Math.max(0, Math.floor(n));
  let out = "";
  for (const [amount, numeral] of table) {
    while (value >= amount) { out += numeral; value -= amount; }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------

/**
 * Fill pages with atoms, honouring widows, orphans and keep-with-next.
 *
 * The rule that does most of the work: before breaking, walk backwards
 * past anything that must not be left behind — a heading, or the first
 * lines of a paragraph whose remainder would be stranded — and break
 * there instead.
 */
/**
 * Where a page should break, given what is currently on it.
 *
 * Three rules, applied in order, each of which only ever moves the break
 * earlier — so the loop terminates and a page is never asked to hold
 * more than it can.
 */
function findBreak(placed) {
  let cut = placed.length;

  // The rules interact, so they are applied until none of them moves the
  // cut any further. Applying them once in sequence is not enough: the
  // orphan rule can push a paragraph's opening lines over, which leaves
  // the heading above them exposed again, and the first rule has already
  // run by then.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = cut;

    // 1. A heading, a chapter title, or the blank space that belongs to
    //    one never sits at the foot of a page with its material overleaf.
    while (cut > 0 && placed[cut - 1].atom.keepWithNext) cut -= 1;

    const last = cut > 0 ? placed[cut - 1].atom : null;
    if (last && last.group && last.groupSize > 1) {
      const carried = last.groupSize - 1 - last.groupIndex;

      // 2. A widow: the next page would open with fewer than two lines of
      //    this paragraph. Send enough lines over to make two.
      if (carried > 0 && carried < MIN_LINES_AT_BREAK) {
        const needed = MIN_LINES_AT_BREAK - carried;
        let back = cut;
        let moved = 0;
        while (back > 0 && moved < needed && placed[back - 1].atom.group === last.group) {
          back -= 1;
          moved += 1;
        }
        if (back > 0) cut = back;
      } else if (last.groupIndex + 1 < MIN_LINES_AT_BREAK && last.groupSize > MIN_LINES_AT_BREAK) {
        // 3. An orphan: this paragraph only just began at the foot of the
        //    page. Move the whole opening over.
        let back = cut;
        while (back > 0 && placed[back - 1].atom.group === last.group) back -= 1;
        if (back > 0) cut = back;
      }
    }

    if (cut === before) break;
  }

  // Never break to nothing: a page holding one very tall atom has to keep
  // it, or pagination would not advance.
  return cut > 0 ? cut : placed.length;
}

function paginate(atoms, ctx, pages, pageMaker) {
  let page = pageMaker();
  let placed = [];
  let y = 0;

  const commit = () => {
    for (const item of placed) {
      page.items.push(...item.atom.render(ctx.x, ctx.top + item.y));
    }
    if (page.items.length) pages.push(page);
    page = pageMaker();
    placed = [];
    y = 0;
  };

  const place = (a) => {
    // Spacing never starts a page: a chapter that broke after a heading
    // would otherwise open with an unexplained gap.
    if (!placed.length && a.blank) return;
    placed.push({ atom: a, y });
    y += a.height;
  };

  for (const a of atoms) {
    if (placed.length && y + a.height > ctx.contentHeight + 0.01) {
      const cut = findBreak(placed);
      const carried = placed.slice(cut);
      placed = placed.slice(0, cut);
      commit();
      for (const item of carried) place(item.atom);
    }
    place(a);
  }

  if (placed.length) {
    for (const item of placed) {
      page.items.push(...item.atom.render(ctx.x, ctx.top + item.y));
    }
    if (page.items.length) pages.push(page);
  }
}

// ---------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------

/**
 * Lay out a whole book.
 *
 * @param {object} book
 *   { title, subtitle, author, language, publisher, year, themeId,
 *     trimId, design, sections: [...], visuals: [...] }
 * @param {object} options { print: boolean, watermark: string|null }
 */
export function layoutBook(book, options = {}) {
  const print = Boolean(options.print);
  const theme = resolveTheme(book.themeId, book.design || {});
  const trim = trimSize(book.trimId);

  // Two passes: the first learns how long the book is, which decides the
  // gutter and the contents' own page numbers; the second sets it with
  // those known. A third pass would be chasing a tail.
  let result = compose(book, { theme, trim, print, pageCount: 240, watermark: options.watermark, contents: null });
  const contents = result.contents;
  result = compose(book, {
    theme, trim, print, pageCount: result.pages.length, watermark: options.watermark, contents,
  });

  return result;
}

function compose(book, { theme, trim, print, pageCount, watermark, contents }) {
  const margins = marginsFor(theme, trim, { print, pageCount });
  const contentHeight = trim.height - margins.top - margins.bottom;
  const measure = trim.width - margins.inner - margins.outer;

  const pages = [];
  const frontPages = [];
  const outline = [];
  const sections = book.sections || [];
  const visuals = new Map();
  for (const visual of book.visuals || []) {
    const key = (visual.title || visual.placement || visual.id || "").toLowerCase();
    if (!visuals.has(visual.chapter_id)) visuals.set(visual.chapter_id, []);
    visuals.get(visual.chapter_id).push({ ...visual, key });
  }

  const makeCtx = (chapterId) => {
    const pool = (visuals.get(chapterId) || []).filter((v) => !v.used);
    return {
      theme,
      measure,
      contentHeight,
      x: 0, // set per page side below
      top: 0,
      justify: true,
      takeVisual(description) {
        if (!pool.length) return null;
        const wanted = String(description || "").toLowerCase();
        let index = pool.findIndex((v) => wanted && v.key && (v.key.includes(wanted) || wanted.includes(v.key)));
        if (index < 0) index = 0;
        const [visual] = pool.splice(index, 1);
        visual.used = true;
        return visual;
      },
      leftovers: () => pool,
    };
  };

  // --- front matter -------------------------------------------------
  const frontSections = sections.filter((s) => s.kind === "front");
  const bodySections = sections.filter((s) => s.kind !== "front");

  const pageMaker = (bucket, kind) => () => ({
    items: [],
    kind,
    // Recto/verso decides which side the wider margin is on, and which
    // corner the folio sits in. Page one of the block is a recto.
    side: (bucket.length % 2 === 0) ? "recto" : "verso",
  });

  for (const section of frontSections) {
    const ctx = makeCtx(section.id);
    const startIndex = frontPages.length;
    const atoms = composeFrontSection(section, ctx, book, theme);
    const maker = () => ({ items: [], kind: "front", side: (frontPages.length % 2 === 0) ? "recto" : "verso" });
    layoutInto(frontPages, atoms, ctx, maker, margins, trim);
    // Front-matter sections each begin on a fresh page.
    void startIndex;
  }

  // --- the contents page needs the body's page numbers, so it is laid
  //     out from the previous pass's outline -------------------------
  let contentsPages = [];
  if (contents && contents.length) {
    const ctx = makeCtx(null);
    const atoms = composeContents(contents, ctx, theme);
    layoutInto(contentsPages, atoms, ctx, () =>
      ({ items: [], kind: "front", side: ((frontPages.length + contentsPages.length) % 2 === 0) ? "recto" : "verso" }),
      margins, trim);
  }

  const front = [...frontPages, ...contentsPages];

  // --- body ---------------------------------------------------------
  let lastPart = null;
  for (const section of bodySections) {
    const ctx = makeCtx(section.id);
    const atoms = [];

    if (section.part && section.part.id !== lastPart) {
      lastPart = section.part.id;
      const partPages = [];
      layoutInto(partPages, composePartOpener(section.part, ctx), ctx,
        () => ({ items: [], kind: "part", side: "recto" }), margins, trim);
      // A part title page is a recto with a blank verso behind it.
      if (print && (pages.length + front.length) % 2 === 1) pages.push({ items: [], kind: "blank", side: "verso" });
      pages.push(...partPages);
      if (print) pages.push({ items: [], kind: "blank", side: "verso" });
    }

    // Chapters open on a new page, and on a right-hand page in print.
    if (print && (pages.length + front.length) % 2 === 1) {
      pages.push({ items: [], kind: "blank", side: "verso" });
    }

    const startPage = pages.length + 1;
    atoms.push(...composeChapterOpener(section, ctx));
    atoms.push(...composeBlocks(section.blocks || [], ctx, { firstParagraph: true }));

    // Figures the manuscript never anchored still belong in the book.
    for (const orphanVisual of ctx.leftovers()) {
      atoms.push(...composeFigure(orphanVisual, ctx, { measure, offsetX: 0 }));
    }

    const sectionPages = [];
    layoutInto(sectionPages, atoms, ctx,
      () => ({ items: [], kind: section.kind, side: "recto" }), margins, trim);
    sectionPages.forEach((p, index) => {
      p.section = section.id;
      p.runningHead = index === 0 ? null : section.title;
      p.opener = index === 0;
    });
    pages.push(...sectionPages);

    outline.push({
      id: section.id,
      kind: section.kind,
      number: section.number,
      title: section.title,
      page: startPage,
      partTitle: section.part ? section.part.title : null,
      partId: section.part ? section.part.id : null,
    });
  }

  // --- decorate: folios, running heads, watermark --------------------
  decorate(front, pages, { theme, trim, margins, book, watermark, print });

  const all = [...front, ...pages];
  return {
    pages: all,
    frontCount: front.length,
    bodyCount: pages.length,
    outline,
    contents: outline.filter((o) => o.kind !== "front"),
    trim,
    theme,
    margins,
    measure,
  };
}

function layoutInto(bucket, atoms, ctx, maker, margins, trim) {
  const localCtx = {
    ...ctx,
    x: margins.inner,
    top: margins.top,
  };
  // The x origin depends on which side the page falls on, which is only
  // known once the page exists — so pagination writes into a local
  // bucket and the side-dependent shift is applied in decorate().
  paginate(atoms, localCtx, bucket, maker);
  void trim;
}

function composeFrontSection(section, ctx, book, theme) {
  const atoms = [];
  const type = section.front_type;

  if (type === "half_title") {
    atoms.push(space(ctx.contentHeight * 0.34));
    atoms.push(...composeParagraph([{ text: book.title }], ctx, {
      size: theme.type.frontTitle * 0.72, family: theme.heading, justify: false, align: "center",
    }));
    return atoms;
  }

  if (type === "title_page") {
    atoms.push(space(ctx.contentHeight * 0.22));
    atoms.push(...composeParagraph([{ text: book.title }], ctx, {
      size: theme.type.frontTitle, family: theme.heading, justify: false, align: "center",
    }));
    if (book.subtitle) {
      atoms.push(space(theme.type.body * 1.2));
      atoms.push(...composeParagraph([{ text: book.subtitle }], ctx, {
        size: theme.type.h2, family: theme.body, italic: true, justify: false, align: "center",
        color: [0.35, 0.35, 0.35],
      }));
    }
    atoms.push(space(ctx.contentHeight * 0.26));
    atoms.push(...composeParagraph([{ text: book.author || "" }], ctx, {
      size: theme.type.h2, family: theme.heading, justify: false, align: "center",
    }));
    if (book.publisher) {
      atoms.push(space(ctx.contentHeight * 0.12));
      atoms.push(...composeParagraph([{ text: book.publisher }], ctx, {
        size: theme.type.caption, family: theme.heading, justify: false, align: "center",
        color: [0.45, 0.45, 0.45],
      }));
    }
    return atoms;
  }

  // Copyright and the other prose front-matter pages set small and low.
  if (type === "copyright") {
    atoms.push(space(ctx.contentHeight * 0.42));
    atoms.push(...composeBlocks(section.blocks || [], {
      ...ctx,
      theme: { ...theme, type: { ...theme.type, body: theme.type.caption }, space: { ...theme.space, paragraph: theme.type.caption * 0.6 } },
      justify: false,
    }, { firstParagraph: true }));
    return atoms;
  }

  atoms.push(space(ctx.contentHeight * 0.16));
  if (section.title) {
    const head = composeParagraph([{ text: section.title }], ctx, {
      size: theme.type.chapterTitle * 0.8, family: theme.heading, justify: false,
      align: type === "dedication" || type === "epigraph" ? "center" : "left",
    });
    head.forEach((a) => { a.keepWithNext = true; });
    atoms.push(...head);
    atoms.push(space(theme.type.body * 1.6));
  }
  const centred = type === "dedication" || type === "epigraph";
  atoms.push(...composeBlocks(section.blocks || [], {
    ...ctx,
    justify: !centred,
  }, { firstParagraph: true }));
  return atoms;
}

function composeContents(entries, ctx, theme) {
  const atoms = [];
  atoms.push(space(ctx.contentHeight * 0.1));
  const head = composeParagraph([{ text: "Contents" }], ctx, {
    size: theme.type.chapterTitle * 0.8, family: theme.heading, justify: false,
  });
  head.forEach((a) => { a.keepWithNext = true; });
  atoms.push(...head);
  atoms.push(space(theme.type.body * 1.8));

  let currentPart = null;
  for (const entry of entries) {
    if (entry.partTitle && entry.partId !== currentPart) {
      currentPart = entry.partId;
      atoms.push(space(theme.type.body * 0.9));
      const part = composeParagraph([{ text: entry.partTitle.toUpperCase(), bold: true }], ctx, {
        size: theme.type.caption, family: theme.heading, bold: true, justify: false,
        color: theme.accentRgb,
      });
      part.forEach((a) => { a.keepWithNext = true; });
      atoms.push(...part);
      atoms.push(space(theme.type.body * 0.4));
    }

    const label = entry.number ? `${entry.number}.  ${entry.title}` : entry.title;
    const font = fontName(theme.body, {});
    const size = theme.type.body;
    const folio = String(entry.page);
    const folioWidth = textWidth(folio, font, size);
    const labelWidth = Math.min(textWidth(label, font, size), ctx.measure - folioWidth - 24);
    const lead = size * theme.leading * 1.18;

    atoms.push(atom(lead, (x, y) => {
      const baseline = y + lead * 0.72;
      const ops = [
        { op: "text", x, y: baseline, font, size, text: truncateTo(label, font, size, ctx.measure - folioWidth - 18) },
        { op: "text", x: x + ctx.measure - folioWidth, y: baseline, font, size, text: folio },
      ];
      // Leader dots, drawn as a rule of dots rather than a repeated
      // character so the spacing is even at any measure.
      const dotsFrom = x + labelWidth + 8;
      const dotsTo = x + ctx.measure - folioWidth - 8;
      for (let dx = dotsFrom; dx < dotsTo; dx += 4.6) {
        ops.push({ op: "rect", x: dx, y: baseline - size * 0.22, w: 0.9, h: 0.9, fill: [0.65, 0.65, 0.65] });
      }
      return ops;
    }));
  }
  return atoms;
}

function truncateTo(text, font, size, max) {
  if (textWidth(text, font, size) <= max) return text;
  let out = text;
  while (out.length > 4 && textWidth(`${out}…`, font, size) > max) out = out.slice(0, -1);
  return `${out}…`;
}

/**
 * Running heads, folios and the watermark.
 *
 * Conventions a reader notices only when they are wrong: no folio on a
 * blank page, no running head on a chapter opener, front matter in
 * roman numerals, the body restarting at 1.
 */
function decorate(front, body, { theme, trim, margins, book, watermark, print }) {
  const apply = (pages, numbering, offset) => {
    pages.forEach((page, index) => {
      const number = index + 1;
      const side = print ? (number + offset) % 2 === 1 ? "recto" : "verso" : "recto";
      page.side = side;
      const shift = print && side === "verso" ? margins.outer - margins.inner : 0;
      if (shift) {
        page.items = page.items.map((op) => shiftOp(op, shift, 0));
      }
      page.number = number;
      page.folio = numbering === "roman" ? romanize(number) : String(number);

      if (page.kind === "blank") return;

      const folioFont = fontName(theme.heading, {});
      const folioSize = theme.type.folio;
      const contentLeft = side === "verso" && print ? margins.outer : margins.inner;
      const contentRight = contentLeft + (trim.width - margins.inner - margins.outer);

      // Front matter carries no folio on its display pages.
      const showFolio = !(page.kind === "front" && (page.opener || index < 2)) && page.kind !== "part";
      if (showFolio) {
        const folioWidth = textWidth(page.folio, folioFont, folioSize);
        const x = theme.runningHead === "none"
          ? contentLeft + (contentRight - contentLeft - folioWidth) / 2
          : side === "verso" ? contentLeft : contentRight - folioWidth;
        page.items.push({
          op: "text", x, y: trim.height - margins.bottom * 0.45,
          font: folioFont, size: folioSize, text: page.folio, color: [0.42, 0.42, 0.42],
        });
      }

      if (page.runningHead && theme.runningHead !== "none") {
        const italic = theme.runningHead === "italic";
        const font = fontName(theme.heading, { italic });
        const size = theme.type.runningHead;
        const text = theme.runningHead === "smallcaps"
          ? page.runningHead.toUpperCase()
          : page.runningHead;
        const display = truncateTo(text, font, size, contentRight - contentLeft);
        const width = textWidth(display, font, size);
        page.items.push({
          op: "text",
          x: side === "verso" ? contentLeft : contentRight - width,
          y: margins.top * 0.55,
          font, size, text: display, color: [0.45, 0.45, 0.45],
        });
      }

      if (watermark) {
        const font = fontName("sans", { bold: true });
        const size = 9;
        const width = textWidth(watermark, font, size);
        page.items.push({
          op: "text",
          x: contentLeft + (contentRight - contentLeft - width) / 2,
          y: trim.height - margins.bottom * 0.18,
          font, size, text: watermark, color: [0.72, 0.72, 0.72],
        });
      }
    });
  };

  apply(front, "roman", 0);
  apply(body, "arabic", front.length);
  void book;
}
