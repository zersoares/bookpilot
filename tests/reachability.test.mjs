// `capabilities.database` decides whether the client shows the real
// workspace or the demo one, so it has to mean "the database answers",
// not "the environment variables are set". A free-tier Supabase project
// that idles out stops resolving in DNS while its configuration stays
// exactly where it was.
//
// The distinction these tests pin down: an unauthorised or not-found reply
// proves the project is there and must NOT push the app into demo mode,
// because a missing table or an RLS refusal is a query problem. But three
// things do mean unusable — no answer at all, a 5xx from the platform, and
// PGRST002, which is PostgREST answering politely with a cold schema cache
// while every query fails. A restore passes through the latter two.

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

test("a 5xx means the platform cannot serve, so not reachable", async () => {
  for (const status of [500, 502, 503, 504]) {
    const reachable = await withFetch(
      async () => new Response("upstream error", { status }),
      () => databaseReachable()
    );
    assert.equal(reachable, false, `status ${status} should not count as reachable`);
  }
});

test("a cold PostgREST schema cache is not reachable, whatever the status", async () => {
  // Observed verbatim while a paused project was coming back up.
  const body = JSON.stringify({
    code: "PGRST002",
    details: null,
    hint: null,
    message: "Could not query the database for the schema cache. Retrying.",
  });
  for (const status of [200, 404, 503]) {
    const reachable = await withFetch(
      async () => new Response(body, { status }),
      () => databaseReachable()
    );
    assert.equal(reachable, false, `PGRST002 at ${status} should not count as reachable`);
  }
});

test("an ordinary 404 is still reachable — a missing table is not a dead project", async () => {
  const body = JSON.stringify({ code: "42P01", message: 'relation "public.nope" does not exist' });
  const reachable = await withFetch(
    async () => new Response(body, { status: 404 }),
    () => databaseReachable()
  );
  assert.equal(reachable, true);
});
