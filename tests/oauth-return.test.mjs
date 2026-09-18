// Returning the browser to the app after an OAuth callback.
//
// The old callbacks answered with an HTTP redirect, and what reached the
// browser had the request's one-time code and signed state merged into the
// address (app.html?code=…&state=…#/attribution?…). The replacement is a
// page, not a redirect, so there is no Location header to rewrite. These
// tests pin what that page must and must not contain, and guard against a
// callback quietly going back to Response.redirect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.BOOKPILOT_SITE_URL = "https://example.test/";

const { backToApp, appReturnUrl } = await import("../netlify/functions/bookpilot-lib/oauth-return.js");

test("the return address is the Attribution screen with the result in the fragment", () => {
  assert.equal(appReturnUrl("pinterest", "connected"), "https://example.test/app.html#/attribution?pinterest=connected");
  assert.equal(appReturnUrl("meta", "failed"), "https://example.test/app.html#/attribution?meta=failed", "a trailing slash on the site URL is not doubled");
});

test("it answers with a page, not a redirect", async () => {
  const res = backToApp("pinterest", "connected");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null, "no Location header for anything to rewrite");
  assert.match(res.headers.get("content-type"), /^text\/html/);

  const body = await res.text();
  assert.match(body, /<meta http-equiv="refresh" content="0;url=https:\/\/example\.test\/app\.html#\/attribution\?pinterest=connected">/);
  assert.match(body, /<a href="https:\/\/example\.test\/app\.html#\/attribution\?pinterest=connected">Continue<\/a>/, "a link for a browser that ignores meta refresh");
});

test("the page carries nothing from the request and asks not to be remembered or referred", async () => {
  const res = backToApp("meta", "declined");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  const body = await res.text();
  assert.match(body, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(body, /code=|state=/, "the helper never sees the callback's query, so it cannot repeat it");
});

test("every result the callbacks use yields a working page", async () => {
  for (const provider of ["meta", "pinterest"]) {
    for (const result of ["connected", "declined", "failed"]) {
      const body = await backToApp(provider, result).text();
      assert.ok(body.includes(`#/attribution?${provider}=${result}`), `${provider}/${result}`);
    }
  }
});

test("the callbacks no longer use HTTP redirects", () => {
  for (const file of ["bookpilot-meta.mjs", "bookpilot-pinterest.mjs"]) {
    const source = readFileSync(new URL(`../netlify/functions/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Response\.redirect\(/, `${file} must return through backToApp`);
    assert.match(source, /backToApp\("(meta|pinterest)", "connected"\)/, `${file} reports success through backToApp`);
  }
});
