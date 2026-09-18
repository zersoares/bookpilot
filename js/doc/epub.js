// EPUB 3 export.
//
// A reflowable edition, not a picture of the printed one: an e-reader
// sets its own measure, its own type size and its own page breaks, so
// exporting fixed pages here would produce a book nobody can read at
// their own font size.
//
// What carries over from the print edition is the structure — the
// chapter order, the front and back matter, the figures (as SVG, so
// they stay sharp and stay described) — and the typographic detail that
// belongs to the text rather than to the page.
//
// EPUB 3 with an EPUB 2 NCX alongside it, because a meaningful number of
// devices in readers' hands still want the NCX.

import { zip } from "./zip.js";
import { figureSvg } from "./svg.js";
import { resolveTheme } from "./themes.js";
import { runsText } from "./markdown.js";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function runsXhtml(runs) {
  return runs
    .map((run) => {
      const text = escapeXml(run.text);
      if (run.bold && run.italic) return `<strong><em>${text}</em></strong>`;
      if (run.bold) return `<strong>${text}</strong>`;
      if (run.italic) return `<em>${text}</em>`;
      return text;
    })
    .join("");
}

const CONTAINER_CLASS = {
  callout: "callout",
  exercise: "exercise",
  case: "case-study",
  checklist: "checklist",
  takeaways: "takeaways",
};

const CONTAINER_LABEL = {
  exercise: "Exercise",
  case: "Case study",
  checklist: "Checklist",
  takeaways: "Key takeaways",
};

function blocksXhtml(blocks, ctx) {
  const out = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out.push(`<h${block.level}>${runsXhtml(block.runs)}</h${block.level}>`);
        break;
      case "paragraph":
        out.push(`<p>${runsXhtml(block.runs)}</p>`);
        break;
      case "quote":
        out.push(`<blockquote><p>${runsXhtml(block.runs)}</p></blockquote>`);
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        out.push(`<${tag}>${block.items.map((item) => `<li>${runsXhtml(item)}</li>`).join("")}</${tag}>`);
        break;
      }
      case "break":
        out.push('<p class="scene-break">* * *</p>');
        break;
      case "container": {
        const cls = CONTAINER_CLASS[block.variant] || "callout";
        const label = block.title || CONTAINER_LABEL[block.variant] || "";
        out.push(
          `<aside class="${cls}" epub:type="sidebar">` +
          (label ? `<h4>${escapeXml(label)}</h4>` : "") +
          blocksXhtml(block.blocks, ctx) +
          `</aside>`
        );
        break;
      }
      case "visual": {
        const visual = ctx.takeVisual(block.description);
        if (visual) out.push(figureXhtml(visual, ctx));
        break;
      }
      default:
        break;
    }
  }
  return out.join("\n");
}

function figureXhtml(visual, ctx) {
  const rendered = figureSvg(visual, { width: 480, theme: ctx.theme });
  const caption = visual.caption ? `<figcaption>${escapeXml(visual.caption)}</figcaption>` : "";

  if (rendered) {
    return `<figure class="figure">${rendered.svg}${caption}</figure>`;
  }
  // An imaged figure with no image. The brief exists and the author can
  // see it in the app; the book simply does not carry an empty frame.
  return "";
}

function chapterXhtml(section, ctx, language) {
  const heading = section.kind === "chapter" && section.number
    ? `<p class="chapter-number">Chapter ${section.number}</p><h1>${escapeXml(section.title)}</h1>`
    : `<h1>${escapeXml(section.title || "")}</h1>`;
  const subtitle = section.subtitle ? `<p class="chapter-subtitle">${escapeXml(section.subtitle)}</p>` : "";

  const type = section.kind === "chapter" ? "chapter"
    : section.front_type === "copyright" ? "copyright-page"
    : section.front_type === "dedication" ? "dedication"
    : section.front_type === "foreword" ? "foreword"
    : section.kind === "introduction" ? "preface"
    : section.kind === "conclusion" ? "afterword"
    : "bodymatter";

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(section.title || "")}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body epub:type="${type}">
<section class="${section.kind}">
${section.front_type === "half_title" || section.front_type === "title_page" ? "" : heading}
${subtitle}
${blocksXhtml(section.blocks || [], ctx)}
</section>
</body>
</html>`;
}

const STYLESHEET = (theme) => `/* Reader-first: sizes in em so the device's own setting wins. */
html { font-size: 100%; }
body {
  font-family: ${theme.body === "sans" ? "sans-serif" : "serif"};
  line-height: ${theme.leading};
  margin: 0 5%;
  text-align: justify;
  hyphens: auto;
  -epub-hyphens: auto;
}
h1, h2, h3, h4 {
  font-family: ${theme.heading === "sans" ? "sans-serif" : "serif"};
  line-height: 1.22;
  text-align: left;
  page-break-after: avoid;
  break-after: avoid;
}
h1 { font-size: 1.7em; margin: 2em 0 1em; }
h2 { font-size: 1.22em; margin: 1.8em 0 0.5em; }
h3 { font-size: 1.05em; margin: 1.4em 0 0.35em; }
p { margin: 0 0 0.75em; text-indent: 0; }
.chapter-number {
  font-family: ${theme.heading === "sans" ? "sans-serif" : "serif"};
  font-size: 0.8em; letter-spacing: 0.08em; text-transform: uppercase;
  color: ${theme.accent}; margin: 0; text-align: left;
}
.chapter-subtitle { font-style: italic; color: #555; margin: -0.6em 0 1.4em; text-align: left; }
blockquote {
  margin: 1.2em 0 1.2em 1.2em; padding-left: 1em;
  border-left: 2px solid ${theme.accent};
  font-style: italic; color: #333; text-align: left;
}
ul, ol { margin: 0.8em 0 1em 1.3em; text-align: left; }
li { margin-bottom: 0.3em; }
.scene-break { text-align: center; margin: 1.6em 0; letter-spacing: 0.5em; color: #888; }
aside {
  margin: 1.4em 0; padding: 0.9em 1em;
  border-left: 3px solid ${theme.accent};
  background: #f7f6f3; text-align: left;
  page-break-inside: avoid; break-inside: avoid;
}
aside h4 {
  margin: 0 0 0.5em; font-size: 0.78em; letter-spacing: 0.07em;
  text-transform: uppercase; color: ${theme.accent};
}
aside p:last-child, aside ul:last-child { margin-bottom: 0; }
.figure { margin: 1.6em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
.figure svg { max-width: 100%; height: auto; }
figcaption { font-size: 0.8em; color: #666; margin-top: 0.5em; text-align: left; }
.title-page { text-align: center; }
.title-page h1 { font-size: 2.1em; }
.copyright { font-size: 0.82em; color: #444; text-align: left; }
`;

/**
 * Build the EPUB.
 *
 * @param {object} book  the same shape layoutBook() takes
 * @param {object} meta  { identifier, publisher, description, keywords, cover }
 * @returns {{bytes: Uint8Array, entries: number}}
 */
export function writeEpub(book, meta = {}, options = {}) {
  const theme = resolveTheme(book.themeId, book.design || {});
  const language = book.language || "en";
  const now = options.now || new Date();
  const identifier = meta.identifier || `urn:uuid:${meta.uuid || "00000000-0000-4000-8000-000000000000"}`;

  const visualsByChapter = new Map();
  for (const visual of book.visuals || []) {
    if (!visualsByChapter.has(visual.chapter_id)) visualsByChapter.set(visual.chapter_id, []);
    visualsByChapter.get(visual.chapter_id).push(visual);
  }

  const files = [];
  const manifest = [];
  const spine = [];
  const navPoints = [];

  (book.sections || []).forEach((section, index) => {
    const pool = [...(visualsByChapter.get(section.id) || [])];
    const ctx = {
      theme,
      takeVisual(description) {
        if (!pool.length) return null;
        const wanted = String(description || "").toLowerCase();
        let at = pool.findIndex((v) => wanted && v.title && v.title.toLowerCase().includes(wanted.slice(0, 18)));
        if (at < 0) at = 0;
        return pool.splice(at, 1)[0];
      },
    };

    let xhtml = chapterXhtml(section, ctx, language);
    // Figures the manuscript never anchored still belong to the chapter.
    if (pool.length) {
      const extra = pool.map((visual) => figureXhtml(visual, ctx)).filter(Boolean).join("\n");
      if (extra) xhtml = xhtml.replace("</section>", `${extra}\n</section>`);
    }

    const name = `ch${String(index + 1).padStart(3, "0")}.xhtml`;
    files.push({ name: `OEBPS/${name}`, data: xhtml });
    manifest.push(`<item id="c${index + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${index + 1}"/>`);
    if (section.title && section.front_type !== "half_title") {
      navPoints.push({
        href: name,
        label: section.number ? `${section.number}. ${section.title}` : section.title,
        order: navPoints.length + 1,
      });
    }
  });

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}">
<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
${navPoints.map((p) => `<li><a href="${p.href}">${escapeXml(p.label)}</a></li>`).join("\n")}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol><li><a epub:type="bodymatter" href="${navPoints[0]?.href || "ch001.xhtml"}">Start</a></li></ol>
</nav>
</body>
</html>`;

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(language)}">
<head>
<meta name="dtb:uid" content="${escapeXml(identifier)}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(book.title)}</text></docTitle>
<navMap>
${navPoints.map((p) => `<navPoint id="n${p.order}" playOrder="${p.order}"><navLabel><text>${escapeXml(p.label)}</text></navLabel><content src="${p.href}"/></navPoint>`).join("\n")}
</navMap>
</ncx>`;

  const cover = meta.cover && meta.cover.bytes
    ? { name: `OEBPS/cover.${meta.cover.extension || "jpg"}`, data: meta.cover.bytes, type: meta.cover.mediaType }
    : null;

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(language)}"
         prefix="cc: http://creativecommons.org/ns#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
${book.subtitle ? `<dc:title id="sub">${escapeXml(book.subtitle)}</dc:title>` : ""}
<dc:language>${escapeXml(language)}</dc:language>
<dc:creator id="author">${escapeXml(book.author || "")}</dc:creator>
${meta.publisher ? `<dc:publisher>${escapeXml(meta.publisher)}</dc:publisher>` : ""}
${meta.description ? `<dc:description>${escapeXml(meta.description)}</dc:description>` : ""}
${(meta.keywords || []).map((k) => `<dc:subject>${escapeXml(k)}</dc:subject>`).join("")}
<dc:date>${now.toISOString().slice(0, 10)}</dc:date>
<meta property="dcterms:modified">${now.toISOString().replace(/\.\d+Z$/, "Z")}</meta>
${cover ? '<meta name="cover" content="cover-image"/>' : ""}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${cover ? `<item id="cover-image" href="cover.${meta.cover.extension || "jpg"}" media-type="${escapeXml(meta.cover.mediaType || "image/jpeg")}" properties="cover-image"/>` : ""}
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>`;

  const entries = [
    // First, stored, uncompressed — the one entry where order and method
    // are part of the specification.
    { name: "mimetype", data: "application/epub+zip", store: true },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: navXhtml },
    { name: "OEBPS/toc.ncx", data: ncx },
    { name: "OEBPS/style.css", data: STYLESHEET(theme) },
    ...(cover ? [{ name: cover.name, data: cover.data }] : []),
    ...files,
  ];

  return { bytes: zip(entries, now, { deflate: options.deflate }), entries: entries.length };
}

/** Plain text of a section, for word counts and quality checks. */
export function sectionText(section) {
  return (section.blocks || [])
    .map((block) => (block.runs ? runsText(block.runs) : ""))
    .filter(Boolean)
    .join("\n");
}
