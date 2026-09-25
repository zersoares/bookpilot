// Partials shared by the views.

import { html, raw, safeUrl, safeImageUrl } from "../core/dom.js";
import * as fmt from "../core/format.js";
import { isDemo } from "../core/api.js";
import { isSampleImage as isCreativeSample, sampleAltFor as creativeSampleAltFor } from "./creative-templates.js";
import { isSampleImage as isSocialSample, sampleAltFor as socialSampleAltFor } from "./social-templates.js";

const isSampleImage = (url) => isCreativeSample(url) || isSocialSample(url);
const sampleAltFor = (url) => creativeSampleAltFor(url) || socialSampleAltFor(url);

export function pageHead({ title, description, actions = "" }) {
  return html`
    <div class="bp-page-head">
      <div>
        <h1>${title}</h1>
        ${description ? raw(html`<p>${description}</p>`) : ""}
      </div>
      <div class="bp-row">${raw(actions)}</div>
    </div>
  `;
}

export function demoBadge() {
  return isDemo() ? '<span class="bp-demo-badge">Demo data</span>' : "";
}

export function emptyState({ icon = "◇", title, text, action = "" }) {
  return html`
    <div class="bp-empty">
      <div class="bp-empty__icon">${icon}</div>
      <div class="bp-empty__title">${title}</div>
      <p class="bp-empty__text">${text}</p>
      ${raw(action)}
    </div>
  `;
}

export function loading(rows = 3) {
  return `<div class="bp-loading">${
    Array.from({ length: rows }, () => '<div class="bp-skeleton bp-loading__row"></div>').join("")
  }</div>`;
}

export function errorBox(message, retryAction = "") {
  return html`
    <div class="bp-alert bp-alert--danger">
      <span class="bp-alert__icon">!</span>
      <div>
        <div class="bp-alert__title">That didn't work</div>
        <div>${message}</div>
        ${retryAction ? raw(`<div style="margin-top:var(--bp-3)">${retryAction}</div>`) : ""}
      </div>
    </div>
  `;
}

export function cover(book, { className = "" } = {}) {
  const url = safeImageUrl(book?.cover_url);
  if (url) {
    return html`<img class="bp-cover ${className}" src="${url}" alt="Cover of ${book.title}" loading="lazy">`;
  }
  return html`<div class="bp-cover bp-cover--placeholder ${className}" aria-hidden="true">${book?.title || "No cover"}</div>`;
}

/**
 * The picture box at the top of a creative card. What it shows, in order:
 *
 *   1. The creative's own picture (`media_url`). A demo creative's is an
 *      AI-generated concept image; a template draft's is that template's
 *      sample. The box says which, and neither is finished ad artwork.
 *      The book's cover is drawn on top: small in a corner, or large and
 *      centred when the cover is the subject of the ad (mockup, promo).
 *   2. Failing that, the book itself: its cover, large, over a soft blur of
 *      the same cover. That is a real picture of the real thing.
 *   3. Failing that, the plain gradient, and, when we know the book, a
 *      link to add its cover. Never a stand-in dressed up as artwork.
 */
export function creativePreview(creative, { label = "", tall = false, aspect = "", coverPosition = "", book = null, showCover = true } = {}) {
  // media_url is a free URL column; only show it when it looks like a picture.
  const mediaUrl = safeUrl(creative.media_url);
  const image = /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(mediaUrl) ? "" : mediaUrl;
  // `showCover: false` keeps the box to the creative's own picture only — used
  // in grid galleries, where the same small book-cover badge stamped on every
  // card just repeats itself and hides how different the pictures actually are.
  const coverUrl = showCover ? safeImageUrl(book?.cover_url) : "";
  // `aspect` names a modifier class directly (e.g. "landscape", for a
  // platform's exact post shape); `tall` is the older reel/story shorthand.
  const tallClass = aspect ? ` bp-creative__preview--${aspect}` : (tall ? " bp-creative__preview--reel" : "");
  const headline = creative.headline || "Untitled creative";
  const heading = raw(html`
      <span class="bp-badge bp-badge--accent" style="align-self:flex-start">${label}</span>
      <div class="bp-creative__headline">${headline}</div>`);
  const cover = (position) => coverUrl
    ? raw(html`<img class="bp-creative__cover bp-creative__cover--${position}" src="${coverUrl}"
        alt="Cover of ${book?.title || "the book"}" loading="lazy" decoding="async">`)
    : "";

  if (image) {
    const sample = isSampleImage(image);
    const subject = creative.format === "mockup" || creative.format === "promo";
    return html`
      <div class="bp-creative__preview bp-creative__preview--image${tallClass}">
        <img class="bp-creative__img" src="${image}" alt="${sample ? sampleAltFor(image) : creative.body?.image_alt || ""}" loading="lazy" decoding="async">
        ${cover(coverPosition || (subject ? "hero" : "thumb"))}
        <span class="bp-creative__concept" title="${sample
          ? "A sample of the look, not artwork for your book."
          : "Generated from the art direction. Not finished ad artwork."}">${sample ? "Sample image" : "AI concept image"}</span>
        ${heading}
      </div>`;
  }

  if (coverUrl) {
    return html`
      <div class="bp-creative__preview bp-creative__preview--image${tallClass}">
        <img class="bp-creative__img bp-creative__img--blur" src="${coverUrl}" alt="" loading="lazy" decoding="async">
        ${cover("hero")}
        ${heading}
      </div>`;
  }

  return html`
    <div class="bp-creative__preview${tallClass}">
      ${book?.id ? raw(html`<a class="bp-creative__nocover" href="#/books/${book.id}/edit">Add your book cover</a>`) : ""}
      ${heading}
    </div>`;
}

export function statusBadge(status) {
  const tone = fmt.statusTone(status);
  return html`<span class="bp-badge ${tone ? `bp-badge--${tone}` : ""}">${fmt.titleCase(status)}</span>`;
}

/**
 * The predicted-quality score. The label matters: it is a judgement
 * about the creative before it runs, not a forecast of sales (spec §46).
 */
export function scoreBadge(score) {
  if (score === null || score === undefined) {
    return '<span class="bp-badge">Not scored</span>';
  }
  return html`<span class="bp-badge bp-badge--${fmt.scoreTone(score)}" title="Predicted creative quality, not a prediction of sales">
    <span class="bp-score"><b>${score}</b>/100</span>
  </span>`;
}

const CONFIDENCE_LABEL = {
  insufficient: ["Not enough data", ""],
  low: ["Low confidence", "warning"],
  medium: ["Medium confidence", "primary"],
  high: ["High confidence", "success"],
};

export function confidenceBadge(level) {
  const [label, tone] = CONFIDENCE_LABEL[level] || CONFIDENCE_LABEL.insufficient;
  return html`<span class="bp-badge ${tone ? `bp-badge--${tone}` : ""}">${label}</span>`;
}

/**
 * The eight headline metrics (spec §19).
 *
 * `hasData: false` renders the "not enough data" state rather than a
 * wall of zeroes, and any individual rate that came back null renders
 * as N/A.
 */
export function statGrid(metrics, currency = "EUR") {
  if (!metrics || !metrics.hasData) {
    return html`
      <div class="bp-panel bp-center">
        <strong>Not enough data yet</strong>
        <p class="bp-small bp-muted" style="margin:6px 0 0">
          Numbers appear here once a campaign has been delivering for a day or two.
        </p>
      </div>
    `;
  }

  const stat = (label, value, meta = "") => html`
    <div class="bp-stat">
      <div class="bp-stat__label">${label}</div>
      <div class="bp-stat__value ${value === "N/A" ? "bp-stat__value--na" : ""}">${value}</div>
      ${meta ? raw(html`<div class="bp-stat__meta">${meta}</div>`) : ""}
    </div>
  `;

  return html`
    <div class="bp-stat-grid bp-stat-grid--quad">
      ${raw(stat("Sales", fmt.number(metrics.conversions)))}
      ${raw(stat("Revenue", fmt.money(metrics.revenueCents, currency)))}
      ${raw(stat("Ad spend", fmt.money(metrics.spendCents, currency)))}
      ${raw(stat("ROAS", fmt.multiple(metrics.roas)))}
      ${raw(stat("CPA", fmt.money(metrics.cpa === null ? null : Math.round(metrics.cpa), currency)))}
      ${raw(stat("CTR", fmt.percent(metrics.ctr)))}
      ${raw(stat("CPC", fmt.money(metrics.cpc === null ? null : Math.round(metrics.cpc), currency)))}
      ${raw(stat("Conversion rate", fmt.percent(metrics.conversionRate)))}
    </div>
  `;
}

/** Bullet list that degrades to nothing rather than an empty <ul>. */
export function bullets(items, { limit = 8 } = {}) {
  const list = (items || []).filter(Boolean).slice(0, limit);
  if (!list.length) return "";
  return `<ul class="bp-small bp-muted" style="padding-left:1.05rem;margin:0">${
    list.map((item) => html`<li>${item}</li>`).join("")
  }</ul>`;
}

export function chips(items, { limit = 8 } = {}) {
  const list = (items || []).filter(Boolean).slice(0, limit);
  if (!list.length) return "";
  return `<div class="bp-chips">${list.map((item) => html`<span class="bp-chip">${item}</span>`).join("")}</div>`;
}

/** Turns a plain-text paragraph block into safe HTML paragraphs. */
export function paragraphs(text) {
  if (!text) return "";
  return String(text)
    .split(/\n{2,}/)
    .map((block) => html`<p>${block}</p>`)
    .join("");
}

export { fmt };
