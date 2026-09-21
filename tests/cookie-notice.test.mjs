// The cookie and storage notice.
//
// The rendering is checked by eye and in the browser. What is pinned here is
// what must not go wrong quietly: the notice listing everything the app really
// stores (and the cookie policy agreeing), and the consent rules.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORIES, CONSENT_KEY, CONSENT_VERSION, MAX_AGE_DAYS,
  modeOf, optionalOf, parseConsent, buildRecord, acceptAll, rejectOptional, allows,
} from "../js/cookie-notice.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-21T12:00:00Z");

// A category that does not exist on the real site, to prove the notice turns
// into a real choice the moment one is added.
const WITH_ANALYTICS = [
  ...CATEGORIES,
  { id: "analytics", name: "Analytics", required: false, desc: "x", items: [] },
  { id: "marketing", name: "Marketing", required: false, desc: "x", items: [] },
];

// ---- the inventory is complete ---------------------------------------

function jsFiles(dir) {
  return readdirSync(join(ROOT, dir), { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

test("every browser storage key the app uses is listed in the notice", () => {
  const used = new Set();
  for (const file of jsFiles("js")) {
    for (const m of read(file).matchAll(/\b[A-Z_]*KEY\s*=\s*["'](bookpilot\.[\w.]+)["']/g)) used.add(m[1]);
  }
  const listed = new Set(CATEGORIES.flatMap((c) => c.items.map((i) => i.name)));

  assert.ok(used.size >= 4, `expected to find the app's keys, found ${[...used]}`);
  for (const key of used) assert.ok(listed.has(key), `${key} is stored by the app but missing from the cookie notice`);
  for (const key of listed) assert.ok(used.has(key), `${key} is listed in the notice but the app never stores it`);
  assert.ok(used.has(CONSENT_KEY), "the notice's own record is part of the inventory");
});

test("the cookie policy page lists every one of them too", () => {
  const policy = read("cookies.html");
  for (const item of CATEGORIES.flatMap((c) => c.items)) {
    assert.ok(policy.includes(item.name), `cookies.html does not mention ${item.name}`);
  }
  assert.ok(!/does not show a consent banner/i.test(policy), "the policy still says there is no banner");
  assert.match(policy, /Cookie settings/, "and tells people where to reopen it");
});

test("nothing the notice lists is a cookie, and the copy does not claim tracking either way", () => {
  for (const item of CATEGORIES.flatMap((c) => c.items)) {
    assert.match(item.type, /^(localStorage|sessionStorage)$/, `${item.name}: is not a cookie`);
    assert.ok(item.purpose && item.duration, `${item.name}: needs a purpose and a lifetime`);
  }
  const necessary = CATEGORIES.find((c) => c.id === "necessary");
  assert.ok(necessary.required, "necessary cannot be switched off");
});

// ---- consent rules ---------------------------------------------------

test("with nothing optional, the notice is only a notice", () => {
  assert.equal(optionalOf().length, 0);
  assert.equal(modeOf(), "notice");
  assert.equal(modeOf(WITH_ANALYTICS), "choice");
});

test("a stored choice is trusted only while it still means something", () => {
  const fresh = buildRecord({}, NOW);
  assert.deepEqual(parseConsent(JSON.stringify(fresh), NOW + DAY), fresh);
  assert.equal(parseConsent(null, NOW), null);
  assert.equal(parseConsent("not json", NOW), null);
  assert.equal(parseConsent("{}", NOW), null);
  assert.equal(parseConsent(JSON.stringify({ ...fresh, v: CONSENT_VERSION + 1 }), NOW), null, "older format is asked again");
  assert.equal(parseConsent(JSON.stringify({ ...fresh, date: "yesterday-ish" }), NOW), null);
  assert.equal(parseConsent(JSON.stringify({ ...fresh, date: new Date(NOW + 5 * DAY).toISOString() }), NOW), null, "a date in the future is not believed");
  assert.equal(parseConsent(JSON.stringify(fresh), NOW + (MAX_AGE_DAYS + 1) * DAY), null, "asked again after a year");
  assert.ok(parseConsent(JSON.stringify(fresh), NOW + (MAX_AGE_DAYS - 1) * DAY), "but not before");
});

test("a choice made before an optional category existed does not count for it", () => {
  const old = buildRecord({}, NOW); // written when only "necessary" existed
  assert.ok(parseConsent(JSON.stringify(old), NOW, CATEGORIES));
  assert.equal(parseConsent(JSON.stringify(old), NOW, WITH_ANALYTICS), null, "a new category means asking again");
});

test("accepting and refusing are symmetric, and anything unnamed is refused", () => {
  assert.deepEqual(acceptAll(NOW, WITH_ANALYTICS).choices, { analytics: true, marketing: true });
  assert.deepEqual(rejectOptional(NOW, WITH_ANALYTICS).choices, { analytics: false, marketing: false });
  assert.deepEqual(buildRecord({ analytics: true }, NOW, WITH_ANALYTICS).choices, { analytics: true, marketing: false });
  assert.deepEqual(buildRecord({ analytics: "yes", bogus: true }, NOW, WITH_ANALYTICS).choices, { analytics: false, marketing: false },
    "only a real true counts, and unknown categories are dropped");
  assert.deepEqual(acceptAll(NOW).choices, {}, "with nothing optional there is nothing to accept");
});

test("optional code may only run after a yes", () => {
  const none = null;
  const accepted = acceptAll(NOW, WITH_ANALYTICS);
  const rejected = rejectOptional(NOW, WITH_ANALYTICS);
  const partial = buildRecord({ analytics: true }, NOW, WITH_ANALYTICS);

  assert.equal(allows("necessary", none, WITH_ANALYTICS), true);
  assert.equal(allows("analytics", none, WITH_ANALYTICS), false, "before any choice, off");
  assert.equal(allows("analytics", rejected, WITH_ANALYTICS), false);
  assert.equal(allows("analytics", accepted, WITH_ANALYTICS), true);
  assert.equal(allows("marketing", partial, WITH_ANALYTICS), false, "categories are independent");
  assert.equal(allows("analytics", partial, WITH_ANALYTICS), true);
  assert.equal(allows("nonexistent", accepted, WITH_ANALYTICS), false, "an unknown category is never allowed");
});

// ---- where it appears ------------------------------------------------

test("the notice is on every product page, and not on the author's books page", () => {
  for (const page of ["index.html", "app.html", "404.html", "privacy.html", "terms.html", "cookies.html"]) {
    assert.match(read(page), /<script type="module" src="\/js\/cookie-notice\.js"><\/script>/, `${page} loads the notice`);
  }
  // /books/ stores nothing and says so in its own footer; a banner there would contradict it.
  assert.ok(!read("books/index.html").includes("cookie-notice"), "/books/ has no banner");
});

test("people can reopen it, and the link still works as a plain link without scripts", () => {
  for (const page of ["index.html", "privacy.html", "terms.html", "cookies.html"]) {
    assert.match(read(page), /<a href="\/cookies\.html" data-cookie-settings>Cookie settings<\/a>/, `${page} footer link`);
  }
  assert.match(read("js/views/settings.js"), /data-cookie-settings/, "and in Settings");
});
