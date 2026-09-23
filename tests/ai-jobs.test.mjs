// Background AI jobs.
//
// AI Strategy never worked in production: book_analysis on opus-5 at high effort
// takes 29 to 34 seconds, the request limit is 25 and the platform's is 30, so
// every one of the 37 attempts was timed out and refunded. These tests pin the
// fix: the work runs in a background job with its own, longer limit, and the
// job row is the one place the page learns how it went.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

const { createJob, runJob, getJob, publicJob, JOB_ROUTES, QUEUED_STALE_MS, RUNNING_STALE_MS } =
  await import("../netlify/functions/bookpilot-lib/ai-jobs.js");
const { withAiTimeout, currentAiTimeout, generate, BACKGROUND_TIMEOUT_MS } =
  await import("../netlify/functions/bookpilot-lib/ai.js");
const { AppError, Errors } = await import("../netlify/functions/bookpilot-lib/errors.js");
const { pollJob } = await import("../js/core/ai-job.js");

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const ME = { id: "11111111-1111-4111-8111-111111111111" };
const OTHER = { id: "22222222-2222-4222-8222-222222222222" };
const BOOK = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-09-21T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

// ---- a tiny in-memory stand-in for the database client ------------------

function fakeDb(tables, { asUser = null } = {}) {
  const matches = (row, o = {}) => {
    for (const [k, v] of Object.entries(o.eq || {})) if (row[k] !== v) return false;
    for (const [k, vs] of Object.entries(o.in || {})) if (vs?.length && !vs.includes(row[k])) return false;
    for (const [k, cond] of Object.entries(o.filters || {})) {
      const m = /^gte\.(.+)$/.exec(cond);
      if (m && !(String(row[k]) >= m[1])) return false;
    }
    return true;
  };
  // row-level security: a user's client only ever sees that user's rows
  const visible = (table, row) => !asUser || table === "books" || row.user_id === asUser;
  let seq = 0;
  return {
    tables,
    async select(t, o = {}) {
      let rows = (tables[t] || []).filter((r) => visible(t, r) && matches(r, o));
      if (o.order === "created_at.desc") rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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

const ctxFor = (user, tables, credits = 100, role = null) => ({
  user, profile: { ai_credits: credits, role }, db: fakeDb(tables, { asUser: user.id }),
});
const world = () => ({ books: [{ id: BOOK, user_id: ME.id }], ai_jobs: [] });
const respond = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

// ---- createJob ------------------------------------------------------------

test("only the three AI Strategy steps can be run as jobs", () => {
  assert.deepEqual(Object.keys(JOB_ROUTES).sort(), ["analyze", "angles", "personas"]);
  assert.deepEqual(JOB_ROUTES, { analyze: "book_analysis", personas: "reader_personas", angles: "marketing_angles" });
});

test("a bad request fails now, with the same kind of message a normal route gives", async () => {
  const tables = world();
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const create = (body) => createJob(ctx, body, { service: svc, now: NOW });

  await assert.rejects(create({ route: "advisor", book_id: BOOK }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "__proto__", book_id: BOOK }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "analyze" }), (e) => e.code === "invalid_input", "book is required");
  await assert.rejects(create({ route: "analyze", book_id: "not-a-uuid" }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "analyze", book_id: "44444444-4444-4444-8444-444444444444" }), (e) => e.code === "not_found");
  await assert.rejects(create({ route: "personas", book_id: BOOK, count: 9 }), (e) => e.code === "invalid_input");
  await assert.rejects(create({ route: "angles", book_id: BOOK, count: 3 }), (e) => e.code === "invalid_input");
  assert.equal(tables.ai_jobs.length, 0, "none of those left a job behind");
});

test("without enough credits it says so up front, before anything is queued", async () => {
  const tables = world();
  const ctx = ctxFor(ME, tables, 4);
  await assert.rejects(
    createJob(ctx, { route: "analyze", book_id: BOOK }, { service: fakeDb(tables), now: NOW }),
    (e) => e.code === "insufficient_credits" && e.status === 402 && e.detail.needed === 10 && e.detail.available === 4,
  );
  assert.equal(tables.ai_jobs.length, 0);
});

test("an admin's own low balance never blocks starting a job — the account is never actually charged for it", async () => {
  const tables = world();
  const ctx = ctxFor(ME, tables, 0, "admin");
  const job = await createJob(ctx, { route: "analyze", book_id: BOOK }, { service: fakeDb(tables), now: NOW });
  assert.equal(job.status, "queued", "queued exactly as a paying account's job would be");

  // A non-admin with the same zero balance is still refused: this is not
  // a blanket "skip validation" switch, only the credit check.
  const other = ctxFor(OTHER, tables, 0);
  await assert.rejects(
    createJob(other, { route: "analyze", book_id: BOOK }, { service: fakeDb(tables), now: NOW + 1 }),
    (e) => e.code === "insufficient_credits",
  );
});

test("creating a job records it as queued and returns it without its internals", async () => {
  const tables = world();
  const ctx = ctxFor(ME, tables);
  const job = await createJob(ctx, { route: "personas", book_id: BOOK }, { service: fakeDb(tables), now: NOW });

  assert.equal(job.status, "queued");
  assert.equal(job.route, "personas");
  assert.equal(job.book_id, BOOK);
  assert.equal(job.error, null);
  assert.ok(!("params" in job) && !("user_id" in job), "the page is not handed the row's internals");
  assert.deepEqual(tables.ai_jobs[0].params, { count: 4 }, "personas default to four");
  assert.equal(tables.ai_jobs[0].user_id, ME.id);
});

test("clicking twice returns the job already in flight instead of charging twice", async () => {
  const tables = world();
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const first = await createJob(ctx, { route: "analyze", book_id: BOOK }, { service: svc, now: NOW });
  const second = await createJob(ctx, { route: "analyze", book_id: BOOK }, { service: svc, now: NOW + 5000 });
  assert.equal(second.id, first.id);
  assert.equal(tables.ai_jobs.length, 1);

  // a different step for the same book is a different job
  const other = await createJob(ctx, { route: "personas", book_id: BOOK }, { service: svc, now: NOW + 6000 });
  assert.notEqual(other.id, first.id);

  // once it has finished, or is long stale, a new one may start
  tables.ai_jobs[0].status = "done";
  const again = await createJob(ctx, { route: "analyze", book_id: BOOK }, { service: svc, now: NOW + 7000 });
  assert.notEqual(again.id, first.id);
});

// ---- runJob ---------------------------------------------------------------

async function queued(tables, over = {}) {
  return createJob(ctxFor(ME, tables), { route: "analyze", book_id: BOOK, ...over }, { service: fakeDb(tables), now: NOW });
}

test("a successful job runs the handler with the longer limit and records the credits", async () => {
  const tables = world();
  const job = await queued(tables);
  let seen = null;
  const runners = {
    analyze: async (ctx, body) => { seen = { limit: currentAiTimeout(), body }; return respond({ creditsUsed: 10, analysis: {} }); },
  };
  const out = await runJob(job.id, ctxFor(ME, tables), runners, { service: fakeDb(tables), now: () => "2026-09-21T12:00:40Z" });

  assert.equal(seen.limit, BACKGROUND_TIMEOUT_MS, "the handler ran with the background limit, not 25 seconds");
  assert.ok(BACKGROUND_TIMEOUT_MS > 60_000, "and that limit is well beyond the 34 seconds measured");
  assert.deepEqual(seen.body, { book_id: BOOK }, "with the book, exactly as the normal route gets it");
  assert.equal(out.status, "done");
  assert.equal(out.credits_used, 10);
  assert.equal(tables.ai_jobs[0].status, "done");
  assert.ok(tables.ai_jobs[0].started_at && tables.ai_jobs[0].finished_at);
  assert.equal(currentAiTimeout(), 25_000, "and the longer limit did not leak out of the job");
});

test("a failure is recorded in words a person can read, and the handler's refund path is untouched", async () => {
  const tables = world();
  const job = await queued(tables);
  const runners = { analyze: async () => { throw Errors.aiUnavailable(); } };
  const out = await runJob(job.id, ctxFor(ME, tables), runners, { service: fakeDb(tables) });

  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "ai_unavailable");
  assert.match(out.error.message, /isn't reachable/);
  assert.equal(tables.ai_jobs[0].status, "failed");
  assert.ok(tables.ai_jobs[0].finished_at);
});

test("an unexpected error never leaks its text to the page", async () => {
  const tables = world();
  const job = await queued(tables);
  const runners = { analyze: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"); } };
  const out = await runJob(job.id, ctxFor(ME, tables), runners, { service: fakeDb(tables) });

  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "internal_error");
  assert.doesNotMatch(JSON.stringify(out), /ECONNREFUSED|hunter2|10\.0\.0\.5/);
  assert.doesNotMatch(JSON.stringify(tables.ai_jobs), /hunter2/, "nor is it stored");
});

test("a job can only be run by the person who created it, and only once", async () => {
  const tables = world();
  const job = await queued(tables);
  let calls = 0;
  const runners = { analyze: async () => { calls += 1; return respond({ creditsUsed: 10 }); } };

  await assert.rejects(runJob(job.id, ctxFor(OTHER, tables), runners, { service: fakeDb(tables) }), (e) => e.code === "not_found");
  await assert.rejects(runJob("55555555-5555-4555-8555-555555555555", ctxFor(ME, tables), runners, { service: fakeDb(tables) }), (e) => e.code === "not_found");
  assert.equal(calls, 0, "nothing ran for the wrong person");

  await runJob(job.id, ctxFor(ME, tables), runners, { service: fakeDb(tables) });
  await runJob(job.id, ctxFor(ME, tables), runners, { service: fakeDb(tables) }); // a retried trigger
  assert.equal(calls, 1, "a repeated start is a no-op: the model is called (and charged) once");
});

test("if two starts race, only the one that claims the job runs it", async () => {
  const tables = world();
  const job = await queued(tables);
  const svc = fakeDb(tables);
  // both saw it queued; the other one already claimed it
  const realUpdate = svc.update.bind(svc);
  svc.update = async (t, patch, o) => (patch.status === "running" ? null : realUpdate(t, patch, o));
  let calls = 0;
  await runJob(job.id, ctxFor(ME, tables), { analyze: async () => { calls += 1; return respond({}); } }, { service: svc });
  assert.equal(calls, 0);
});

// ---- getJob ---------------------------------------------------------------

test("the page sees its own job, and nobody else's", async () => {
  const tables = world();
  const job = await queued(tables);
  const own = await getJob(ctxFor(ME, tables), job.id, { service: fakeDb(tables), now: NOW });
  assert.equal(own.status, "queued");
  await assert.rejects(getJob(ctxFor(OTHER, tables), job.id, { service: fakeDb(tables), now: NOW }), (e) => e.code === "not_found");
  await assert.rejects(getJob(ctxFor(ME, tables), "nope", { service: fakeDb(tables), now: NOW }), (e) => e.code === "invalid_input");
});

test("a job that was never started, or has been running impossibly long, is closed instead of spinning forever", async () => {
  const tables = world();
  tables.ai_jobs.push(
    { id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: ME.id, operation: "analyze", book_id: BOOK, status: "queued", created_at: ago(QUEUED_STALE_MS + 1000) },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", user_id: ME.id, operation: "angles", book_id: BOOK, status: "running", created_at: ago(RUNNING_STALE_MS + 60_000), started_at: ago(RUNNING_STALE_MS + 30_000) },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", user_id: ME.id, operation: "personas", book_id: BOOK, status: "queued", created_at: ago(5000) },
    { id: "aaaaaaaa-0000-4000-8000-000000000004", user_id: ME.id, operation: "personas", book_id: BOOK, status: "running", created_at: ago(120_000), started_at: ago(100_000) },
    { id: "aaaaaaaa-0000-4000-8000-000000000005", user_id: ME.id, operation: "analyze", book_id: BOOK, status: "done", created_at: ago(9e7), finished_at: ago(9e7) },
  );
  const ctx = ctxFor(ME, tables);
  const svc = fakeDb(tables);
  const get = (n) => getJob(ctx, `aaaaaaaa-0000-4000-8000-00000000000${n}`, { service: svc, now: NOW });

  const notStarted = await get(1);
  assert.equal(notStarted.status, "failed");
  assert.equal(notStarted.error.code, "job_not_started");
  assert.match(notStarted.error.message, /Nothing was charged/);

  const lost = await get(2);
  assert.equal(lost.status, "failed");
  assert.equal(lost.error.code, "job_lost");

  assert.equal((await get(3)).status, "queued", "a job queued moments ago is left alone");
  assert.equal((await get(4)).status, "running", "and so is one that is genuinely running");
  assert.equal((await get(5)).status, "done", "and a finished one is never touched");
});

// ---- the request limit itself --------------------------------------------

test("the time limit is carried per call and never bleeds between concurrent jobs", async () => {
  assert.equal(currentAiTimeout(), 25_000, "outside a job, the normal request limit");
  const seen = await Promise.all([
    withAiTimeout(111_000, async () => { await new Promise((r) => setTimeout(r, 5)); return currentAiTimeout(); }),
    withAiTimeout(222_000, async () => currentAiTimeout()),
    (async () => currentAiTimeout())(),
  ]);
  assert.deepEqual(seen, [111_000, 222_000, 25_000]);
});

test("generate() gives up at the limit it was handed, and says why", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, { signal } = {}) => new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const realLog = console.error;
  console.error = () => {};
  try {
    const started = Date.now();
    await assert.rejects(
      withAiTimeout(60, () => generate("book_analysis", { title: "T" })),
      (e) => e.code === "ai_unavailable" && e.diagnostic === "timeout",
    );
    assert.ok(Date.now() - started < 3000, "it honoured the short limit rather than the default 25s");
  } finally {
    globalThis.fetch = realFetch;
    console.error = realLog;
  }
});

// ---- the page's side --------------------------------------------------------

test("polling waits, eases off, and stops when the job finishes", async () => {
  const states = ["queued", "running", "running", "running", "done"];
  let i = 0, clock = 0;
  const waits = [];
  const out = await pollJob(async () => ({ status: states[Math.min(i++, states.length - 1)], credits_used: 10 }), {
    sleep: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock, maxWaitMs: 300_000,
  });
  assert.equal(out.timedOut, false);
  assert.equal(out.job.status, "done");
  assert.deepEqual(waits, [2000, 2500, 3125, 3906], "starts quick, then gently backs off");
  assert.ok(Math.max(...waits) <= 5000);
});

test("polling reports a failure as an outcome, and gives up on a job that never ends", async () => {
  const failed = await pollJob(async () => ({ status: "failed", error: { code: "x", message: "m" } }), { sleep: async () => {} });
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.timedOut, false);

  let clock = 0;
  const stuck = await pollJob(async () => ({ status: "running" }), {
    sleep: async (ms) => { clock += ms; }, now: () => clock, maxWaitMs: 20_000,
  });
  assert.equal(stuck.timedOut, true);
  assert.equal(stuck.job.status, "running", "still running: the page says so rather than claiming failure");
  assert.ok(clock >= 20_000 && clock < 30_000, "and it stopped around the limit, not much later");
});

test("a job that is already finished the first time it is read needs no waiting", async () => {
  let slept = false;
  const out = await pollJob(async () => ({ status: "done" }), { sleep: async () => { slept = true; } });
  assert.equal(out.job.status, "done");
  assert.equal(slept, false);
});

// ---- how it is wired -----------------------------------------------------------

test("the background function is named so the platform runs it in the background", () => {
  const name = "netlify/functions/bookpilot-ai-background.mjs";
  assert.match(name, /-background\.mjs$/, "Netlify keys off this suffix: without it, the 30-second limit returns");
  const src = read(name);
  assert.match(src, /authenticate\(req\)/, "it authenticates the caller like every other endpoint");
  assert.match(src, /runJob\(/);
  assert.match(src, /catch \(err\)/, "and cannot throw out of the handler");
});

test("the AI function and the background function agree on what may run", async () => {
  const src = read("netlify/functions/bookpilot-ai.mjs");
  const runners = src.match(/export const JOB_RUNNERS = \{([\s\S]*?)\};/)?.[1] || "";
  const keys = [...runners.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, Object.keys(JOB_ROUTES).sort(), "every job route has a runner, and no runner lacks a route");
  assert.match(src, /operation === "jobs"/);
  assert.match(src, /GET" && jobId/, "polling is a GET");
  assert.match(src, /json\(\{ job: await createJob/);
});

test("the page uses jobs for the three steps, and only when it is not the demo", () => {
  const src = read("js/core/api.js");
  for (const route of ["analyze", "personas", "angles"]) {
    assert.match(src, new RegExp(`runAiJob\\("${route}"`), `${route} runs as a job`);
  }
  assert.match(src, /if \(demoAdapter\) return api\.post\(`\/api\/bp-ai\/\$\{route\}`/, "the demo keeps its instant path");
  assert.match(src, /\/\.netlify\/functions\/bookpilot-ai-background/);
});

test("the jobs table is server-written, owner-readable, and locked down by default", () => {
  const sql = read("sql/019_ai_jobs.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /revoke all on public\.ai_jobs from anon, authenticated;/);
  assert.match(sql, /grant select on public\.ai_jobs to authenticated;/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i, "no policy lets a browser write a job");
  assert.match(sql, /check \(status in \('queued', 'running', 'done', 'failed'\)\)/);
});

test("publicJob never exposes the row's internals", () => {
  const out = publicJob({ id: "j", operation: "analyze", book_id: "b", status: "failed", error_code: "c", error_message: "m", params: { secret: 1 }, user_id: "u" });
  assert.deepEqual(Object.keys(out).sort(), ["book_id", "created_at", "credits_used", "error", "finished_at", "id", "route", "status"]);
});
