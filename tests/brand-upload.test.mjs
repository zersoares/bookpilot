// Image upload for brand images and book covers.
//
// The browser half (canvas, fetch) is exercised by hand in the app; what is
// worth pinning here is the part that must not drift or be wrong quietly:
// the rules in image-plan.js, the safety gate for inline images, and the
// bucket policy in sql/018, which is the real enforcement.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BUCKET, ACCEPTED_TYPES, KINDS, MAX_UPLOAD_BYTES, MAX_SOURCE_BYTES,
  fitWithin, storagePath, publicUrl, looksLikeImageUrl, normaliseUrl, uploadErrorMessage,
} from "../js/core/image-plan.js";
import { safeImageUrl, safeUrl } from "../js/core/dom.js";

const sql = readFileSync(new URL("../sql/018_brand_assets_storage.sql", import.meta.url), "utf8");
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("images are shrunk to fit, never enlarged, and keep their proportions", () => {
  assert.deepEqual(fitWithin(4000, 2000, 1000), { width: 1000, height: 500 });
  assert.deepEqual(fitWithin(2000, 4000, 1000), { width: 500, height: 1000 });
  assert.deepEqual(fitWithin(300, 200, 1000), { width: 300, height: 200 }, "small images are left alone");
  assert.deepEqual(fitWithin(5000, 1, 1000), { width: 1000, height: 1 }, "never rounds to zero");
  assert.throws(() => fitWithin(0, 100, 1000));
});

test("every kind is prepared in a format the bucket accepts", () => {
  for (const [kind, spec] of Object.entries(KINDS)) {
    assert.ok(ACCEPTED_TYPES.includes(spec.type), `${kind} is encoded as ${spec.type}`);
    assert.equal(spec.type === "image/png" ? "png" : "jpg", spec.ext, `${kind}: extension matches type`);
  }
  assert.equal(KINDS.logo.type, "image/png", "a logo keeps its transparency");
  assert.ok(MAX_SOURCE_BYTES > MAX_UPLOAD_BYTES, "people may pick bigger files than we upload");
});

test("uploads go inside the person's own folder, under a fresh name", () => {
  const a = storagePath(USER.toUpperCase(), "cover", "MABC123", "x9y8z7");
  assert.equal(a, `${USER}/cover-mabc123-x9y8z7.jpg`);
  assert.notEqual(a, storagePath(USER, "cover", "mabc124", "x9y8z7"), "a new upload never reuses a name");

  assert.throws(() => storagePath("../../someone-else", "logo", "1", "2"), /Sign in/);
  assert.throws(() => storagePath("", "logo", "1", "2"), /Sign in/);
  assert.throws(() => storagePath(USER, "banner", "1", "2"), /Unknown image kind/);

  const tricky = storagePath(USER, "logo", "../x", "a/b");
  assert.equal(tricky.split("/").length, 2, "no extra path segments can be smuggled in");
});

test("the public address is the one the bucket serves", () => {
  assert.equal(
    publicUrl("https://abc.supabase.co/", `${USER}/logo-1-2.png`),
    `https://abc.supabase.co/storage/v1/object/public/${BUCKET}/${USER}/logo-1-2.png`,
  );
});

test("people type links without a scheme; add one, leave real ones alone", () => {
  assert.equal(normaliseUrl("bookpilot.org"), "https://bookpilot.org");
  assert.equal(normaliseUrl("  bookpilot.org/logo.png "), "https://bookpilot.org/logo.png");
  assert.equal(normaliseUrl("http://a.test/x.png"), "http://a.test/x.png");
  assert.equal(normaliseUrl("https://a.test/x.png"), "https://a.test/x.png");
  assert.equal(normaliseUrl(""), null);
  assert.equal(normaliseUrl(null), null);
  assert.equal(normaliseUrl("   "), null);
});

test("only real image addresses get a preview", () => {
  assert.ok(looksLikeImageUrl("https://a.test/x.png"));
  assert.ok(looksLikeImageUrl("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(!looksLikeImageUrl("bookpilot.org"), "no scheme, nothing to load");
  assert.ok(!looksLikeImageUrl("data:image/svg+xml;base64,PHN2Zz4="));
  assert.ok(!looksLikeImageUrl("javascript:alert(1)"));
  assert.ok(!looksLikeImageUrl(""));
});

test("an inline image is allowed as an <img src> and nowhere else", () => {
  assert.equal(safeImageUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(safeImageUrl("data:image/jpeg;base64,/9j/4AAQ"), "data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(safeImageUrl("https://a.test/x.png"), "https://a.test/x.png");
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PHNjcmlwdD4=",
    "javascript:alert(1)", "data:image/png,notbase64", "vbscript:x",
  ]) assert.equal(safeImageUrl(bad), "", `refuses ${bad}`);
  assert.equal(safeUrl("data:image/png;base64,iVBORw0KGgo="), "", "safeUrl (hrefs) is unchanged");
});

test("a rejected upload is explained in words a person can act on", () => {
  assert.match(uploadErrorMessage(404, { message: "Bucket not found" }), /aren't switched on/);
  assert.match(uploadErrorMessage(413, {}), /too large/);
  assert.match(uploadErrorMessage(400, { message: "mime type image/gif is not supported" }), /PNG, JPG or WebP/);
  assert.match(uploadErrorMessage(403, { message: "new row violates row-level security policy" }), /file limit|sign in/i);
  assert.match(uploadErrorMessage(500, {}), /Try again/);
});

// ---- the bucket policy ----------------------------------------------

test("the bucket only takes the formats and size the client prepares", () => {
  const mimes = sql.match(/allowed_mime_types[\s\S]*?array\[([^\]]*)\]/)?.[1]
    ?? sql.match(/array\[([^\]]*)\]/)[1];
  const inSql = [...mimes.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inSql, [...ACCEPTED_TYPES].sort(), "same formats on both sides");
  assert.ok(!/svg/i.test(mimes), "SVG can carry script and is never allowed in a public bucket");

  const limit = Number(sql.match(/'brand-assets',\s*'brand-assets',\s*true,\s*(\d+)/)?.[1]);
  assert.equal(limit, MAX_UPLOAD_BYTES, "the bucket limit equals the client's");
  assert.equal(BUCKET, "brand-assets");
});

test("a signed-in person can only touch their own folder, and only so many files", () => {
  const policies = [...sql.matchAll(/create policy "([^"]+)" on storage\.objects\s+for (\w+) to (\w+)([\s\S]*?);\s*(?=drop policy|$)/g)]
    .map(([, name, cmd, role, body]) => ({ name, cmd, role, body }));

  assert.deepEqual(policies.map((p) => p.cmd).sort(), ["delete", "insert", "select"]);
  for (const p of policies) {
    assert.equal(p.role, "authenticated", `${p.name}: signed-in users only, never anon/public`);
    assert.match(p.body, /bucket_id = 'brand-assets'/, `${p.name}: scoped to this bucket`);
    assert.match(p.body, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/, `${p.name}: own folder only`);
  }
  const insert = policies.find((p) => p.cmd === "insert");
  assert.match(insert.body, /\)\s*<\s*50/, "there is a per-person cap on files");
  assert.ok(!policies.some((p) => p.cmd === "update"), "files are never overwritten, only replaced by new ones");
});
