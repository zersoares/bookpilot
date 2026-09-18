// Interior design themes and page geometry.
//
// These are the canonical definitions — the database table
// public.book_design_themes is what the picker shows, but the layout
// engine reads from here, because a page has to be set whether or not
// the database answers.
//
// Everything is in points (1/72 inch), the unit a PDF is drawn in.

export const TRIM_SIZES = {
  "6x9":     { label: '6" × 9" (trade paperback)', width: 432, height: 648 },
  "5.5x8.5": { label: '5.5" × 8.5" (digest)',      width: 396, height: 612 },
  a4:        { label: "A4",                         width: 595.28, height: 841.89 },
  letter:    { label: "US Letter",                  width: 612, height: 792 },
};

export function trimSize(id) {
  return TRIM_SIZES[id] || TRIM_SIZES["6x9"];
}

/**
 * Margins.
 *
 * Print gets a gutter: the inside margin is wider than the outside
 * because the binding eats a few millimetres, and a page whose text
 * disappears into the spine is the commonest fault in a
 * self-published book. Digital gets symmetric margins because nothing
 * is bound.
 *
 * The gutter grows with the page count, which is what a printer's own
 * table does — a 400-page block opens less flat than a 120-page one.
 */
export function marginsFor(theme, trim, { print = false, pageCount = 200 } = {}) {
  const scale = trim.width / 432;
  const base = {
    top: theme.margins.top * scale,
    bottom: theme.margins.bottom * scale,
    outer: theme.margins.outer * scale,
    inner: theme.margins.inner * scale,
  };
  if (!print) {
    const side = (base.outer + base.inner) / 2;
    return { ...base, outer: side, inner: side, gutter: 0 };
  }
  const gutter = pageCount > 600 ? 25 : pageCount > 400 ? 21 : pageCount > 150 ? 14 : 9;
  return { ...base, gutter, inner: base.inner + gutter };
}

const hex = (value) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!m) return [0.2, 0.2, 0.25];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const THEME_LIST = [
  {
    id: "editorial",
    name: "Editorial",
    body: "serif",
    heading: "sans",
    size: 11,
    leading: 1.52,
    accent: "#1f2a44",
    chapterStyle: "numbered",
    margins: { top: 62, bottom: 66, outer: 58, inner: 62 },
    runningHead: "smallcaps",
    firstLineIndent: 0,
    paragraphSpace: 0.5,
    dropOpener: true,
  },
  {
    id: "luxury",
    name: "Luxury",
    body: "serif",
    heading: "serif",
    size: 11.5,
    leading: 1.62,
    accent: "#8a6a2f",
    chapterStyle: "rule",
    margins: { top: 76, bottom: 80, outer: 70, inner: 74 },
    runningHead: "italic",
    firstLineIndent: 16,
    paragraphSpace: 0,
    letterSpacedTitles: true,
  },
  {
    id: "modern_business",
    name: "Modern Business",
    body: "sans",
    heading: "sans",
    size: 10.5,
    leading: 1.5,
    accent: "#1b4f72",
    chapterStyle: "band",
    margins: { top: 58, bottom: 62, outer: 54, inner: 60 },
    runningHead: "plain",
    firstLineIndent: 0,
    paragraphSpace: 0.62,
  },
  {
    id: "minimal",
    name: "Minimal",
    body: "sans",
    heading: "sans",
    size: 11,
    leading: 1.55,
    accent: "#2b2b2b",
    chapterStyle: "plain",
    margins: { top: 70, bottom: 72, outer: 64, inner: 66 },
    runningHead: "none",
    firstLineIndent: 0,
    paragraphSpace: 0.6,
  },
  {
    id: "wellness",
    name: "Wellness",
    body: "serif",
    heading: "sans",
    size: 11.5,
    leading: 1.62,
    accent: "#4f7360",
    chapterStyle: "display",
    margins: { top: 72, bottom: 76, outer: 66, inner: 70 },
    runningHead: "plain",
    firstLineIndent: 0,
    paragraphSpace: 0.55,
    softContainers: true,
  },
  {
    id: "feminine_modern",
    name: "Feminine Modern",
    body: "serif",
    heading: "serif",
    size: 11,
    leading: 1.58,
    accent: "#9b4a6b",
    chapterStyle: "display",
    margins: { top: 68, bottom: 72, outer: 62, inner: 66 },
    runningHead: "italic",
    firstLineIndent: 14,
    paragraphSpace: 0,
    accentRule: true,
  },
  {
    id: "academic",
    name: "Academic",
    body: "serif",
    heading: "serif",
    size: 10.5,
    leading: 1.48,
    accent: "#3f3aa8",
    chapterStyle: "numbered",
    margins: { top: 60, bottom: 64, outer: 56, inner: 64 },
    runningHead: "plain",
    firstLineIndent: 18,
    paragraphSpace: 0,
    numberedSections: true,
  },
  {
    id: "entrepreneur",
    name: "Entrepreneur",
    body: "sans",
    heading: "sans",
    size: 11,
    leading: 1.5,
    accent: "#a9631a",
    chapterStyle: "band",
    margins: { top: 56, bottom: 60, outer: 52, inner: 58 },
    runningHead: "plain",
    firstLineIndent: 0,
    paragraphSpace: 0.62,
    boldOpener: true,
  },
];

/**
 * A theme, resolved with its derived type scale.
 *
 * The scale is derived rather than tabulated so a project that overrides
 * the base size keeps its proportions: headings stay in relation to the
 * text rather than drifting into it.
 */
export function resolveTheme(id, overrides = {}) {
  const base = THEME_LIST.find((t) => t.id === id) || THEME_LIST[0];
  const theme = { ...base, ...pickOverrides(overrides) };
  const size = theme.size;
  const accent = hex(theme.accent);

  return {
    ...theme,
    accentRgb: accent,
    type: {
      body: size,
      lead: size * theme.leading,
      h2: size * 1.28,
      h3: size * 1.06,
      chapterNumber: theme.chapterStyle === "band" ? size * 3.2 : size * 2.4,
      chapterTitle: size * (theme.chapterStyle === "display" ? 2.1 : 1.8),
      partNumber: size * 1.2,
      partTitle: size * 2.6,
      quote: size * 1.06,
      caption: size * 0.82,
      container: size * 0.94,
      runningHead: size * 0.78,
      folio: size * 0.82,
      frontTitle: size * 2.6,
    },
    space: {
      paragraph: size * theme.paragraphSpace,
      beforeH2: size * 1.5,
      afterH2: size * 0.55,
      beforeH3: size * 1.05,
      afterH3: size * 0.3,
      beforeQuote: size * 0.9,
      beforeList: size * 0.55,
      listItem: size * 0.28,
      container: size * 0.85,
      containerPad: size * 0.85,
      break: size * 1.4,
      caption: size * 0.45,
      visual: size * 1.1,
    },
  };
}

const OVERRIDE_KEYS = [
  "size", "leading", "accent", "body", "heading", "chapterStyle",
  "firstLineIndent", "paragraphSpace", "runningHead",
];

function pickOverrides(overrides) {
  const out = {};
  for (const key of OVERRIDE_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== "") {
      out[key] = overrides[key];
    }
  }
  if (out.size) out.size = Math.min(16, Math.max(8, Number(out.size) || 11));
  if (out.leading) out.leading = Math.min(2.2, Math.max(1.1, Number(out.leading) || 1.5));
  return out;
}

export function themeList() {
  return THEME_LIST.map((t) => ({
    id: t.id,
    name: t.name,
    body: t.body,
    heading: t.heading,
    size: t.size,
    leading: t.leading,
    accent: t.accent,
    chapterStyle: t.chapterStyle,
  }));
}
