// Bulk inserts of uneven rows.
//
// The first time the Book Builder's blueprint ever got as far as saving
// (2026-11-16, once the AI call no longer timed out), its four parts were saved
// and then the chapters were refused with a 400: PostgREST rejects a bulk
// insert whose objects do not all have the same keys, and the blueprint's rows
// differ (an introduction has no part or number, a chapter without a subtitle
// has no subtitle key at all, because JSON drops undefined). The same shape of
// bug sat in every handler that inserts a list built from model output.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example-project.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";

const { groupByShape, dbAsService } = await import("../netlify/functions/bookpilot-lib/db.js");

function fakePostgrest() {
  const posts = [];
  const original = globalThis.fetch;
  let seq = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const keys = (Array.isArray(body) ? body : [body]).map((row) => Object.keys(row).sort().join(","));
    // what the real service does
    if (Array.isArray(body) && new Set(keys).size > 1) {
      return new Response(JSON.stringify({ code: "PGRST102", message: "All object keys must match" }), { status: 400 });
    }
    posts.push({ url: String(url), prefer: init.headers?.Prefer, body });
    const saved = (Array.isArray(body) ? body : [body]).map((row) => ({ id: `id-${++seq}`, ...row }));
    return new Response(init.headers?.Prefer?.includes("minimal") ? null : JSON.stringify(saved), { status: init.headers?.Prefer?.includes("minimal") ? 204 : 201 });
  };
  return { posts, restore: () => { globalThis.fetch = original; } };
}

const intro = { project_id: "p", kind: "introduction", title: "Introduction", sort_order: 1, status: "planned" };
const chapter = (n, subtitle) => ({
  project_id: "p", part_id: "part", kind: "chapter", number: n, title: `Chapter ${n}`,
  subtitle, key_concepts: [], sort_order: n + 1, status: "planned",
});

// ---- groupByShape ---------------------------------------------------------

test("rows with the same fields are one group", () => {
  const groups = groupByShape([chapter(1, "a"), chapter(2, "b"), chapter(3, "c")]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].indexes, [0, 1, 2]);
});

test("a field whose value is undefined does not count: JSON would drop it", () => {
  const groups = groupByShape([chapter(1, "a"), chapter(2, undefined)]);
  assert.equal(groups.length, 2, "one has a subtitle key and one has none on the wire");
  // but an explicit null is a value, and is kept
  assert.equal(groupByShape([chapter(1, "a"), chapter(2, null)]).length, 1);
});

test("groups remember where each row came from", () => {
  const groups = groupByShape([intro, chapter(1, "a"), chapter(2, "b"), intro]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.indexes).sort(), [[0, 3], [1, 2]]);
});

test("key order does not make rows different", () => {
  assert.equal(groupByShape([{ a: 1, b: 2 }, { b: 3, a: 4 }]).length, 1);
});

// ---- insert ---------------------------------------------------------------

test("an uneven blueprint saves: one request per shape, and the rows come back in the order they were given", async () => {
  const net = fakePostgrest();
  try {
    const rows = [intro, chapter(1, "x"), chapter(2, undefined), chapter(3, "y"), { ...intro, kind: "conclusion", title: "End" }];
    const saved = await dbAsService().insert("book_chapters", rows);
    assert.equal(saved.length, rows.length);
    assert.deepEqual(saved.map((r) => r.title), ["Introduction", "Chapter 1", "Chapter 2", "Chapter 3", "End"]);
    assert.ok(net.posts.length >= 3 && net.posts.length <= 4, `one request per shape, got ${net.posts.length}`);
    for (const post of net.posts) {
      assert.equal(new Set(post.body.map((r) => Object.keys(r).sort().join(","))).size, 1, "no request mixes shapes");
      assert.equal(post.prefer, "return=representation");
    }
  } finally { net.restore(); }
});

test("the fake service really does refuse the old behaviour (so the test above means something)", async () => {
  const net = fakePostgrest();
  try {
    const res = await fetch("https://example-project.supabase.co/rest/v1/book_chapters", {
      method: "POST", body: JSON.stringify([intro, chapter(1, "x")]),
    });
    assert.equal(res.status, 400);
  } finally { net.restore(); }
});

test("even rows still go in as a single request, exactly as before", async () => {
  const net = fakePostgrest();
  try {
    const saved = await dbAsService().insert("book_chapters", [chapter(1, "a"), chapter(2, "b")]);
    assert.equal(net.posts.length, 1);
    assert.equal(saved.length, 2);
  } finally { net.restore(); }
});

test("a single row, an empty list and a no-return insert are unchanged", async () => {
  const net = fakePostgrest();
  try {
    const one = await dbAsService().insert("book_chapters", intro);
    assert.equal(one.title, "Introduction");
    assert.equal(net.posts[0].body.title, "Introduction", "a lone object stays a lone object");

    const none = await dbAsService().insert("book_chapters", [], { returning: false });
    assert.equal(none, null);

    const quiet = await dbAsService().insert("audit", [intro, chapter(1, "a")], { returning: false });
    assert.equal(quiet, null);
    assert.ok(net.posts.every((p) => p.prefer === "return=minimal" || p === net.posts[0]));
  } finally { net.restore(); }
});
