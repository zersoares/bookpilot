// The PDF writer.
//
// Takes laid-out pages from doc/layout.js and writes a PDF. No library:
// a PDF is a container of numbered objects and a cross-reference table,
// and the drawing operators needed for a book — text, filled rectangles,
// images — are a handful.
//
// Compression is injected rather than imported. This module runs in the
// browser too — the page previewer and the demo workspace's exporter
// both load it — and `node:zlib` cannot be resolved there. The server
// passes Node's own deflate; everything else falls back to the stored-
// block encoder in doc/deflate.js, which is valid but does not compress.
// A 200-page book is about 1.5 MB uncompressed and under 300 KB
// deflated, which is why the server bothers.

import { FONTS, winAnsiCode } from "./metrics.js";
import { deflateZlibStored } from "./deflate.js";

const ENCODER = new TextEncoder();

/** PDF literal string: WinAnsi bytes with the three escapes. */
function pdfString(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = winAnsiCode(text.charCodeAt(i));
    if (!code) continue;
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code);
  }
  return Uint8Array.from(bytes);
}

/** UTF-16BE with a byte-order mark — how a PDF carries non-ASCII metadata. */
function pdfTextString(text) {
  const bytes = [0xfe, 0xff];
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      bytes.push(hi >> 8, hi & 255, lo >> 8, lo & 255);
    } else {
      bytes.push(code >> 8, code & 255);
    }
  }
  return `<${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}>`;
}

const num = (n) => {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

// ---------------------------------------------------------------------
// Content streams
// ---------------------------------------------------------------------

/**
 * Drawing operations -> a page content stream.
 *
 * The layout engine works in a top-left coordinate system because that
 * is how a page reads; PDF's origin is bottom-left. The flip happens
 * here, once, rather than in every caller.
 */
function contentStream(page, height, fontKeys) {
  const parts = [];
  let fill = null;
  let wordSpacing = 0;

  const setFill = (color) => {
    const rgb = color || [0.1, 0.1, 0.12];
    const key = rgb.join(",");
    if (fill === key) return;
    fill = key;
    parts.push(`${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`);
  };

  for (const op of page.items) {
    if (op.op === "rect") {
      setFill(op.fill);
      parts.push(`${num(op.x)} ${num(height - op.y - op.h)} ${num(op.w)} ${num(op.h)} re f`);
      continue;
    }
    if (op.op === "line") {
      const rgb = op.color || [0.1, 0.1, 0.12];
      parts.push(`${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} RG ${num(op.width || 0.6)} w`);
      parts.push(`${num(op.x1)} ${num(height - op.y1)} m ${num(op.x2)} ${num(height - op.y2)} l S`);
      fill = null;
      continue;
    }
    if (op.op === "image") {
      parts.push("q");
      parts.push(`${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(height - op.y - op.h)} cm`);
      parts.push(`/${op.ref} Do`);
      parts.push("Q");
      continue;
    }
    if (op.op !== "text" || !op.text) continue;

    setFill(op.color);
    const font = fontKeys.get(op.font) || "F1";
    const ws = op.wordSpacing || 0;
    if (Math.abs(ws - wordSpacing) > 0.001) {
      parts.push(`${num(ws)} Tw`);
      wordSpacing = ws;
    }
    parts.push("BT");
    parts.push(`/${font} ${num(op.size)} Tf`);
    parts.push(`1 0 0 1 ${num(op.x)} ${num(height - op.y)} Tm`);
    parts.push(`(${bytesToLatin(pdfString(op.text))}) Tj`);
    parts.push("ET");
  }

  return parts.join("\n");
}

// Content streams are assembled as JS strings for readability, then
// encoded byte-for-byte. Latin-1 rather than UTF-8 because the string
// already holds WinAnsi bytes: encoding those as UTF-8 would double the
// high ones and corrupt every curly quote.
function bytesToLatin(bytes) {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

function latinToBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 255;
  return out;
}

// ---------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------

/**
 * @param {object} laid   the result of layoutBook()
 * @param {object} meta   { title, subtitle, author, language, subject, keywords }
 * @param {object} options { compress, deflate, images }
 * @returns {{bytes: Uint8Array, pageCount: number}}
 */
export function writePdf(laid, meta = {}, options = {}) {
  const compress = options.compress !== false;
  const deflate = options.deflate || deflateZlibStored;
  const { width, height } = laid.trim;

  const objects = [];   // 1-indexed on output
  const add = (body) => {
    objects.push(body);
    return objects.length; // the object number
  };

  // Fonts. Only the faces the book actually used are written, so a book
  // set entirely in Times does not carry four Helvetica descriptors.
  const usedFonts = new Set();
  for (const page of laid.pages) {
    for (const op of page.items) if (op.op === "text") usedFonts.add(op.font);
  }
  if (!usedFonts.size) usedFonts.add("Times-Roman");

  const fontKeys = new Map();
  const fontRefs = [];
  let index = 0;
  for (const font of FONTS) {
    if (!usedFonts.has(font)) continue;
    index += 1;
    const key = `F${index}`;
    fontKeys.set(font, key);
    const ref = add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`
    );
    fontRefs.push(`/${key} ${ref} 0 R`);
  }

  // Images, if the export pipeline attached any.
  const imageRefs = [];
  const images = options.images instanceof Map ? options.images : new Map();
  for (const [ref, image] of images) {
    const objectNumber = add({
      dict: image.dict,
      raw: image.bytes,
    });
    imageRefs.push(`/${ref} ${objectNumber} 0 R`);
  }

  const resources = `<< /Font << ${fontRefs.join(" ")} >>${
    imageRefs.length ? ` /XObject << ${imageRefs.join(" ")} >>` : ""
  } /ProcSet [/PDF /Text /ImageC /ImageB] >>`;

  // Pages. Each page is two objects: the page dictionary and its
  // content stream. The dictionary needs the content's object number,
  // so the stream is written first.
  const pageRefs = [];
  const pageObjectNumbers = [];
  const pagesRefPlaceholder = objects.length + 1 + laid.pages.length * 2;

  for (const page of laid.pages) {
    const stream = contentStream(page, height, fontKeys);
    const rawBytes = latinToBytes(stream);
    const bytes = compress ? new Uint8Array(deflate(rawBytes)) : rawBytes;
    const contentRef = add({
      dict: `<< /Length ${bytes.length}${compress ? " /Filter /FlateDecode" : ""} >>`,
      raw: bytes,
    });
    const pageRef = add(
      `<< /Type /Page /Parent ${pagesRefPlaceholder} 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
      `/Resources ${resources} /Contents ${contentRef} 0 R >>`
    );
    pageRefs.push(`${pageRef} 0 R`);
    pageObjectNumbers.push(pageRef);
  }

  const pagesRef = add(
    `<< /Type /Pages /Count ${laid.pages.length} /Kids [${pageRefs.join(" ")}] >>`
  );
  // The placeholder above has to be the number this actually got, or
  // every page would point at the wrong parent.
  if (pagesRef !== pagesRefPlaceholder) {
    for (let i = 0; i < pageObjectNumbers.length; i += 1) {
      const n = pageObjectNumbers[i];
      objects[n - 1] = objects[n - 1].replace(
        `/Parent ${pagesRefPlaceholder} 0 R`,
        `/Parent ${pagesRef} 0 R`
      );
    }
  }

  // Bookmarks: one per chapter. A 200-page PDF without an outline is a
  // scroll bar, not a book.
  let outlineRef = 0;
  const outlineEntries = (laid.outline || []).filter((o) => o.kind !== "front");
  if (outlineEntries.length) {
    const firstChild = objects.length + 2;
    const itemRefs = outlineEntries.map((_, i) => firstChild + i);
    outlineRef = add(
      `<< /Type /Outlines /First ${itemRefs[0]} 0 R /Last ${itemRefs[itemRefs.length - 1]} 0 R ` +
      `/Count ${itemRefs.length} >>`
    );
    outlineEntries.forEach((entry, i) => {
      const pageIndex = Math.min(laid.pages.length - 1, laid.frontCount + entry.page - 1);
      const target = pageObjectNumbers[Math.max(0, pageIndex)];
      const label = entry.number ? `${entry.number}. ${entry.title}` : entry.title;
      add(
        `<< /Title ${pdfTextString(label)} /Parent ${outlineRef} 0 R ` +
        (i > 0 ? `/Prev ${itemRefs[i - 1]} 0 R ` : "") +
        (i < itemRefs.length - 1 ? `/Next ${itemRefs[i + 1]} 0 R ` : "") +
        `/Dest [${target} 0 R /XYZ 0 ${num(height)} null] >>`
      );
    });
  }

  const infoRef = add(
    `<< /Title ${pdfTextString(meta.title || "Untitled")} ` +
    `/Author ${pdfTextString(meta.author || "")} ` +
    (meta.subject ? `/Subject ${pdfTextString(meta.subject)} ` : "") +
    (meta.keywords ? `/Keywords ${pdfTextString(meta.keywords)} ` : "") +
    `/Creator ${pdfTextString("BookPilot Book Builder")} ` +
    `/Producer ${pdfTextString("BookPilot Book Builder")} ` +
    `/CreationDate (${pdfDate(options.now || new Date())}) >>`
  );

  const catalogRef = add(
    `<< /Type /Catalog /Pages ${pagesRef} 0 R ` +
    (outlineRef ? `/Outlines ${outlineRef} 0 R /PageMode /UseOutlines ` : "") +
    `/Lang (${(meta.language || "en").slice(0, 8)}) ` +
    `/ViewerPreferences << /DisplayDocTitle true >> >>`
  );

  // --- serialise ----------------------------------------------------
  const chunks = [];
  let offset = 0;
  const push = (data) => {
    const bytes = typeof data === "string" ? ENCODER.encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
    return bytes.length;
  };

  push("%PDF-1.7\n");
  // A comment of high bytes tells any transport that this is binary.
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = [0];
  objects.forEach((body, i) => {
    offsets[i + 1] = offset;
    push(`${i + 1} 0 obj\n`);
    if (typeof body === "string") {
      push(body);
      push("\nendobj\n");
    } else {
      push(body.dict);
      push("\nstream\n");
      push(body.raw);
      push("\nendstream\nendobj\n");
    }
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R /Info ${infoRef} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  );

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }

  return { bytes, pageCount: laid.pages.length };
}

function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
