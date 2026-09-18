// The manuscript format.
//
// A deliberately small Markdown subset — the one stated to the writing
// agents in book-prompts.js — parsed into blocks that every exporter
// renders the same way. Small because every construct here has to work
// in a PDF page, an EPUB, a Word document and a web page: a format that
// sets beautifully in one and breaks in another is not a format a book
// can be written in.
//
// What it does NOT accept is as important: no HTML, no raw links, no
// images, no nested lists, no tables. An exporter never has to decide
// what to do with something it cannot lay out.

const CONTAINERS = {
  callout: "callout",
  note: "callout",
  exercise: "exercise",
  case: "case",
  checklist: "checklist",
  takeaways: "takeaways",
  key: "takeaways",
};

/**
 * Typographic cleanup.
 *
 * Straight quotes and double hyphens are what a keyboard produces and
 * what a model emits; a typeset page needs the real characters. Done
 * here, once, so the PDF, the EPUB and the Word file all carry the same
 * punctuation rather than three different conventions.
 */
export function smarten(text) {
  return String(text)
    .replace(/\.\.\./g, "…")
    // Em dash from --- and en dash from --, but never inside a word
    // where the author meant a minus sign.
    .replace(/(\s)---(\s)/g, "$1—$2")
    .replace(/(\w)---(\w)/g, "$1—$2")
    .replace(/(\s)--(\s)/g, "$1—$2")
    .replace(/(\d)\s*--\s*(\d)/g, "$1–$2")
    // Apostrophes before quotes, so "don't" doesn't become a close quote
    // followed by a word.
    .replace(/(\w)'(\w)/g, "$1’$2")
    .replace(/'(\d\d s)/g, "’$1")
    .replace(/"(\S)/g, "“$1")
    .replace(/"/g, "”")
    .replace(/(^|[\s(\[—])'/g, "$1‘")
    .replace(/'/g, "’");
}

/**
 * Inline emphasis. Returns runs: [{ text, bold, italic }].
 *
 * Bold before italic so **word** is not read as an italic asterisk.
 */
export function inlineRuns(text) {
  const runs = [];
  const source = smarten(text);
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) {
      runs.push({ text: source.slice(last, match.index), bold: false, italic: false });
    }
    if (match[2] !== undefined) {
      runs.push({ text: match[2], bold: true, italic: false });
    } else {
      runs.push({ text: match[4], bold: false, italic: true });
    }
    last = pattern.lastIndex;
  }
  if (last < source.length) {
    runs.push({ text: source.slice(last), bold: false, italic: false });
  }
  return runs.length ? runs : [{ text: "", bold: false, italic: false }];
}

/** Plain text of a run list — for the EPUB's alt text and for counting. */
export function runsText(runs) {
  return runs.map((r) => r.text).join("");
}

/**
 * Parse a manuscript into blocks.
 *
 * @returns {Array<object>} one of:
 *   { type: 'heading', level: 2|3, runs }
 *   { type: 'paragraph', runs }
 *   { type: 'quote', runs }
 *   { type: 'list', ordered: boolean, items: runs[] }
 *   { type: 'break' }
 *   { type: 'visual', description }
 *   { type: 'container', variant, title, blocks }
 */
export function parseManuscript(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  return parseLines(lines, 0, lines.length).blocks;
}

function parseLines(lines, start, end) {
  const blocks = [];
  let i = start;

  const flushParagraph = (buffer) => {
    if (!buffer.length) return;
    blocks.push({ type: "paragraph", runs: inlineRuns(buffer.join(" ")) });
    buffer.length = 0;
  };

  let paragraph = [];

  while (i < end) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }

    // Container open: ":::exercise Try this"
    const open = /^:::\s*([a-z]+)\s*(.*)$/i.exec(trimmed);
    if (open) {
      flushParagraph(paragraph);
      const variant = CONTAINERS[open[1].toLowerCase()];
      // An unknown container name is treated as a plain callout rather
      // than dropped: losing a paragraph of the author's book because a
      // model invented ":::insight" is the worse failure.
      const depth = findContainerEnd(lines, i + 1, end);
      const inner = parseLines(lines, i + 1, depth).blocks;
      blocks.push({
        type: "container",
        variant: variant || "callout",
        title: smarten(open[2].trim()),
        blocks: inner,
      });
      i = depth + 1;
      continue;
    }

    // Scene break
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      flushParagraph(paragraph);
      blocks.push({ type: "break" });
      i += 1;
      continue;
    }

    // Visual anchor: [[visual: a diagram of the three stages]]
    const visual = /^\[\[\s*visual\s*:?\s*(.*?)\s*\]\]$/i.exec(trimmed);
    if (visual) {
      flushParagraph(paragraph);
      blocks.push({ type: "visual", description: smarten(visual[1]) });
      i += 1;
      continue;
    }

    // Headings. A single # is promoted to a section heading: the chapter
    // title is applied by the design, so a level-1 heading inside a
    // chapter is always a mistake, and demoting it is kinder than
    // printing a second title.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph);
      const level = Math.min(3, Math.max(2, heading[1].length));
      blocks.push({ type: "heading", level, runs: inlineRuns(heading[2]) });
      i += 1;
      continue;
    }

    // Block quote, possibly several lines
    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraph);
      const buffer = [];
      while (i < end && /^>\s?/.test(lines[i].trim())) {
        buffer.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", runs: inlineRuns(buffer.join(" ")) });
      continue;
    }

    // Lists
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph(paragraph);
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items = [];
      while (i < end) {
        const candidate = lines[i].trim();
        const isOrdered = /^\d+[.)]\s+/.test(candidate);
        const isBullet = /^[-*+]\s+/.test(candidate);
        if (!candidate) {
          // A blank line inside a list ends it unless the next line
          // continues the same kind of list.
          const next = (lines[i + 1] || "").trim();
          if (!/^[-*+]\s+/.test(next) && !/^\d+[.)]\s+/.test(next)) break;
          i += 1;
          continue;
        }
        if (isOrdered !== ordered && (isOrdered || isBullet)) break;
        if (!isOrdered && !isBullet) {
          // A wrapped continuation line belongs to the previous item.
          if (!items.length) break;
          items[items.length - 1] += ` ${candidate}`;
          i += 1;
          continue;
        }
        items.push(candidate.replace(/^([-*+]|\d+[.)])\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items: items.map(inlineRuns) });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph(paragraph);
  return { blocks, next: i };
}

/** Index of the line closing the container opened before `from`. */
function findContainerEnd(lines, from, end) {
  let depth = 0;
  for (let i = from; i < end; i += 1) {
    const trimmed = lines[i].trim();
    if (/^:::\s*[a-z]+/i.test(trimmed)) depth += 1;
    else if (trimmed === ":::") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  // Unclosed container: treat the rest of the section as its body rather
  // than discarding it.
  return end;
}

/** Word count of a manuscript, ignoring the markup. */
export function wordCount(text) {
  const plain = String(text || "")
    .replace(/^:::.*$/gm, " ")
    .replace(/\[\[.*?\]\]/g, " ")
    .replace(/[#>*_`-]/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).length;
}

/** Flatten blocks to plain text — used by the quality checks. */
export function blocksToText(blocks) {
  const out = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "quote":
        out.push(runsText(block.runs));
        break;
      case "list":
        block.items.forEach((item) => out.push(runsText(item)));
        break;
      case "container":
        if (block.title) out.push(block.title);
        out.push(blocksToText(block.blocks));
        break;
      default:
        break;
    }
  }
  return out.join("\n");
}
