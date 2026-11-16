// Book Builder AI steps as background jobs.
//
// Found testing the live site end to end (2026-11-16): positioning came back
// in 26 seconds, the blueprint failed twice at 26 and nothing after it could be
// reached. The Book Builder's agents ran inside a web request (stopped at 30
// seconds, AI request at 25) while only the AI Strategy steps had been moved to
// background jobs. These tests pin the same cure for the Book Builder: the work
// runs in a job with the longer limit, and the page gets the handler's own
// answer back from the finished job.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

const { createBbJob, runJob, getJob, publicJob, BB_ROUTES, BB_PREFIX, isBbJob } =
  await import("../netlify/functions/bookpilot-lib/ai-jobs.js");
const { currentAiTimeout, BACKGROUND_TIMEOUT_MS } = await import("../netlify/functions/bookpilot-lib/ai.js");
const bbAi = await import("../netlify/functions/bookbuilder-ai.mjs");

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const ME = { id: "11111111-1111-4111-8111-111111111111" };
const OTHER = { id: "22222222-2222-4222-8222-222222222222" };
const PROJECT = "44444444-4444-4444-8444-444444444444";
const CH1 = "55555555-5555-4555-8555-555555555551";
const CH2 = "55555555-5555-4555-8555-555555555552";
const NOW = Date.parse("2026-11-16T12:00:00Z");

// ---- a tiny in-memory stand-in for the database client ------------------

function fakeDb(tables, { asUser = null } = {}) {
  const matches = (row, o = {}) => {
    for (const [k, v] of Object.entries(o.eq || {})) if (row[k] !== v) return false;
    for (const [k, vs] of Object.entries(o.in || {})) if (vs?.length && !vs.includes(row[k])) return false;
    for (const [k, cond] of Object.entries(o.filters || {})) {
      let m = /^gte\.(.+)$/.exec(cond);
      if (m && !(String(row[k]) >= m[1])) return false;
      m = /^params->>(\w+)$/.exec(k);
      if (m && `eq.${row.params?.[m[1]]}` !== cond) return false;
    }
    return true;
  };
  const visible = (row) => !asUser || row.user_id === asUser;
  let seq = 0;
  return {
    tables,
    async select(t, o = {}) {
      let rows = (tables[t] || []).filter((r) => visible(r) && matches(r, o));
      rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return o.limit ? rows.slice(0, o.limit) : rows;
    },
    async selectOne(t, o = {}) { return (await this.select(t, { ...o, limit: 1 }))[0] || null; },
    async insert(t, row) {
      const saved = { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, "0")}`, created_at: new Date(NOW).toISOString(), ...row };
      (tables[t] ||= []).push(saved);
      return saved;
    },
    async update(t, patch, o = {}) {
      const row = (tables[t] || []).find((r) => matches(r, o));
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

const ctxFor = (user, tables) => ({ user, profile: { ai_credits: 100, role: null }, db: fakeDb(tables, { asUser: user.id }) });
const respond = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

// ---- which steps -----------------------------------------------------------

test("every Book Builder agent except approving positioning runs as a job", () => {
  const routes = Object.keys(read("netlify/functions/bookbuilder-ai.mjs").match(/const ROUTES = \{[\s\S]*?\n\};/)[0]
    .split("\n").reduce((acc, line) => {
      const m = /^\s+"?([a-z-]+)"?[:,]/.exec(line);
      if (m) acc[m[1]] = true;
      return acc;
    }, {}));
  assert.deepEqual([...BB_ROUTES].sort(), routes.filter((r) => r !== "approve-positioning").sort());
});

test("the function exports one runner per job route, under the stored name", () => {
  assert.deepEqual(Object.keys(bbAi.JOB_RUNNERS).sort(), BB_ROUTES.map((r) => BB_PREFIX + r).sort());
  for (const runner of Object.values(bbAi.JOB_RUNNERS)) assert.equal(typeof runner, "function");
});

// ---- createBbJob -----------------------------------------------------------

test("only a known agent can be queued, and a plain database write is not one", async () => {
  const tables = { ai_jobs: [] };
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const create = (body) => createBbJob(ctx, body, { service: svc, now: NOW });
  await assert.rejects(create({ route: "approve-positioning", project_id: PROJECT }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "analyze", project_id: PROJECT }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "__proto__", project_id: PROJECT }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ project_id: PROJECT }), (e) => e.code === "invalid_input");
  assert.equal(tables.ai_jobs.length, 0, "nothing queued for a rejected request");
});

test("an id that is not an id is refused, and so is an absurdly large request", async () => {
  const ctx = ctxFor(ME, { ai_jobs: [] });
  const svc = fakeDb({});
  await assert.rejects(createBbJob(ctx, { route: "chapter", chapter_id: "not-a-uuid" }, { service: svc, now: NOW }),
    (e) => e.code === "invalid_input");
  await assert.rejects(createBbJob(ctx, { route: "positioning", project_id: PROJECT, notes: "x".repeat(50_000) }, { service: svc, now: NOW }),
    (e) => e.code === "invalid_input");
});

test("a queued Book Builder job keeps its project and its input, and shows neither input nor internals to the page", async () => {
  const tables = { ai_jobs: [] };
  const job = await createBbJob(ctxFor(ME, tables), { route: "positioning", project_id: PROJECT, notes: "keep it short" },
    { service: fakeDb(tables), now: NOW });
  const [row] = tables.ai_jobs;
  assert.equal(row.operation, "bb:positioning");
  assert.equal(row.project_id, PROJECT);
  assert.equal(row.book_id, null);
  assert.deepEqual(row.params, { project_id: PROJECT, notes: "keep it short" }, "the route is not part of the input");
  assert.equal(row.status, "queued");
  assert.equal(job.project_id, PROJECT);
  assert.equal(job.params, undefined);
  assert.equal(job.user_id, undefined);
});

test("clicking twice on the same step returns the job in flight; another chapter is its own job", async () => {
  const tables = { ai_jobs: [] };
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const first = await createBbJob(ctx, { route: "chapter", chapter_id: CH1 }, { service: svc, now: NOW });
  const again = await createBbJob(ctx, { route: "chapter", chapter_id: CH1 }, { service: svc, now: NOW + 1000 });
  assert.equal(again.id, first.id);
  assert.equal(tables.ai_jobs.length, 1, "no second charge-bearing job");
  const other = await createBbJob(ctx, { route: "chapter", chapter_id: CH2 }, { service: svc, now: NOW + 2000 });
  assert.notEqual(other.id, first.id);
  assert.equal(tables.ai_jobs.length, 2);
  // the same chapter, a different step, is a different job too
  const review = await createBbJob(ctx, { route: "review", chapter_id: CH1 }, { service: svc, now: NOW + 3000 });
  assert.notEqual(review.id, first.id);
});

test("a finished job does not block starting the step again", async () => {
  const tables = { ai_jobs: [] };
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const first = await createBbJob(ctx, { route: "architecture", project_id: PROJECT }, { service: svc, now: NOW });
  tables.ai_jobs[0].status = "failed";
  const retry = await createBbJob(ctx, { route: "architecture", project_id: PROJECT }, { service: svc, now: NOW + 5000 });
  assert.notEqual(retry.id, first.id);
});

// ---- runJob ----------------------------------------------------------------

test("a Book Builder job runs the handler with its own input, under the long limit, and keeps the answer", async () => {
  const tables = { ai_jobs: [] };
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const created = await createBbJob(ctx, { route: "positioning", project_id: PROJECT, notes: "n" }, { service: svc, now: NOW });

  let seenInput = null;
  let seenLimit = null;
  const runners = {
    "bb:positioning": async (_ctx, input) => {
      seenInput = input;
      seenLimit = currentAiTimeout();
      return respond({ positioning: { id: "p1", title_ideas: ["A"] }, creditsUsed: 5 });
    },
  };
  const done = await runJob(created.id, ctx, runners, { service: svc, now: () => "2026-11-16T12:01:00Z" });

  assert.deepEqual(seenInput, { project_id: PROJECT, notes: "n" }, "the handler gets what the page sent, not a book_id");
  assert.equal(seenLimit, BACKGROUND_TIMEOUT_MS);
  assert.equal(done.status, "done");
  assert.equal(done.credits_used, 5);
  assert.deepEqual(done.result, { positioning: { id: "p1", title_ideas: ["A"] }, creditsUsed: 5 });
});

test("a Book Builder failure is recorded for the page in plain words and carries no result", async () => {
  const tables = { ai_jobs: [] };
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const created = await createBbJob(ctx, { route: "architecture", project_id: PROJECT }, { service: svc, now: NOW });
  const { Errors } = await import("../netlify/functions/bookpilot-lib/errors.js");
  const done = await runJob(created.id, ctx, { "bb:architecture": async () => { throw Errors.aiUnavailable(); } },
    { service: svc, now: () => "2026-11-16T12:01:00Z" });
  assert.equal(done.status, "failed");
  assert.equal(done.error.code, "ai_unavailable");
  assert.equal(done.result, null);
});

test("AI Strategy jobs are unchanged: they still get a book_id and keep no result", async () => {
  const tables = { ai_jobs: [{
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", user_id: ME.id, operation: "analyze",
    book_id: "33333333-3333-4333-8333-333333333333", params: {}, status: "queued", created_at: new Date(NOW).toISOString(),
  }] };
  const ctx = ctxFor(ME, tables);
  let seen = null;
  const done = await runJob("bbbbbbbb-bbbb-4bbb-8bbb-000000000001", ctx,
    { analyze: async (_c, input) => { seen = input; return respond({ creditsUsed: 15, big: "x" }); } },
    { service: fakeDb(tables), now: () => "2026-11-16T12:01:00Z" });
  assert.deepEqual(seen, { book_id: "33333333-3333-4333-8333-333333333333" });
  assert.equal(done.status, "done");
  assert.equal(done.result, null);
});

test("a job can only be run by the person who created it", async () => {
  const tables = { ai_jobs: [] };
  const created = await createBbJob(ctxFor(ME, tables), { route: "bible", project_id: PROJECT }, { service: fakeDb(tables), now: NOW });
  await assert.rejects(
    runJob(created.id, ctxFor(OTHER, tables), { "bb:bible": async () => respond({}) }, { service: fakeDb(tables) }),
    (e) => e.code === "not_found"
  );
});

// ---- reading it back -------------------------------------------------------

test("the result is readable by its owner and nobody else", async () => {
  const tables = { ai_jobs: [] };
  const svc = fakeDb(tables);
  const created = await createBbJob(ctxFor(ME, tables), { route: "bible", project_id: PROJECT }, { service: svc, now: NOW });
  await runJob(created.id, ctxFor(ME, tables), { "bb:bible": async () => respond({ bible: { id: "b" }, creditsUsed: 10 }) },
    { service: svc, now: () => "2026-11-16T12:01:00Z" });

  const mine = await getJob(ctxFor(ME, tables), created.id, { service: svc, now: NOW + 60_000 });
  assert.deepEqual(mine.result, { bible: { id: "b" }, creditsUsed: 10 });
  await assert.rejects(getJob(ctxFor(OTHER, tables), created.id, { service: svc, now: NOW + 60_000 }), (e) => e.code === "not_found");
});

test("isBbJob tells the two kinds of job apart", () => {
  assert.equal(isBbJob("bb:chapter"), true);
  assert.equal(isBbJob("analyze"), false);
  assert.equal(isBbJob(undefined), false);
  assert.equal(publicJob({ id: "x", operation: "bb:chapter", status: "done", result: { a: 1 } }).result.a, 1);
});

// ---- the wiring ------------------------------------------------------------

test("the background function is named so the platform runs it in the background, and uses the Book Builder runners", () => {
  assert.ok(read("netlify/functions/bookbuilder-ai-background.mjs"));
  const source = read("netlify/functions/bookbuilder-ai-background.mjs");
  assert.match(source, /import \{ JOB_RUNNERS \} from "\.\/bookbuilder-ai\.mjs"/);
  assert.match(source, /runJob\(/);
  assert.match(read("js/core/api.js"), /\/\.netlify\/functions\/bookbuilder-ai-background/);
});

test("the page sends every Book Builder agent through the job runner, and only approving goes direct", () => {
  const source = read("js/core/builder-api.js");
  const direct = [...source.matchAll(/api\.post\("\/api\/bb-ai\/([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(direct, ["approve-positioning"]);
  for (const route of BB_ROUTES) assert.ok(source.includes(`runBuilderJob("${route}"`), `${route} does not go through a job`);
});

test("the demo workspace still answers directly, with nothing to wait for", () => {
  const source = read("js/core/api.js");
  const runner = source.slice(source.indexOf("export async function runBuilderJob"));
  assert.match(runner.slice(0, 400), /if \(demoAdapter\) return api\.post\(`\/api\/bb-ai\/\$\{route\}`, body\)/);
});

test("the migration adds the project and result columns, and is safe to run twice", () => {
  const sql = read("sql/020_bb_ai_jobs.sql");
  assert.match(sql, /add column if not exists project_id uuid references public\.book_projects\(id\) on delete cascade/);
  assert.match(sql, /add column if not exists result jsonb/);
  assert.ok(!/drop /i.test(sql.replace(/--.*$/gm, "")), "it only adds");
  assert.ok(!/grant|policy/i.test(sql.replace(/--.*$/gm, "")), "the table's existing owner-read policy and grants are untouched");
});

// ---- the page's side: runBuilderJob, over a faked network -----------------

const { runBuilderJob, useDemoAdapter, ApiError } = await import("../js/core/api.js");

function fakeNetwork(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method, body });
    const handler = handlers.find((h) => h.method === method && String(url).startsWith(h.url));
    if (!handler) throw new Error(`unexpected ${method} ${url}`);
    const { status = 200, json = {} } = typeof handler.reply === "function" ? handler.reply(calls) : handler.reply;
    return new Response(status === 204 ? null : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("the page starts a job, starts the runner once, and returns the handler's own answer", async () => {
  const answer = { positioning: { id: "p1", title_ideas: ["A", "B"] }, creditsUsed: 5 };
  const net = fakeNetwork([
    { method: "POST", url: "/api/bb-ai/jobs", reply: { status: 201, json: { job: { id: "j1", status: "queued" } } } },
    { method: "POST", url: "/.netlify/functions/bookbuilder-ai-background", reply: { status: 202, json: {} } },
    { method: "GET", url: "/api/bb-ai/jobs/j1", reply: { json: { job: { id: "j1", status: "done", result: answer, credits_used: 5 } } } },
  ]);
  try {
    const out = await runBuilderJob("positioning", { project_id: PROJECT, notes: "n" });
    assert.deepEqual(out, answer, "callers get exactly what the synchronous route used to return");
    assert.deepEqual(net.calls[0].body, { route: "positioning", project_id: PROJECT, notes: "n" });
    assert.deepEqual(net.calls[1].body, { job_id: "j1" });
  } finally { net.restore(); }
});

test("a job already in flight is polled, not started a second time", async () => {
  const net = fakeNetwork([
    { method: "POST", url: "/api/bb-ai/jobs", reply: { status: 201, json: { job: { id: "j2", status: "running" } } } },
    { method: "GET", url: "/api/bb-ai/jobs/j2", reply: { json: { job: { id: "j2", status: "done", result: { ok: 1 }, credits_used: 0 } } } },
  ]);
  try {
    assert.deepEqual(await runBuilderJob("architecture", { project_id: PROJECT }), { ok: 1 });
    assert.ok(!net.calls.some((c) => c.url.includes("background")), "the runner is not started for a running job");
  } finally { net.restore(); }
});

test("a failed job becomes the error the page already knows how to show", async () => {
  const net = fakeNetwork([
    { method: "POST", url: "/api/bb-ai/jobs", reply: { status: 201, json: { job: { id: "j3", status: "queued" } } } },
    { method: "POST", url: "/.netlify/functions/bookbuilder-ai-background", reply: { status: 202, json: {} } },
    { method: "GET", url: "/api/bb-ai/jobs/j3", reply: { json: { job: { id: "j3", status: "failed", error: { code: "ai_unavailable", message: "The AI service isn't reachable right now. Nothing was charged." } } } } },
  ]);
  try {
    await assert.rejects(runBuilderJob("chapter", { chapter_id: CH1 }), (e) =>
      e instanceof ApiError && e.code === "ai_unavailable" && /Nothing was charged/.test(e.message));
  } finally { net.restore(); }
});

test("if the runner cannot be started the page says so and nothing is left spinning", async () => {
  const net = fakeNetwork([
    { method: "POST", url: "/api/bb-ai/jobs", reply: { status: 201, json: { job: { id: "j4", status: "queued" } } } },
    { method: "POST", url: "/.netlify/functions/bookbuilder-ai-background", reply: { status: 404, json: {} } },
  ]);
  try {
    await assert.rejects(runBuilderJob("bible", { project_id: PROJECT }), (e) => e.code === "job_start_failed");
    assert.ok(!net.calls.some((c) => c.method === "GET"), "it never polls a job it could not start");
  } finally { net.restore(); }
});

test("in the demo workspace the same call goes straight to the demo, with no job", async () => {
  const seen = [];
  useDemoAdapter({ request: async (method, path, body) => { seen.push([method, path, body]); return { positioning: { id: "demo" } }; } });
  try {
    const out = await runBuilderJob("positioning", { project_id: PROJECT });
    assert.deepEqual(out, { positioning: { id: "demo" } });
    assert.deepEqual(seen, [["POST", "/api/bb-ai/positioning", { project_id: PROJECT }]]);
  } finally { useDemoAdapter(null); }
});
