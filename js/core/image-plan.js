// The rules for brand images (logo, author photo), with no browser or
// network in them so they can be tested under node.
//
// core/upload.js does the canvas and fetch work and takes every decision
// from here. The limits are mirrored in sql/018_brand_assets_storage.sql —
// the bucket enforces them again, because the browser is not a trust
// boundary — and tests/brand-upload.test.mjs fails if the two disagree.

export const BUCKET = "brand-assets";

/** Formats we accept. SVG is left out on purpose: it can carry script. */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** What a person may pick. Larger originals are shrunk before upload. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/** What the bucket will take. Matches file_size_limit in the migration. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * How each kind of image is prepared. A logo keeps its transparency, so it
 * stays a PNG; a photo has none to keep, and JPEG is far smaller. Re-encoding
 * either one also drops the original file's metadata, including any GPS
 * position an author photo may have carried.
 */
export const KINDS = {
  logo: { maxEdge: 1000, type: "image/png", ext: "png" },
  photo: { maxEdge: 1200, type: "image/jpeg", ext: "jpg", quality: 0.88 },
  // A book cover: the longest side is the height, and 1600px is plenty for a
  // storefront or an ad while staying well under the 2 MB the bucket allows.
  cover: { maxEdge: 1600, type: "image/jpeg", ext: "jpg", quality: 0.9 },
};

/** The demo has no storage; it keeps the image in the page, so keep it small. */
export const DEMO_MAX_EDGE = 400;

/** Scale to fit inside a square of `maxEdge`, never enlarging. */
export function fitWithin(width, height, maxEdge) {
  if (!(width > 0) || !(height > 0)) throw new Error("The image has no size.");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where an upload goes: <user id>/<kind>-<time>-<random>.<ext>. The first
 * folder is the user's id because the storage policy checks it — a person can
 * only write inside their own. A fresh name every time means an upload never
 * replaces a file that a published book may still point at.
 */
export function storagePath(userId, kind, stamp, random) {
  if (!UUID.test(String(userId))) throw new Error("Sign in to upload an image.");
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown image kind: ${kind}`);
  const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${String(userId).toLowerCase()}/${kind}-${safe(stamp)}-${safe(random)}.${spec.ext}`;
}

/** The address anyone can open, once the file is in a public bucket. */
export function publicUrl(base, path) {
  return `${String(base).replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Is this something an <img> can show without a network round trip to guess? */
export function looksLikeImageUrl(value) {
  return /^(https?:\/\/[^\s]+|data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+)$/i.test(String(value || "").trim());
}

/**
 * "bookpilot.org/logo.png" is what people type; the server wants a full URL.
 * Add https:// when there is no scheme, and leave everything else alone.
 */
export function normaliseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^(https?:|data:)/i.test(text) ? text : `https://${text}`;
}

/** A sentence a person can act on, for a storage response that said no. */
export function uploadErrorMessage(status, body = {}) {
  const said = String(body.message || body.error || "").toLowerCase();
  if (status === 404 || said.includes("bucket not found")) {
    return "Image uploads aren't switched on for this deployment yet. Paste a link instead.";
  }
  if (status === 413 || said.includes("too large") || said.includes("exceeded the maximum")) {
    return "That image is too large even after shrinking. Try a smaller one.";
  }
  if (said.includes("mime type") || said.includes("not supported")) {
    return "Use a PNG, JPG or WebP image.";
  }
  if (status === 401 || status === 403 || said.includes("row-level security") || said.includes("row level security")) {
    return "You can't upload right now. You may have hit the file limit, or you need to sign in again.";
  }
  return "The upload didn't go through. Try again, or paste a link instead.";
}
