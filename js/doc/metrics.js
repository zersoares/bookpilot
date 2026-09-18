// Font metrics for the PDF base-14 fonts.
//
// Why these fonts: this repository has no build step and no
// dependencies, so there is no font subsetter and no place to embed a
// 200 KB TTF from. The base-14 are guaranteed present in every PDF
// reader and need no embedding — Times and Helvetica set a book that
// looks like a book, which is the honest trade for shipping a working
// exporter rather than a promised one.
//
// The widths below are the Adobe AFM widths, in 1/1000 em. They are the
// reason justified text does not overflow the measure: every line is
// measured with the same numbers the reader will use to draw it.

// Widths for the printable ASCII range 32..126, in order.
// prettier-ignore
const ASCII = {
  Helvetica: [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  "Helvetica-Bold": [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
  "Times-Roman": [
    250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,
    500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,
    921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,
    556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,
    333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,
    500,500,333,389,278,500,500,722,500,500,444,480,200,480,541],
  "Times-Bold": [
    250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,
    500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
    930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,
    611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,
    333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,
    556,556,444,389,333,556,500,722,500,500,444,394,220,394,520],
  "Times-Italic": [
    250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,
    500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,
    920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,
    611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,
    333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,
    500,500,389,389,278,500,444,667,444,444,389,400,275,400,541],
  "Times-BoldItalic": [
    250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,
    500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
    832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,
    611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,
    333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,
    500,500,389,389,278,556,444,667,500,444,389,348,220,348,570],
};

// Oblique is metrically identical to upright in Helvetica.
ASCII["Helvetica-Oblique"] = ASCII.Helvetica;
ASCII["Helvetica-BoldOblique"] = ASCII["Helvetica-Bold"];

// The typographic characters the text pipeline produces, at their
// WinAnsiEncoding code points. Without these, a curly quote would be
// measured as a missing glyph and every line holding one would be set
// slightly wrong.
const PUNCTUATION = {
  Helvetica:          { 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x96: 556, 0x97: 1000, 0xa0: 278 , 0x95: 350, 0x86: 556, 0x87: 556, 0xb7: 278},
  "Helvetica-Bold":   { 0x85: 1000, 0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500, 0x96: 556, 0x97: 1000, 0xa0: 278 , 0x95: 350, 0x86: 556, 0x87: 556, 0xb7: 278},
  "Times-Roman":      { 0x85: 1000, 0x91: 333, 0x92: 333, 0x93: 444, 0x94: 444, 0x96: 500, 0x97: 1000, 0xa0: 250 , 0x95: 350, 0x86: 500, 0x87: 500, 0xb7: 250},
  "Times-Bold":       { 0x85: 1000, 0x91: 333, 0x92: 333, 0x93: 500, 0x94: 500, 0x96: 500, 0x97: 1000, 0xa0: 250 , 0x95: 350, 0x86: 500, 0x87: 500, 0xb7: 250},
  "Times-Italic":     { 0x85: 889,  0x91: 333, 0x92: 333, 0x93: 556, 0x94: 556, 0x96: 500, 0x97: 889,  0xa0: 250 , 0x95: 350, 0x86: 500, 0x87: 500, 0xb7: 250},
  "Times-BoldItalic": { 0x85: 1000, 0x91: 333, 0x92: 333, 0x93: 500, 0x94: 500, 0x96: 500, 0x97: 1000, 0xa0: 250 , 0x95: 350, 0x86: 500, 0x87: 500, 0xb7: 250},
};
PUNCTUATION["Helvetica-Oblique"] = PUNCTUATION.Helvetica;
PUNCTUATION["Helvetica-BoldOblique"] = PUNCTUATION["Helvetica-Bold"];

// Accented Latin-1 letters are drawn from the same base glyph, so they
// carry the base letter's width. Mapping them rather than tabulating 128
// more numbers per font costs nothing in accuracy for these faces and
// keeps a name like "Zoë" or "Łódź" from being mis-measured as a space.
const BASE_LETTER = {
  0xc0: "A", 0xc1: "A", 0xc2: "A", 0xc3: "A", 0xc4: "A", 0xc5: "A",
  0xc7: "C", 0xc8: "E", 0xc9: "E", 0xca: "E", 0xcb: "E",
  0xcc: "I", 0xcd: "I", 0xce: "I", 0xcf: "I", 0xd1: "N",
  0xd2: "O", 0xd3: "O", 0xd4: "O", 0xd5: "O", 0xd6: "O", 0xd8: "O",
  0xd9: "U", 0xda: "U", 0xdb: "U", 0xdc: "U", 0xdd: "Y",
  0xe0: "a", 0xe1: "a", 0xe2: "a", 0xe3: "a", 0xe4: "a", 0xe5: "a",
  0xe7: "c", 0xe8: "e", 0xe9: "e", 0xea: "e", 0xeb: "e",
  0xec: "i", 0xed: "i", 0xee: "i", 0xef: "i", 0xf1: "n",
  0xf2: "o", 0xf3: "o", 0xf4: "o", 0xf5: "o", 0xf6: "o", 0xf8: "o",
  0xf9: "u", 0xfa: "u", 0xfb: "u", 0xfc: "u", 0xfd: "y", 0xff: "y",
};

// Unicode -> WinAnsiEncoding.
//
// The text pipeline produces real typographic characters (curly quotes,
// en and em dashes, an ellipsis). WinAnsi puts those in the 0x80-0x9F
// range, which is where both the width tables above and the PDF string
// encoder have to look for them. Measuring a curly quote as a missing
// glyph is how a justified line silently comes out short.
const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** The WinAnsi byte for a code point, or 0 where the font has no glyph. */
export function winAnsiCode(code) {
  const mapped = WIN_ANSI.get(code);
  if (mapped) return mapped;
  if (code < 256) return code;
  return 0;
}

export const FONTS = Object.keys(ASCII);

/** Width of one code point in 1/1000 em, for the named base-14 font. */
export function charWidth(font, raw) {
  const code = winAnsiCode(raw);
  const table = ASCII[font] || ASCII["Times-Roman"];
  if (code >= 32 && code <= 126) return table[code - 32];
  const punct = (PUNCTUATION[font] || PUNCTUATION["Times-Roman"])[code];
  if (punct) return punct;
  const base = BASE_LETTER[code];
  if (base) return table[base.charCodeAt(0) - 32];
  if (code === 0xdf) return table["s".charCodeAt(0) - 32]; // eszett
  if (code === 0xe6 || code === 0xc6) return table["a".charCodeAt(0) - 32] * 1.6;
  // An unmapped glyph is drawn as nothing by the reader, so measure it
  // as nothing rather than pushing the line out by a phantom width.
  return 0;
}

/** Width of a string at a given point size. */
export function textWidth(text, font, size) {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += charWidth(font, text.charCodeAt(i));
  }
  return (total * size) / 1000;
}

// Vertical metrics, as a fraction of the point size. Used to place a
// baseline inside its line box and to draw rules under headings.
export const VERTICAL = {
  Helvetica: { ascender: 0.718, descender: -0.207, capHeight: 0.718, xHeight: 0.523 },
  "Times-Roman": { ascender: 0.683, descender: -0.217, capHeight: 0.662, xHeight: 0.45 },
};

export function verticalFor(font) {
  return font.startsWith("Times") ? VERTICAL["Times-Roman"] : VERTICAL.Helvetica;
}

/**
 * Pick the base-14 name for a family and a style.
 *
 * @param {"serif"|"sans"} family
 * @param {{bold?: boolean, italic?: boolean}} style
 */
export function fontName(family, { bold = false, italic = false } = {}) {
  if (family === "sans") {
    if (bold && italic) return "Helvetica-BoldOblique";
    if (bold) return "Helvetica-Bold";
    if (italic) return "Helvetica-Oblique";
    return "Helvetica";
  }
  if (bold && italic) return "Times-BoldItalic";
  if (bold) return "Times-Bold";
  if (italic) return "Times-Italic";
  return "Times-Roman";
}
