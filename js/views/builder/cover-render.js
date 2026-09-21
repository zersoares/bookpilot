// Cover rendering.
//
// A cover concept from the Cover Designer is a specification — palette,
// type treatment, composition — not a picture. This draws it, so what
// the author approves is the cover itself rather than a description of
// one.
//
// Typographic, geometric and minimal concepts render completely. An
// image-led concept renders its type over the author's supplied artwork
// where there is any, and over its palette where there is not, with the
// art direction shown beside it. Nothing here invents artwork or
// pretends a render happened.

import { html, raw, safeUrl } from "../../core/dom.js";

const FALLBACK = {
  background: "#1f2a44",
  title: "#ffffff",
  subtitle: "#e6e3dd",
  author: "#ffffff",
  accent: "#a9631a",
};

export function paletteOf(cover) {
  const out = { ...FALLBACK };
  for (const entry of cover?.palette || []) {
    if (entry && entry.role && /^#[0-9a-f]{6}$/i.test(entry.hex || "")) {
      out[entry.role] = entry.hex;
    }
  }
  // A palette that names no title colour still has to be readable, so
  // pick white or near-black against the background rather than leaving
  // the default and hoping.
  if (!cover?.palette?.some((p) => p.role === "title")) {
    out.title = contrastOn(out.background);
    out.author = out.title;
    out.subtitle = out.title;
  }
  return out;
}

/** Relative luminance, the WCAG way — used only to pick black or white. */
export function contrastOn(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const channel = (value) => {
    const v = parseInt(value, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
  return luminance > 0.42 ? "#16161a" : "#ffffff";
}

const TYPE_STACK = {
  serif: "'Times New Roman', Georgia, serif",
  sans: "'Helvetica Neue', Arial, sans-serif",
  condensed: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  display: "'DM Serif Display', Georgia, serif",
};

// A soft wash behind the type where artwork is too busy or too mixed for the
// text to be read on its own. Chosen per cover (the templates measure their own
// art), never applied by default, and drawn only from these fixed values.
const SCRIM_COLOR = { dark: "10, 10, 22", light: "255, 255, 255" };

function scrimStyle(tone, zone) {
  const rgb = SCRIM_COLOR[tone];
  if (!rgb) return "";
  const on = `rgba(${rgb}, 0.66)`;
  const off = `rgba(${rgb}, 0)`;
  if (zone === "top") return `top:0;height:60%;background:linear-gradient(to bottom, ${on}, ${off})`;
  if (zone === "bottom") return `bottom:0;height:60%;background:linear-gradient(to top, ${on}, ${off})`;
  if (zone === "author") return `bottom:0;height:30%;background:linear-gradient(to top, ${on}, ${off})`;
  return `top:12%;height:76%;background:linear-gradient(to bottom, ${off}, ${on} 28%, ${on} 72%, ${off})`;
}

const POSITION = {
  top: "flex-start",
  upper: "flex-start",
  middle: "center",
  lower: "flex-end",
  bottom: "flex-end",
};

/**
 * Render a cover.
 *
 * @param {object} cover  a row from book_covers
 * @param {object} options { width, interactive, selected }
 */
export function coverPreview(cover, { width = 220, className = "" } = {}) {
  const palette = paletteOf(cover);
  const layout = cover?.layout || {};
  const height = Math.round(width * 1.5);
  const image = safeUrl(cover?.image_url);

  const title = String(cover?.title_text || "Untitled");
  const displayTitle = layout.title_case === "upper" ? title.toUpperCase()
    : layout.title_case === "lower" ? title.toLowerCase()
    : title;

  const align = layout.title_align || "center";
  const justify = POSITION[layout.title_position] || "center";
  const stack = TYPE_STACK[layout.type_style] || TYPE_STACK.serif;

  // Type scales with the preview so a thumbnail reads like a thumbnail —
  // which is the thing the cover review is judging.
  const scale = width / 220;
  const titleSize = Math.max(11, Math.round((title.length > 34 ? 19 : title.length > 20 ? 23 : 28) * scale));

  return html`
    <div class="bb-cover ${className}" style="
      width:${width}px;height:${height}px;
      background:${palette.background};
      color:${palette.title};
      font-family:${stack};
      text-align:${align};
      align-items:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"};
      --bb-cover-accent:${palette.accent};
    ">
      ${image ? raw(html`<img class="bb-cover__art" src="${image}" alt="" loading="lazy" decoding="async">`) : ""}
      ${image && SCRIM_COLOR[layout.scrim]
        ? raw(html`<div class="bb-cover__scrim" style="${scrimStyle(layout.scrim, layout.title_position === "upper" ? "top" : layout.title_position === "lower" ? "bottom" : layout.title_position || "middle")}"></div>`)
        : ""}
      ${image && SCRIM_COLOR[layout.author_scrim]
        ? raw(html`<div class="bb-cover__scrim" style="${scrimStyle(layout.author_scrim, "author")}"></div>`)
        : ""}
      <div class="bb-cover__zone" style="justify-content:${justify};align-items:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"}">
        <div class="bb-cover__type">
          <div class="bb-cover__title" style="font-size:${titleSize}px;color:${palette.title}">${displayTitle}</div>
          ${layout.rule ? raw(html`<div class="bb-cover__rule" style="background:${palette.accent}"></div>`) : ""}
          ${cover?.subtitle_text
            ? raw(html`<div class="bb-cover__subtitle" style="font-size:${Math.max(7, Math.round(10 * scale))}px;color:${palette.subtitle}">${cover.subtitle_text}</div>`)
            : ""}
        </div>
      </div>
      <div class="bb-cover__author" style="font-size:${Math.max(8, Math.round(11 * scale))}px;color:${palette.author}">
        ${cover?.author_text || ""}
      </div>
    </div>
  `;
}

/**
 * The full wrap: back cover, spine, front.
 *
 * Proportioned from the trim size and a spine width derived from the
 * page count, the way a printer's template is. The spine figure is
 * labelled as an estimate, because the real one depends on the paper
 * the printer uses.
 */
export function coverWrap(cover, { trim, pageCount = 200, width = 620 } = {}) {
  const palette = paletteOf(cover);
  const trimWidth = trim?.width || 432;
  const trimHeight = trim?.height || 648;

  // 0.0025 inch per page is the common cream-stock figure; 0.18pt/page.
  const spinePoints = Math.max(9, pageCount * 0.18);
  const totalPoints = trimWidth * 2 + spinePoints;
  const scale = width / totalPoints;
  const height = trimHeight * scale;

  return html`
    <div class="bb-wrap" style="width:${Math.round(width)}px;height:${Math.round(height)}px">
      <div class="bb-wrap__panel bb-wrap__back"
           style="width:${trimWidth * scale}px;background:${palette.background};color:${palette.subtitle}">
        <div class="bb-wrap__blurb">${cover?.back_blurb || "The back cover copy appears here."}</div>
        <div class="bb-wrap__isbn" aria-hidden="true">
          <div class="bb-wrap__barcode"></div>
          <span>ISBN — yours to obtain</span>
        </div>
      </div>
      <div class="bb-wrap__panel bb-wrap__spine"
           style="width:${spinePoints * scale}px;background:${palette.accent};color:${contrastOn(palette.accent)}">
        <span>${cover?.spine_text || cover?.title_text || ""}</span>
      </div>
      <div class="bb-wrap__panel bb-wrap__front" style="width:${trimWidth * scale}px">
        ${raw(coverPreview(cover, { width: trimWidth * scale }))}
      </div>
    </div>
    <p class="bp-tiny bp-subtle" style="margin-top:var(--bp-2)">
      Spine estimated at ${(spinePoints / 72).toFixed(2)}in for ${pageCount} pages. Your printer's
      own template decides the real figure — check it before you upload.
    </p>
  `;
}
