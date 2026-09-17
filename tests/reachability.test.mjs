// `capabilities.database` decides whether the client shows the real
// workspace or the demo one, so it has to mean "the database answers",
// not "the environment variables are set". A free-tier Supabase project
// that idles out stops resolving in DNS while its configuration stays
// exactly where it was.
//
// The distinction these tests pin down: any HTTP reply proves the project
// is there, even an unauthorised one. Only a transport failure counts as
// unreachable, because a missing table or an RLS refusal is a query
// problem and must not push the whole app into demo mode.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";

const { databaseReachable } = await import("../netlify/functions/bookpilot-lib/db.js");

/** Swap in a fetch implementation, and silence the expected logging. */
async function withFetch(impl, run) {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = impl;
  console.error = () => {};
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
}

test("an HTTP reply means reachable, even when it refuses the request", async () => {
  for (const status of [200, 400, 401, 403, 404]) {
    const reachable = await withFetch(
      async () => new Response("{}", { status }),
      () => databaseReachable()
    );
    assert.equal(reachable, true, `status ${status} should count as reachable`);
  }
});

test("a transport failure means unreachable", async () => {
  const reachable = await withFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    () => databaseReachable()
  );
  assert.equal(reachable, false);
});

test("a project that never answers is unreachable rather than a hang", async () => {
  const started = Date.now();
  const reachable = await withFetch(
    (url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    () => databaseReachable({ timeoutMs: 120 })
  );
  assert.equal(reachable, false);
  assert.ok(Date.now() - started < 2000, "should give up on its own timeout");
});

test("the probe identifies itself with the anon key and hits the REST root", async () => {
  let seen = null;
  await withFetch(
    async (url, init) => {
      seen = { url: String(url), headers: init.headers };
      return new Response("{}", { status: 200 });
    },
    () => databaseReachable()
  );
  assert.equal(seen.url, "https://example.supabase.co/rest/v1/");
  assert.equal(seen.headers.apikey, "test-anon-key");
});
