// Input validation.
//
// Every field that reaches the database goes through here. The point is
// not only to reject nonsense: an allow-list of writable columns is what
// stops a crafted request from setting `role: "admin"` or `ai_credits:
// 99999` on its own profile row.

import { Errors } from "./errors.js";

export const GENRES = [
  "Romance", "Thriller", "Mystery", "Fantasy", "Science Fiction",
  "Historical Fiction", "Literary Fiction", "Self-Help",
  "Personal Development", "Business", "Leadership", "Psychology",
  "Health & Wellness", "AI & Technology", "Cybersecurity", "Memoir",
  "Biography", "Children's Books", "Young Adult", "Other",
];

// meta/instagram/facebook/tiktok/google run paid campaigns (spec's ad
// platforms). linkedin/x/bluesky never do — they only ever reach here as
// the `platform` on an organic social-post creative (see
// js/views/social-templates.js), which has no ad-account connection.
export const PLATFORMS = ["meta", "instagram", "facebook", "tiktok", "google", "linkedin", "x", "bluesky"];
export const CREATIVE_FORMATS = [
  "static", "carousel", "story", "reel", "video_script", "mockup", "quote", "promo",
];
export const ANGLE_CATEGORIES = [
  "emotional", "problem_solution", "curiosity", "transformation",
  "educational", "identity", "storytelling", "social_proof",
  "authority", "contrarian", "inspirational", "practical",
];

export function str(value, field, { max = 2000, min = 0, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string") throw Errors.invalid(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw Errors.invalid(`${field} must be at least ${min} characters.`);
  }
  if (trimmed.length > max) {
    throw Errors.invalid(`${field} is too long (maximum ${max} characters).`);
  }
  return trimmed;
}

export function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw Errors.invalid(`${field} must be a whole number.`);
  }
  if (n < min || n > max) {
    throw Errors.invalid(`${field} must be between ${min} and ${max}.`);
  }
  return n;
}

export function bool(value) {
  return value === true || value === "true";
}

export function oneOf(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  if (!allowed.includes(value)) {
    throw Errors.invalid(`${field} is not one of the supported options.`);
  }
  return value;
}

export function stringArray(value, field, { maxItems = 40, maxLength = 200 } = {}) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw Errors.invalid(`${field} must be a list.`);
  if (value.length > maxItems) {
    throw Errors.invalid(`${field} can hold at most ${maxItems} entries.`);
  }
  return value
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim().slice(0, maxLength));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(value, field, { required = true } = {}) {
  if (!value) {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw Errors.invalid(`${field} is not valid.`);
  }
  return value;
}

/**
 * Accept only http(s) URLs. Anything else — javascript:, data:, file: —
 * is rejected, because these values are rendered as links in the app and
 * sent to Meta as ad destinations.
 */
export function url(value, field, { required = false, max = 2048 } = {}) {
  if (!value) {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  const text = str(value, field, { max });
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw Errors.invalid(`${field} must be a full web address starting with https://`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw Errors.invalid(`${field} must be an http or https address.`);
  }
  return parsed.toString();
}

export function isoDate(value, field, { required = false } = {}) {
  if (!value) {
    if (required) throw Errors.invalid(`${field} is required.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw Errors.invalid(`${field} must be a date.`);
  }
  return value;
}

export function currency(value, field = "Currency") {
  if (!value) return "EUR";
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw Errors.invalid(`${field} must be a three-letter currency code.`);
  }
  return value;
}

/**
 * Reduce an object to the fields listed in `spec`, running each through
 * its validator. Anything not in the spec is dropped silently — that is
 * the allow-list that protects privileged columns.
 */
export function pick(input, spec) {
  const out = {};
  for (const [field, validator] of Object.entries(spec)) {
    if (!(field in input)) continue;
    const value = validator(input[field]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}
