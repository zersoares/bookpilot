// Tiny DOM helpers.
//
// The app renders HTML strings and swaps them in. That keeps the whole
// front end buildless — no bundler, no framework, no npm install — at
// the cost of one rule that must never be broken:
//
//   Every interpolated value is HTML-escaped unless it is explicitly
//   wrapped in raw().
//
// Book descriptions, ad copy and AI output all end up on screen, so
// this is the front end's XSS boundary.

const RAW = Symbol("raw-html");

export function raw(value) {
  return { [RAW]: true, value: String(value ?? "") };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serialise(value) {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(serialise).join("");
  if (typeof value === "object" && value[RAW]) return value.value;
  return escapeHtml(value);
}

/** html`<p>${userText}</p>` — interpolations are escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += serialise(values[i]) + strings[i + 1];
  }
  return out;
}

/** Only for values that go inside an href/src attribute. */
export function safeUrl(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("#/") || text.startsWith("/")) return text;
  // javascript:, data:, vbscript: and anything else unrecognised.
  return "";
}

/**
 * For an <img src> only. Everything safeUrl allows, plus an inline PNG, JPEG
 * or WebP: the demo has no storage, so a picture uploaded there is kept as a
 * data URL. Never use this for an href, and never widen the list — SVG can
 * carry script.
 */
export function safeImageUrl(value) {
  const text = String(value ?? "").trim();
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(text)) return text;
  return safeUrl(text);
}

export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

export function $$(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

export function mount(target, markup) {
  const node = typeof target === "string" ? $(target) : target;
  if (node) node.innerHTML = markup;
  return node;
}

/**
 * Event delegation on a container. Handlers are keyed by a
 * `data-action` attribute, which survives re-renders — no listener
 * bookkeeping, no leaks.
 */
export function delegate(container, eventName, handlers) {
  container.addEventListener(eventName, (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger || !container.contains(trigger)) return;
    const handler = handlers[trigger.dataset.action];
    if (!handler) return;
    event.preventDefault();
    handler(trigger, event);
  });
}

/** Read a form into a plain object, trimming strings. */
export function formData(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) {
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

export function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.innerHTML = `<span class="bp-spinner"></span> ${escapeHtml(label)}`;
    button.disabled = true;
  } else {
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
    button.disabled = false;
  }
}
