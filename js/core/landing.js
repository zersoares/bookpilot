// Reader-magnet landing pages: the pure rules shared by the browser and
// the server (spec: js/core/metrics.js carries the same "single source
// of truth" pattern — the serverless function re-exports this file
// rather than keeping its own copy that could quietly drift).
//
// Nothing here throws or touches the DOM: the browser (the editor form,
// and the demo workspace's in-memory API) and the server (validating a
// real request, and escaping author text into the public HTML page) each
// wrap these with their own error type.

export const RESERVED_SLUGS = new Set([
  "api", "app", "app.html", "track", "sql", "assets", "fonts", "index.html",
  "books", "l", "subscribe", "admin", "static", "index", "404",
]);

// A single leading/trailing char plus a mandatory middle-and-tail group,
// so the shortest possible match is 2 characters — a trailing `?` on the
// whole group would let a bare single letter through.
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])$/;

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "book";
}

/** Whether `value` is a syntactically valid, non-reserved slug already. */
export function isValidSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

// Deliberately simple: this gates a lead-capture form, not an account.
// RFC-legal edge cases (quoted local parts, IP literals) are vanishingly
// rare from a real reader and not worth rejecting a real address over.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Whether `value` is a plausible email address. */
export function isValidEmail(value) {
  const email = String(value || "").trim();
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An http(s) URL for use in an href/src attribute, or "" if unsafe. */
export function safeAttrUrl(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return escapeHtml(u.toString());
  } catch {
    return "";
  }
}
