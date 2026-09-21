// Partials shared by the views.

import { html, raw, safeUrl } from "../core/dom.js";
import * as fmt from "../core/format.js";
import { isDemo } from "../core/api.js";

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
  const url = safeUrl(book?.cover_url);
  if (url) {
    return html`<img class="bp-cover ${className}" src="${url}" alt="Cover of ${book.title}" loading="lazy">`;
  }
  return html`<div class="bp-cover bp-cover--placeholder ${className}" aria-hidden="true">${book?.title || "No cover"}</div>`;
}

/**
 * The picture box at the top of a creative card. A creative only has an
 * image when one was really produced for it (`media_url`), and the box says
 * so: the pictures are AI-generated concept images from the art direction,
 * not finished ad artwork. Without an image it stays the plain gradient —
 * never a stand-in dressed up as artwork.
 */
export function creativePreview(creative, { label = "", tall = false } = {}) {
  // media_url is a free URL column; only show it when it looks like a picture.
  const mediaUrl = safeUrl(creative.media_url);
  const url = /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(mediaUrl) ? "" : mediaUrl;
  const tallClass = tall ? "bp-creative__preview--reel" : "";
  const headline = creative.headline || "Untitled creative";
  if (!url) {
    return html`
      <div class="bp-creative__preview ${tallClass}">
        <span class="bp-badge bp-badge--accent" style="align-self:flex-start">${label}</span>
        <div class="bp-creative__headline">${headline}</div>
      </div>`;
  }
  return html`
    <div class="bp-creative__preview bp-creative__preview--image ${tallClass}">
      <img class="bp-creative__img" src="${url}" alt="${creative.body?.image_alt || ""}" loading="lazy" decoding="async">
      <span class="bp-creative__concept" title="Generated from the art direction. Not finished ad artwork.">AI concept image</span>
      <span class="bp-badge bp-badge--accent" style="align-self:flex-start">${label}</span>
      <div class="bp-creative__headline">${headline}</div>
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
