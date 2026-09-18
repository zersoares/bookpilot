// DOCX export.
//
// The editable manuscript: what an author sends to a human editor, a
// proofreader or a publisher who asked for "the Word file". So it is
// built as a *manuscript*, with real Word styles an editor can restyle,
// not as a facsimile of the printed page.
//
// Styles rather than direct formatting is the whole point. A chapter
// heading is a Heading 1, so Word's navigation pane works, a table of
// contents can be generated, and an editor's house style applies in one
// click. Hard-coded 18pt bold text would look the same and be useless.
//
// Written as Office Open XML by hand. The parts below are the minimum a
// conforming reader needs; Word, Pages, Google Docs and LibreOffice all
// open the result.

import { zip } from "./zip.js";
import { resolveTheme } from "./themes.js";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Word measures in twips (1/20 pt) and half-points. Naming the
// conversions stops the two being mixed up.
const twips = (points) => Math.round(points * 20);
const halfPoints = (points) => Math.round(points * 2);

function runXml(run) {
  const properties = [];
  if (run.bold) properties.push("<w:b/>");
  if (run.italic) properties.push("<w:i/>");
  const text = escapeXml(run.text);
  return `<w:r>${properties.length ? `<w:rPr>${properties.join("")}</w:rPr>` : ""}` +
    `<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(runs, { style = "BodyText", numId = null, level = 0, align = null } = {}) {
  const properties = [`<w:pStyle w:val="${style}"/>`];
  if (numId) {
    properties.push(`<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`);
  }
  if (align) properties.push(`<w:jc w:val="${align}"/>`);
  return `<w:p><w:pPr>${properties.join("")}</w:pPr>${runs.map(runXml).join("")}</w:p>`;
}

const pageBreak = () =>
  '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';

const CONTAINER_LABEL = {
  callout: "Note",
  exercise: "Exercise",
  case: "Case study",
  checklist: "Checklist",
  takeaways: "Key takeaways",
};

function blocksXml(blocks, ctx) {
  const out = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out.push(paragraph(block.runs, { style: block.level === 2 ? "Heading2" : "Heading3" }));
        break;
      case "paragraph":
        out.push(paragraph(block.runs));
        break;
      case "quote":
        out.push(paragraph(block.runs, { style: "Quote" }));
        break;
      case "list":
        block.items.forEach((item) => {
          out.push(paragraph(item, {
            style: "ListParagraph",
            numId: block.ordered ? 2 : 1,
          }));
        });
        break;
      case "break":
        out.push(paragraph([{ text: "* * *" }], { style: "BodyText", align: "center" }));
        break;
      case "container": {
        const label = block.title || CONTAINER_LABEL[block.variant] || "Note";
        out.push(paragraph([{ text: label.toUpperCase(), bold: true }], { style: "PanelHeading" }));
        out.push(blocksXml(block.blocks, ctx));
        break;
      }
      case "visual": {
        const visual = ctx.takeVisual(block.description);
        if (visual) out.push(...figureXml(visual));
        break;
      }
      default:
        break;
    }
  }
  return out.join("\n");
}

/**
 * A figure, as an editor needs to see it.
 *
 * DOCX carries no SVG that every reader understands, and a rasterised
 * figure is not editable — so a figure becomes a marked placeholder plus
 * its content in text. The editor knows exactly what sits there, and the
 * designed version is in the PDF and the EPUB.
 */
function figureXml(visual) {
  const out = [
    paragraph([{ text: `[Figure: ${visual.title || visual.kind}]`, bold: true }], { style: "FigureMarker" }),
  ];
  const data = visual.data || {};
  const lines = [];
  for (const step of data.steps || data.nodes || []) {
    lines.push(`${step.when ? `${step.when} — ` : ""}${step.label}${step.detail ? `: ${step.detail}` : ""}`);
  }
  for (const item of data.items || []) lines.push(item);
  if (data.columns?.length) lines.push(data.columns.join("  |  "));
  for (const row of data.rows || []) lines.push((row.cells || []).join("  |  "));
  if (data.quote) lines.push(`"${data.quote}"${data.attribution ? ` — ${data.attribution}` : ""}`);

  for (const line of lines) out.push(paragraph([{ text: line }], { style: "FigureContent" }));
  if (visual.caption) out.push(paragraph([{ text: visual.caption }], { style: "Caption" }));
  return out;
}

function stylesXml(theme) {
  const bodyFont = theme.body === "sans" ? "Calibri" : "Cambria";
  const headFont = theme.heading === "sans" ? "Calibri" : "Cambria";
  const accent = String(theme.accent || "#333333").replace("#", "").toUpperCase();
  const size = theme.size;

  const style = (id, name, definition) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${definition}</w:style>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
  <w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}"/>
  <w:sz w:val="${halfPoints(size + 1)}"/>
</w:rPr></w:rPrDefault></w:docDefaults>
${style("Normal", "Normal", "")}
${style("BodyText", "Body Text",
  `<w:pPr><w:spacing w:after="${twips(6)}" w:line="${Math.round(276 * 1.15)}" w:lineRule="auto"/></w:pPr>`)}
${style("Heading1", "heading 1",
  `<w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="${twips(24)}" w:after="${twips(14)}"/><w:outlineLvl w:val="0"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:b/><w:sz w:val="${halfPoints(size * 2)}"/></w:rPr>`)}
${style("Heading2", "heading 2",
  `<w:pPr><w:keepNext/><w:spacing w:before="${twips(16)}" w:after="${twips(6)}"/><w:outlineLvl w:val="1"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:b/><w:sz w:val="${halfPoints(size * 1.3)}"/></w:rPr>`)}
${style("Heading3", "heading 3",
  `<w:pPr><w:keepNext/><w:spacing w:before="${twips(12)}" w:after="${twips(4)}"/><w:outlineLvl w:val="2"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:b/><w:sz w:val="${halfPoints(size * 1.08)}"/></w:rPr>`)}
${style("Title", "Title",
  `<w:pPr><w:jc w:val="center"/><w:spacing w:after="${twips(10)}"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:sz w:val="${halfPoints(size * 2.6)}"/></w:rPr>`)}
${style("Subtitle", "Subtitle",
  `<w:pPr><w:jc w:val="center"/><w:spacing w:after="${twips(20)}"/></w:pPr>` +
  `<w:rPr><w:i/><w:color w:val="555555"/><w:sz w:val="${halfPoints(size * 1.35)}"/></w:rPr>`)}
${style("ChapterNumber", "Chapter Number",
  `<w:pPr><w:keepNext/><w:spacing w:after="${twips(2)}"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:caps/><w:color w:val="${accent}"/><w:sz w:val="${halfPoints(size * 0.8)}"/></w:rPr>`)}
${style("Quote", "Quote",
  `<w:pPr><w:ind w:left="${twips(24)}" w:right="${twips(24)}"/><w:spacing w:before="${twips(8)}" w:after="${twips(8)}"/></w:pPr>` +
  `<w:rPr><w:i/><w:color w:val="333333"/></w:rPr>`)}
${style("ListParagraph", "List Paragraph",
  `<w:pPr><w:ind w:left="${twips(24)}"/><w:spacing w:after="${twips(3)}"/></w:pPr>`)}
${style("PanelHeading", "Panel Heading",
  `<w:pPr><w:keepNext/><w:spacing w:before="${twips(12)}" w:after="${twips(3)}"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}"/><w:b/><w:color w:val="${accent}"/><w:sz w:val="${halfPoints(size * 0.82)}"/></w:rPr>`)}
${style("FigureMarker", "Figure Marker",
  `<w:pPr><w:keepNext/><w:spacing w:before="${twips(12)}" w:after="${twips(3)}"/></w:pPr>` +
  `<w:rPr><w:b/><w:color w:val="${accent}"/></w:rPr>`)}
${style("FigureContent", "Figure Content",
  `<w:pPr><w:ind w:left="${twips(18)}"/><w:spacing w:after="${twips(2)}"/></w:pPr>` +
  `<w:rPr><w:color w:val="444444"/><w:sz w:val="${halfPoints(size * 0.92)}"/></w:rPr>`)}
${style("Caption", "caption",
  `<w:pPr><w:spacing w:after="${twips(10)}"/></w:pPr>` +
  `<w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="${halfPoints(size * 0.85)}"/></w:rPr>`)}
</w:styles>`;
}

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">
  <w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/>
  <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
</w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0">
  <w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
  <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

/**
 * Build the DOCX.
 *
 * @param {object} book  the same shape layoutBook() takes
 * @returns {{bytes: Uint8Array}}
 */
export function writeDocx(book, meta = {}, options = {}) {
  const theme = resolveTheme(book.themeId, book.design || {});
  const now = options.now || new Date();

  const visualsByChapter = new Map();
  for (const visual of book.visuals || []) {
    if (!visualsByChapter.has(visual.chapter_id)) visualsByChapter.set(visual.chapter_id, []);
    visualsByChapter.get(visual.chapter_id).push(visual);
  }

  const body = [];
  (book.sections || []).forEach((section, index) => {
    const pool = [...(visualsByChapter.get(section.id) || [])];
    const ctx = {
      takeVisual() {
        return pool.length ? pool.shift() : null;
      },
    };

    if (section.front_type === "title_page") {
      body.push(paragraph([{ text: book.title }], { style: "Title" }));
      if (book.subtitle) body.push(paragraph([{ text: book.subtitle }], { style: "Subtitle" }));
      body.push(paragraph([{ text: book.author || "" }], { style: "Subtitle" }));
      body.push(pageBreak());
      return;
    }
    if (section.front_type === "half_title") return;

    if (section.number && section.kind === "chapter") {
      body.push(paragraph([{ text: `Chapter ${section.number}` }], { style: "ChapterNumber" }));
    }
    // Heading1 carries pageBreakBefore, so a chapter starts its own page
    // without a manual break the editor would have to delete.
    if (section.title) body.push(paragraph([{ text: section.title }], { style: "Heading1" }));
    if (section.subtitle) body.push(paragraph([{ text: section.subtitle }], { style: "Subtitle" }));

    body.push(blocksXml(section.blocks || [], ctx));
    for (const leftover of pool) body.push(...figureXml(leftover));
    void index;
  });

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${body.join("\n")}
<w:sectPr>
  <w:pgSz w:w="${twips(book.trimWidth || 432)}" w:h="${twips(book.trimHeight || 648)}"/>
  <w:pgMar w:top="${twips(62)}" w:right="${twips(58)}" w:bottom="${twips(66)}" w:left="${twips(62)}"
           w:header="${twips(28)}" w:footer="${twips(28)}" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(book.title)}</dc:title>
<dc:creator>${escapeXml(book.author || "")}</dc:creator>
<cp:lastModifiedBy>${escapeXml(book.author || "")}</cp:lastModifiedBy>
${meta.description ? `<dc:description>${escapeXml(meta.description)}</dc:description>` : ""}
${meta.keywords?.length ? `<cp:keywords>${escapeXml(meta.keywords.join(", "))}</cp:keywords>` : ""}
<dc:language>${escapeXml(book.language || "en")}</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now.toISOString()}</dcterms:modified>
</cp:coreProperties>`;

  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
    },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: stylesXml(theme) },
    { name: "word/numbering.xml", data: NUMBERING },
    { name: "docProps/core.xml", data: core },
  ];

  return { bytes: zip(entries, now, { deflate: options.deflate }) };
}
