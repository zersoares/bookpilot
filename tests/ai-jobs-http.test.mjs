// The whole AI Strategy chain, end to end, through the real handlers.
//
// The real functions run unchanged, with only the network replaced: a small fake
// of Supabase (auth, PostgREST, the credit RPCs) and a fake of Anthropic's API.
// What this proves that the unit tests cannot: the routes are wired, a job goes
// queued -> running -> done through the actual background function, the analysis
// is saved where the page reads it, the credits are charged once, and a model
// failure ends as a failed job with the credits refunded and the reason recorded.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
process.env.URL = "http://localhost:8888";

const ai = (await import("../netlify/functions/bookpilot-ai.mjs")).default;
const background = (await import("../netlify/functions/bookpilot-ai-background.mjs")).default;

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" };
const BOOK = "33333333-3333-4333-8333-333333333333";
const TOKEN = "user-jwt";

// ---- fake Supabase + fake Anthropic --------------------------------------

function world({ credits = 100, anthropic = "ok" } = {}) {
  const w = {
    credits,
    anthropic,
    tables: {
      profiles: [{ id: USER.id, ai_credits: credits, plan_id: "author" }],
      books: [{ id: BOOK, user_id: USER.id, title: "The Modern Woman's Guide", genre: "Self-Help", status: "draft",
        description: "A guide for women starting over." }],
      credit_costs: [
        { operation: "book_analysis", credits: 10, is_active: true },
        { operation: "reader_personas", credits: 10, is_active: true },
        { operation: "marketing_angles", credits: 5, is_active: true },
      ],
      ai_usage: [], ai_jobs: [], book_analysis: [], app_settings: [], ai_prompts: [], audit_log: [],
    },
    rpcs: [],
    anthropicCalls: [],
  };
  return w;
}

const ANALYSIS = {
  positioning: "A practical companion.", core_promise: "Know what to do this week.",
  reader_problem: "Everything arrives at once.", transformation: "From reacting to sequencing.",
  themes: ["Rebuilding"], purchase_motivations: ["Wants a plan"], objections: ["Expects fluff"],
  opportunities: ["Lead with practical"], reasoning: "Specific descriptions sell.",
};

function installFetch(w) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const reply = (data, status = 200) => new Response(data === undefined ? "" : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (url.host === "api.anthropic.com") {
      w.anthropicCalls.push({ model: body.model, effort: body.output_config?.effort });
      if (w.anthropic === "unauthorized") {
        return reply({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
      }
      return reply({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(ANALYSIS) }], usage: { input_tokens: 500, output_tokens: 300 } });
    }

    if (url.pathname === "/auth/v1/user") return reply({ id: USER.id, email: USER.email });

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      w.rpcs.push({ fn: rpc[1], args: body });
      if (rpc[1] === "bp_consume_credits") { w.credits -= body.p_credits; return reply(w.credits); }
      if (rpc[1] === "bp_refund_credits") { w.credits += body.p_credits; return reply(w.credits); }
      return reply(null);
    }

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table) return reply({ message: "not found" }, 404);
    const rows = (w.tables[table] ||= []);
    const matches = (row) => {
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (value.startsWith("eq.")) { if (String(row[key]) !== value.slice(3)) return false; }
        else if (value.startsWith("gte.")) { if (!(String(row[key]) >= value.slice(4))) return false; }
        else if (value.startsWith("in.(")) {
          const list = value.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));
          if (!list.includes(String(row[key]))) return false;
        }
      }
      return true;
    };

    if (method === "GET") {
      let out = rows.filter(matches);
      if (url.searchParams.get("order") === "created_at.desc") out = [...out].reverse();
      const limit = Number(url.searchParams.get("limit"));
      return reply(limit ? out.slice(0, limit) : out);
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const saved = list.map((r, i) => ({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(rows.length + i + 1).padStart(12, "0")}`, created_at: new Date().toISOString(), ...r }));
      rows.push(...saved);
      return reply(saved, 201);
    }
    if (method === "PATCH") {
      const hit = rows.filter(matches);
      hit.forEach((r) => Object.assign(r, body));
      return reply(hit);
    }
    if (method === "DELETE") { w.tables[table] = rows.filter((r) => !matches(r)); return reply(undefined, 204); }
    return reply({}, 405);
  };
  return () => { globalThis.fetch = real; };
}

const call = (handler, method, path, body) =>
  handler(new Request(`http://localhost:8888${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

const quiet = () => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; return () => { console.error = e; console.log = l; }; };

// ---- tests -----------------------------------------------------------------

test("analysis end to end: create a job, run it in the background, read the result", async () => {
  const w = world();
  const restoreFetch = installFetch(w), restoreLog = quiet();
  try {
    // 1. the page creates a job and gets an answer at once
    const created = await call(ai, "POST", "/api/bp-ai/jobs", { route: "analyze", book_id: BOOK });
    assert.equal(created.status, 201);
    const { job } = await created.json();
    assert.equal(job.status, "queued");
    assert.equal(job.route, "analyze");
    assert.equal(w.credits, 100, "creating the job charges nothing");
    assert.equal(w.anthropicCalls.length, 0, "and calls no model");

    // 2. polling before it starts sees it queued
    const pending = await (await call(ai, "GET", `/api/bp-ai/jobs/${job.id}`)).json();
    assert.equal(pending.job.status, "queued");

    // 3. the background function runs it
    const ran = await call(background, "POST", "/.netlify/functions/bookpilot-ai-background", { job_id: job.id });
    assert.equal(ran.status, 200);

    // 4. the page reads the outcome
    const done = (await (await call(ai, "GET", `/api/bp-ai/jobs/${job.id}`)).json()).job;
    assert.equal(done.status, "done");
    assert.equal(done.credits_used, 10);
    assert.equal(done.error, null);

    // the analysis is saved where the Strategy page reads it, the book advanced, credits charged once
    assert.equal(w.tables.book_analysis.length, 1);
    assert.equal(w.tables.book_analysis[0].positioning, ANALYSIS.positioning);
    assert.equal(w.tables.books[0].status, "analyzed");
    assert.equal(w.credits, 90, "10 credits, once");
    assert.equal(w.rpcs.filter((r) => r.fn === "bp_refund_credits").length, 0);
    assert.equal(w.anthropicCalls.length, 1);
    assert.equal(w.anthropicCalls[0].model, "claude-opus-5", "the model and effort the analysis has always been meant to use");
    assert.equal(w.anthropicCalls[0].effort, "high");
  } finally { restoreLog(); restoreFetch(); }
});

test("a model failure ends as a failed job: refunded, and the reason recorded for the database", async () => {
  const w = world({ anthropic: "unauthorized" });
  const restoreFetch = installFetch(w), restoreLog = quiet();
  try {
    const { job } = await (await call(ai, "POST", "/api/bp-ai/jobs", { route: "analyze", book_id: BOOK })).json();
    await call(background, "POST", "/.netlify/functions/bookpilot-ai-background", { job_id: job.id });

    const out = (await (await call(ai, "GET", `/api/bp-ai/jobs/${job.id}`)).json()).job;
    assert.equal(out.status, "failed");
    assert.equal(out.error.code, "ai_unavailable");
    assert.match(out.error.message, /Nothing was charged/);
    assert.equal(w.tables.book_analysis.length, 0, "no half-saved analysis");
    assert.equal(w.credits, 100, "charged, then refunded in full");

    const refund = w.rpcs.find((r) => r.fn === "bp_refund_credits");
    assert.ok(refund, "the refund ran");
    assert.match(refund.args.p_reason, /^book_analysis\|http_401:authentication_error/, "with the diagnostic that made this findable");
  } finally { restoreLog(); restoreFetch(); }
});

test("clicking twice runs the model once and charges once", async () => {
  const w = world();
  const restoreFetch = installFetch(w), restoreLog = quiet();
  try {
    const a = (await (await call(ai, "POST", "/api/bp-ai/jobs", { route: "analyze", book_id: BOOK })).json()).job;
    const b = (await (await call(ai, "POST", "/api/bp-ai/jobs", { route: "analyze", book_id: BOOK })).json()).job;
    assert.equal(b.id, a.id, "the second click gets the same job");

    // and the runner being triggered twice still runs it once
    await Promise.all([
      call(background, "POST", "/x", { job_id: a.id }),
      call(background, "POST", "/x", { job_id: a.id }),
    ]);
    assert.equal(w.anthropicCalls.length, 1);
    assert.equal(w.credits, 90);
    assert.equal(w.tables.ai_jobs.length, 1);
  } finally { restoreLog(); restoreFetch(); }
});

test("the routes refuse what they should", async () => {
  const w = world({ credits: 3 });
  const restoreFetch = installFetch(w), restoreLog = quiet();
  try {
    // not enough credits: refused up front with the shortfall, nothing queued
    const poor = await call(ai, "POST", "/api/bp-ai/jobs", { route: "analyze", book_id: BOOK });
    assert.equal(poor.status, 402);
    assert.equal((await poor.json()).error.code, "insufficient_credits");
    assert.equal(w.tables.ai_jobs.length, 0);

    // a route that is not a strategy step cannot be run as a job
    w.tables.profiles[0].ai_credits = 100;
    const bad = await call(ai, "POST", "/api/bp-ai/jobs", { route: "advisor", book_id: BOOK });
    assert.equal(bad.status, 400);

    // no such job, and the wrong verbs
    assert.equal((await call(ai, "GET", "/api/bp-ai/jobs/99999999-9999-4999-8999-999999999999")).status, 404);
    assert.equal((await call(ai, "GET", "/api/bp-ai/jobs")).status, 404);
    assert.equal((await call(ai, "POST", "/api/bp-ai/jobs/99999999-9999-4999-8999-999999999999", {})).status, 404);

    // the old synchronous routes still exist for everything that is not a strategy step
    assert.notEqual((await call(ai, "POST", "/api/bp-ai/analyze", { book_id: "not-a-uuid" })).status, 404);
    assert.equal((await call(ai, "GET", "/api/bp-ai/analyze")).status, 404);
  } finally { restoreLog(); restoreFetch(); }
});

test("the background function cannot be used to run someone else's job, or without a token", async () => {
  const w = world();
  const restoreFetch = installFetch(w), restoreLog = quiet();
  try {
    w.tables.ai_jobs.push({ id: "cccccccc-cccc-4ccc-8ccc-000000000001", user_id: "99999999-9999-4999-8999-999999999999",
      operation: "analyze", book_id: BOOK, status: "queued", params: {}, created_at: new Date().toISOString() });

    await call(background, "POST", "/x", { job_id: "cccccccc-cccc-4ccc-8ccc-000000000001" });
    assert.equal(w.tables.ai_jobs[0].status, "queued", "another person's job is untouched");
    assert.equal(w.anthropicCalls.length, 0);

    const noToken = await background(new Request("http://localhost:8888/x", { method: "POST", body: JSON.stringify({ job_id: "cccccccc-cccc-4ccc-8ccc-000000000001" }) }));
    assert.equal(noToken.status, 200, "answers plainly; nothing is listening to a background response");
    assert.equal(w.anthropicCalls.length, 0, "but it ran nothing");

    assert.equal((await background(new Request("http://localhost:8888/x", { method: "GET" }))).status, 405);
  } finally { restoreLog(); restoreFetch(); }
});
