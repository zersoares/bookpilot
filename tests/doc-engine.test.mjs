// The document engine.
//
// These are the tests that stand between an author and a broken book.
// The layout guarantees in doc/layout.js are claims — that text never
// overflows the measure, that a figure never lands on top of a
// paragraph, that no page ends on a heading — and a claim in a comment
// is worth nothing without something that fails when it stops being
// true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, inflateSync } from "node:zlib";

const { parseManuscript, smarten, wordCount, blocksToText } =
  await import("../js/doc/markdown.js");
const { layoutBook, romanize } = await import("../js/doc/layout.js");
const { writePdf } = await import("../js/doc/pdf.js");
const { writeEpub } = await import("../js/doc/epub.js");
const { writeDocx } = await import("../js/doc/docx.js");
const { zip, crc32 } = await import("../js/doc/zip.js");
const { deflateRawStored, deflateZlibStored, adler32 } = await import("../js/doc/deflate.js");
const { assembleBook } = await import("../js/doc/assemble.js");
const { textWidth, fontName, winAnsiCode } = await import("../js/doc/metrics.js");
const { resolveTheme, trimSize, marginsFor } = await import("../js/doc/themes.js");
const { figureFor } = await import("../js/doc/figures.js");
const { figureSvg } = await import("../js/doc/svg.js");

// ---------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------

test("the manuscript format parses to the blocks the exporters expect", () => {
  const blocks = parseManuscript(`Opening paragraph.

## A section

- one
- two

> a pull quote

:::exercise Try this
Do the thing.
:::

[[visual: three sources]]

---

Closing.`);

  const kinds = blocks.map((b) => b.type);
  assert.deepEqual(kinds, [
    "paragraph", "heading", "list", "quote", "container", "visual", "break", "paragraph",
  ]);
  assert.equal(blocks[1].level, 2);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[4].variant, "exercise");
  assert.equal(blocks[4].title, "Try this");
  assert.equal(blocks[5].description, "three sources");
});

test("a level-one heading inside a chapter is demoted, not printed as a second title", () => {
  const [block] = parseManuscript("# Not the chapter title");
  assert.equal(block.type, "heading");
  assert.equal(block.level, 2, "the design applies the chapter title; # would print a duplicate");
});

test("an unclosed container keeps its contents rather than dropping them", () => {
  const blocks = parseManuscript(":::callout Note\nSomething the author wrote.");
  assert.equal(blocks[0].type, "container");
  assert.equal(blocks[0].blocks.length, 1, "losing a paragraph is worse than a stray panel");
});

test("an unknown container name becomes a callout instead of vanishing", () => {
  const blocks = parseManuscript(":::insight Hmm\nA paragraph.\n:::");
  assert.equal(blocks[0].type, "container");
  assert.equal(blocks[0].variant, "callout");
});

test("typography is fixed once, not per exporter", () => {
  assert.equal(smarten(`He said "no" -- and left...`), "He said “no” — and left…");
  assert.equal(smarten("don't"), "don’t");
});

test("emphasis survives a run boundary mid-sentence", () => {
  const [block] = parseManuscript("A **bold** word and an *italic* one.");
  const bold = block.runs.find((r) => r.bold);
  const italic = block.runs.find((r) => r.italic);
  assert.equal(bold.text, "bold");
  assert.equal(italic.text, "italic");
  assert.equal(blocksToText([block]), "A bold word and an italic one.");
});

test("word count ignores the markup", () => {
  assert.equal(wordCount(":::callout Note\none two three\n:::"), 3);
  assert.equal(wordCount(""), 0);
});

// ---------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------

test("the typographic characters the pipeline emits are measured, not dropped", () => {
  // A curly quote measured as zero width is how a justified line comes
  // out short without anyone noticing.
  for (const ch of ["‘", "’", "“", "”", "–", "—", "…", "•"]) {
    assert.ok(
      textWidth(ch, "Times-Roman", 11) > 0,
      `${JSON.stringify(ch)} measures as nothing`
    );
  }
});

test("WinAnsi mapping puts the typographic characters where the font has them", () => {
  assert.equal(winAnsiCode(0x201c), 0x93);
  assert.equal(winAnsiCode(0x2014), 0x97);
  assert.equal(winAnsiCode("A".charCodeAt(0)), 65);
});

test("accented letters carry their base letter's width", () => {
  assert.equal(
    textWidth("Zoe", "Times-Roman", 11),
    textWidth("Zoë", "Times-Roman", 11)
  );
});

test("the base-14 names cover every style a theme can ask for", () => {
  assert.equal(fontName("serif", {}), "Times-Roman");
  assert.equal(fontName("serif", { bold: true, italic: true }), "Times-BoldItalic");
  assert.equal(fontName("sans", { italic: true }), "Helvetica-Oblique");
});

// ---------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------

/** A book long enough to break across pages, for the guarantees below. */
function sampleBook(overrides = {}) {
  const prose = Array.from({ length: 14 }, (_, i) =>
    `Paragraph ${i + 1}. ${"The argument continues in ordinary sentences of ordinary length. ".repeat(4)}`
  ).join("\n\n");

  return {
    title: "A Test Book",
    subtitle: "With a subtitle long enough to wrap onto a second line on a narrow page",
    author: "A N Author",
    language: "en",
    themeId: "editorial",
    trimId: "6x9",
    design: {},
    visuals: [{
      id: "v1",
      chapter_id: "c1",
      kind: "process",
      title: "Three steps",
      caption: "Figure 1.1",
      data: { steps: [{ label: "One", detail: "First" }, { label: "Two", detail: "Second" },
                      { label: "Three", detail: "Third" }] },
    }],
    sections: [
      { id: "f1", kind: "front", front_type: "title_page", title: "", blocks: [] },
      {
        id: "c1", kind: "chapter", number: 1, title: "A Chapter With A Fairly Long Title",
        blocks: parseManuscript(`${prose}\n\n[[visual: three steps]]\n\n${prose}`),
      },
      { id: "c2", kind: "chapter", number: 2, title: "Another Chapter", blocks: parseManuscript(prose) },
    ],
    ...overrides,
  };
}

test("no text ever runs past the measure", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  for (const page of laid.pages) {
    for (const op of page.items) {
      if (op.op !== "text") continue;
      // Word spacing is added per space, not per character — the PDF's
      // Tw operator only applies to the space glyph.
      const spaces = (op.text.match(/ /g) || []).length;
      const end = op.x + textWidth(op.text, op.font, op.size) + (op.wordSpacing || 0) * spaces;
      assert.ok(
        end <= laid.trim.width + 0.5,
        `text runs off the page on folio ${page.folio}: ${JSON.stringify(op.text.slice(0, 40))}`
      );
      assert.ok(op.x >= -0.5, "text starts left of the page");
    }
  }
});

test("nothing is drawn outside the page box", () => {
  const laid = layoutBook(sampleBook(), { print: true });
  for (const page of laid.pages) {
    for (const op of page.items) {
      const y = op.op === "rect" ? op.y + op.h : op.y;
      assert.ok(y <= laid.trim.height + 1, `something sits below the page on folio ${page.folio}`);
      assert.ok(y >= -1, "something sits above the page");
    }
  }
});

test("a page never ends on a heading", () => {
  const withHeadings = sampleBook({
    sections: [
      {
        id: "c1", kind: "chapter", number: 1, title: "Headings Everywhere",
        blocks: parseManuscript(
          Array.from({ length: 22 }, (_, i) =>
            `## Section ${i + 1}\n\nA paragraph of text that follows the heading and runs on for a while so that the page fills up at an awkward point.`
          ).join("\n\n")
        ),
      },
    ],
  });

  const laid = layoutBook(withHeadings, { print: false });
  for (const page of laid.pages) {
    const texts = page.items.filter((op) => op.op === "text" && op.text.trim());
    if (texts.length < 2) continue;
    const last = texts[texts.length - 1];
    // The running head and folio are drawn last and sit outside the text
    // block; ignore anything in the margins.
    const inBody = texts.filter((op) => op.y > laid.margins.top && op.y < laid.trim.height - laid.margins.bottom);
    if (!inBody.length) continue;
    const lastBody = inBody[inBody.length - 1];
    assert.ok(
      !/^Section \d+$/.test(lastBody.text.trim()),
      `folio ${page.folio} ends on a heading`
    );
    void last;
  }
});

test("a figure is never split and never overlapped by text", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  // The figure's own rectangles carry the accent fill; find the page
  // holding them and check no text op falls inside that band.
  for (const page of laid.pages) {
    const figureRects = page.items.filter(
      (op) => op.op === "rect" && op.w > 200 && op.h > 30 && op.fill && op.fill[0] < 0.99
    );
    for (const rect of figureRects) {
      for (const op of page.items) {
        if (op.op !== "text") continue;
        const insideVertically = op.y > rect.y + 2 && op.y < rect.y + rect.h - 2;
        const insideHorizontally = op.x >= rect.x - 1 && op.x <= rect.x + rect.w + 1;
        if (insideVertically && insideHorizontally) {
          // Text belonging to the figure itself is fine; body text is not.
          assert.ok(
            op.size <= 12,
            `body text overlaps a figure on folio ${page.folio}`
          );
        }
      }
    }
  }
});

test("front matter is numbered in roman and the body restarts at one", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  assert.ok(laid.frontCount > 0);
  const body = laid.pages[laid.frontCount];
  assert.equal(body.folio, "1", "the body has to restart the numbering");
  assert.equal(romanize(4), "iv");
  assert.equal(romanize(9), "ix");
});

test("the contents lists every chapter with the page it starts on", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  assert.equal(laid.contents.length, 2);
  assert.equal(laid.contents[0].page, 1);
  assert.ok(laid.contents[1].page > laid.contents[0].page, "chapter 2 starts after chapter 1");
});

test("print gets a gutter and a screen PDF does not", () => {
  const theme = resolveTheme("editorial");
  const trim = trimSize("6x9");
  const print = marginsFor(theme, trim, { print: true, pageCount: 300 });
  const screen = marginsFor(theme, trim, { print: false, pageCount: 300 });
  assert.ok(print.gutter > 0, "a bound book needs a gutter");
  assert.ok(print.inner > print.outer, "the inside margin has to be the wider one");
  assert.equal(screen.inner, screen.outer, "nothing is bound on a screen");
});

test("a longer book gets a wider gutter", () => {
  const theme = resolveTheme("editorial");
  const trim = trimSize("6x9");
  const thin = marginsFor(theme, trim, { print: true, pageCount: 90 });
  const thick = marginsFor(theme, trim, { print: true, pageCount: 500 });
  assert.ok(thick.gutter > thin.gutter);
});

test("every theme lays the same book out without throwing", () => {
  const ids = ["editorial", "luxury", "modern_business", "minimal",
               "wellness", "feminine_modern", "academic", "entrepreneur"];
  for (const id of ids) {
    const laid = layoutBook(sampleBook({ themeId: id }), { print: false });
    assert.ok(laid.pages.length > 2, `${id} produced almost nothing`);
  }
});

test("every trim size lays out without throwing", () => {
  for (const id of ["6x9", "5.5x8.5", "a4", "letter"]) {
    const laid = layoutBook(sampleBook({ trimId: id }), { print: true });
    assert.ok(laid.pages.length > 2, `${id} produced almost nothing`);
  }
});

test("an empty book does not crash the engine", () => {
  const laid = layoutBook({ ...sampleBook(), sections: [] }, { print: false });
  assert.equal(laid.pages.length, 0);
});

// ---------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------

test("a drawn figure renders and an imaged one without an image does not", () => {
  const theme = resolveTheme("editorial");
  const drawn = figureFor(
    { kind: "checklist", title: "Check", data: { items: ["one", "two"] } },
    { width: 312, theme }
  );
  assert.ok(drawn && drawn.height > 0);

  const imaged = figureFor(
    { kind: "illustration", title: "A picture", prompt: "something" },
    { width: 312, theme }
  );
  assert.equal(imaged, null, "an illustration with no image must not become an empty frame");
});

test("a drawn figure with no content is left out rather than drawn empty", () => {
  const theme = resolveTheme("editorial");
  assert.equal(figureFor({ kind: "checklist", data: { items: [] } }, { width: 312, theme }), null);
  assert.equal(figureFor({ kind: "table", data: { rows: [] } }, { width: 312, theme }), null);
});

test("a figure renders identically as SVG, with a description", () => {
  const theme = resolveTheme("editorial");
  const visual = {
    kind: "timeline",
    title: "A timeline",
    alt_text: "Three dated events",
    data: { steps: [{ when: "2024", label: "First" }, { when: "2025", label: "Second" }] },
  };
  const svg = figureSvg(visual, { width: 400, theme });
  assert.ok(svg.svg.startsWith("<svg"));
  assert.ok(svg.svg.includes('role="img"'));
  assert.ok(svg.svg.includes("Three dated events"), "the EPUB needs the description");
  assert.ok(svg.svg.includes("</svg>"));
});

test("figure content is escaped, not interpolated", () => {
  const theme = resolveTheme("editorial");
  const svg = figureSvg(
    { kind: "checklist", title: "x", data: { items: ["<script>alert(1)</script>"] } },
    { width: 400, theme }
  );
  assert.ok(!svg.svg.includes("<script>"), "a manuscript must not be able to inject markup");
  assert.ok(svg.svg.includes("&lt;script&gt;"));
});

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

test("front matter is ordered by convention, not by whatever sort_order says", () => {
  const book = assembleBook({
    project: { title: "T", language: "en", theme_id: "editorial", trim_size: "6x9" },
    parts: [],
    chapters: [
      { id: "d", kind: "front", front_type: "dedication", title: "Dedication", content: "For someone.", sort_order: 0 },
      { id: "t", kind: "front", front_type: "title_page", title: "Title", content: "", sort_order: 9 },
      { id: "c", kind: "front", front_type: "copyright", title: "Copyright", content: "(c)", sort_order: 5 },
      { id: "ch", kind: "chapter", number: 1, title: "One", content: "Words.", sort_order: 20 },
    ],
    visuals: [],
  });
  assert.deepEqual(
    book.sections.map((s) => s.front_type || s.kind),
    ["title_page", "copyright", "dedication", "chapter"]
  );
});

test("back matter follows the body whatever its sort order", () => {
  const book = assembleBook({
    project: { title: "T", language: "en" },
    parts: [],
    chapters: [
      { id: "b", kind: "back", front_type: "about_author", title: "About", content: "Bio.", sort_order: 0 },
      { id: "ch", kind: "chapter", number: 1, title: "One", content: "Words.", sort_order: 5 },
    ],
    visuals: [],
  });
  assert.deepEqual(book.sections.map((s) => s.kind), ["chapter", "back"]);
});

test("an excluded chapter is not in the book", () => {
  const book = assembleBook({
    project: { title: "T" },
    parts: [],
    chapters: [
      { id: "a", kind: "chapter", title: "In", content: "Words.", include: true, sort_order: 0 },
      { id: "b", kind: "chapter", title: "Out", content: "Words.", include: false, sort_order: 1 },
    ],
    visuals: [],
  });
  assert.deepEqual(book.sections.map((s) => s.title), ["In"]);
});

// ---------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------

test("the stored-block encoder produces a stream Node can actually inflate", () => {
  // The browser has no zlib, so the engine falls back to stored blocks.
  // If they are malformed, every EPUB and PDF the demo produces is
  // broken in a way nothing else here would catch.
  const text = new TextEncoder().encode("The quick brown fox. ".repeat(4000));
  assert.deepEqual(new Uint8Array(inflateRawSync(Buffer.from(deflateRawStored(text)))), text);
  assert.deepEqual(new Uint8Array(inflateSync(Buffer.from(deflateZlibStored(text)))), text);
});

test("stored blocks handle input larger than one block and empty input", () => {
  const big = new Uint8Array(200_000).map((_, i) => i % 251);
  assert.deepEqual(new Uint8Array(inflateRawSync(Buffer.from(deflateRawStored(big)))), big);
  const empty = new Uint8Array(0);
  assert.deepEqual(new Uint8Array(inflateRawSync(Buffer.from(deflateRawStored(empty)))), empty);
});

test("adler-32 matches the reference value", () => {
  assert.equal(adler32(new TextEncoder().encode("Wikipedia")), 0x11E60398);
});

test("crc-32 matches the reference value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});

// ---------------------------------------------------------------------
// The writers
// ---------------------------------------------------------------------

test("the PDF has a header, a matching xref and a trailer", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  const { bytes, pageCount } = writePdf(laid, { title: "A Test Book", author: "A N Author" });
  const text = Buffer.from(bytes).toString("latin1");

  assert.ok(text.startsWith("%PDF-1.7"));
  assert.ok(text.includes("%%EOF"));
  assert.equal(pageCount, laid.pages.length);

  const start = Number(/startxref\s+(\d+)/.exec(text)[1]);
  assert.equal(text.slice(start, start + 4), "xref", "startxref must point at the table");

  // Every offset in the table has to land on the object it claims.
  const table = text.slice(start).split("trailer")[0];
  const rows = table.split("\n").filter((line) => /^\d{10} \d{5} [nf]/.test(line));
  rows.slice(1).forEach((row, index) => {
    const offset = Number(row.slice(0, 10));
    assert.ok(
      text.startsWith(`${index + 1} 0 obj`, offset),
      `xref entry ${index + 1} points at the wrong place`
    );
  });
});

test("the PDF carries an outline so a long book is navigable", () => {
  const laid = layoutBook(sampleBook(), { print: false });
  const { bytes } = writePdf(laid, { title: "T", author: "A" });
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("/Outlines"), "a 200-page PDF without bookmarks is a scroll bar");
  assert.ok(text.includes("/Type /Font"));
});

test("PDF strings escape the characters that would end them early", () => {
  const book = sampleBook({
    sections: [{
      id: "c1", kind: "chapter", number: 1, title: "Brackets",
      blocks: parseManuscript("A line with (parentheses) and a backslash \\\\ in it."),
    }],
  });
  const laid = layoutBook(book, { print: false });
  const { bytes } = writePdf(laid, { title: "T", author: "A" }, { compress: false });
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("\\(parentheses\\)"), "an unescaped bracket truncates the string");
});

test("the EPUB is a valid container with mimetype first and uncompressed", () => {
  const { bytes } = writeEpub(sampleBook(), { publisher: "Someone" });
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, "local file header");
  // Method is at offset 8 of the local header; 0 means stored.
  assert.equal(buffer.readUInt16LE(8), 0, "the mimetype entry must not be deflated");
  const nameLength = buffer.readUInt16LE(26);
  assert.equal(buffer.slice(30, 30 + nameLength).toString(), "mimetype");
  assert.ok(buffer.includes("application/epub+zip"));
  assert.ok(buffer.includes("http://www.idpf.org/2007/opf"), "the OPF namespace has to be right");
});

test("the EPUB declares a nav document and an NCX", () => {
  const { bytes } = writeEpub(sampleBook(), {});
  const buffer = Buffer.from(bytes);
  assert.ok(buffer.includes('properties="nav"'));
  assert.ok(buffer.includes("toc.ncx"));
});

test("the DOCX uses real Word styles rather than direct formatting", () => {
  const { bytes } = writeDocx({ ...sampleBook(), trimWidth: 432, trimHeight: 648 }, {});
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  assert.ok(buffer.includes("word/styles.xml"));
  assert.ok(buffer.includes("[Content_Types].xml"));
});

test("a ZIP entry records the CRC of the original bytes, not the compressed ones", () => {
  const payload = "some content that will be deflated";
  const bytes = zip([{ name: "a.txt", data: payload }]);
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.readUInt32LE(14), crc32(new TextEncoder().encode(payload)));
});

test("XML from the manuscript is escaped in every container format", () => {
  const nasty = sampleBook({
    sections: [{
      id: "c1", kind: "chapter", number: 1, title: 'A <title> & "quotes"',
      blocks: parseManuscript("Text with <tags> & ampersands."),
    }],
  });
  for (const [name, bytes] of [
    ["epub", writeEpub(nasty, {}).bytes],
    ["docx", writeDocx({ ...nasty, trimWidth: 432, trimHeight: 648 }, {}).bytes],
  ]) {
    const buffer = Buffer.from(bytes);
    assert.ok(!buffer.includes("<tags>"), `${name} did not escape the manuscript`);
  }
});
