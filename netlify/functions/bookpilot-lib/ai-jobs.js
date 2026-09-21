// Background AI jobs.
//
// The AI Strategy steps take longer than a web request may (see
// sql/019_ai_jobs.sql for the measurements), so they run like this instead:
//
//   1. createJob    a normal request: checks the person, the book and their
//                   credits, records a `queued` row, answers at once.
//   2. runJob       a Netlify background function, started by the page with
//                   that job's id. It may run for minutes. It runs the very same
//                   handler the synchronous route used, so charging, the model
//                   call, saving the result and refunding on failure are all
//                   unchanged: only the wall-clock limit is different.
//   3. getJob       what the page polls until the row is `done` or `failed`.
//
// The generated rows (analysis, personas, angles) land in their usual tables.
// The job row only records how the attempt went.
//
// Everything here takes its database and handlers as arguments so it can be
// tested without a network.

import { AppError, Errors } from "./errors.js";
import { dbAsService } from "./db.js";
import { costOf } from "./credits.js";
import { withAiTimeout, BACKGROUND_TIMEOUT_MS } from "./ai.js";
import * as v from "./validate.js";

/** Route name (as the page knows it) -> the credit operation it bills as. */
export const JOB_ROUTES = {
  analyze: "book_analysis",
  personas: "reader_personas",
  angles: "marketing_angles",
};

// A job nobody picked up (the page failed to start it) is not left spinning.
export const QUEUED_STALE_MS = 60_000;
// The platform stops a background function at 15 minutes; well before that, a
// job that is still "running" has been lost.
export const RUNNING_STALE_MS = 10 * 60_000;
// Starting the same job again while one is genuinely in flight returns that one.
const IN_FLIGHT_WINDOW_MS = RUNNING_STALE_MS;

/** The shape the page sees. Never the params, never a raw error. */
export function publicJob(row) {
  return {
    id: row.id,
    route: row.operation,
    book_id: row.book_id,
    status: row.status,
    credits_used: row.credits_used ?? null,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    created_at: row.created_at,
    finished_at: row.finished_at ?? null,
  };
}

function paramsFor(route, body) {
  if (route === "personas") return { count: v.int(body.count ?? 4, "Count", { min: 3, max: 5 }) };
  if (route === "angles") return { count: v.int(body.count ?? 10, "Count", { min: 10, max: 14 }) };
  return {};
}

/**
 * Record a job. Validates everything a synchronous route would, so a bad
 * request fails now with the same message rather than minutes later.
 */
export async function createJob(ctx, body, { service = dbAsService(), now = Date.now() } = {}) {
  const route = String(body.route || "");
  if (!Object.hasOwn(JOB_ROUTES, route)) throw Errors.invalid("That can't be run in the background.");
  const operation = JOB_ROUTES[route];

  const bookId = v.uuid(body.book_id, "Book");
  const book = await ctx.db.selectOne("books", { eq: { id: bookId } });
  if (!book) throw Errors.notFound("book");
  const params = paramsFor(route, body);

  // Someone who clicks twice, or reloads mid-way, must not be charged twice.
  const since = new Date(now - IN_FLIGHT_WINDOW_MS).toISOString();
  const running = await ctx.db.select("ai_jobs", {
    eq: { book_id: bookId, operation: route },
    in: { status: ["queued", "running"] },
    filters: { created_at: `gte.${since}` },
    order: "created_at.desc",
    limit: 1,
  });
  if (running.length) return publicJob(running[0]);

  const cost = await costOf(operation);
  const available = ctx.profile.ai_credits ?? 0;
  if (cost > 0 && available < cost) throw Errors.noCredits(cost, available);

  const row = await service.insert("ai_jobs", {
    user_id: ctx.user.id,
    operation: route,
    book_id: bookId,
    params,
    status: "queued",
  });
  return publicJob(row);
}

/**
 * Run one queued job to completion. Called from the background function; the
 * caller has already authenticated `ctx` from the request's own token.
 *
 * Never throws for a failed generation: that is recorded on the job, which is
 * what the page reads. It throws only when the job cannot be found for this
 * person.
 */
export async function runJob(jobId, ctx, runners, {
  service = dbAsService(),
  timeoutMs = BACKGROUND_TIMEOUT_MS,
  now = () => new Date().toISOString(),
} = {}) {
  const job = await service.selectOne("ai_jobs", { eq: { id: jobId } });
  if (!job || job.user_id !== ctx.user.id) throw Errors.notFound("job");
  if (job.status !== "queued") return publicJob(job); // already started or finished

  // Claim it. If two invocations race (a retried trigger), only one wins.
  const claimed = await service.update("ai_jobs", { status: "running", started_at: now() },
    { eq: { id: job.id, status: "queued" } });
  if (!claimed) return publicJob(job);

  const runner = runners[job.operation];
  try {
    if (!runner) throw Errors.invalid("That can't be run in the background.");
    const response = await withAiTimeout(timeoutMs, () =>
      runner(ctx, { book_id: job.book_id, ...job.params }));
    const result = await response.json().catch(() => null);
    const done = await service.update("ai_jobs",
      { status: "done", credits_used: result?.creditsUsed ?? null, finished_at: now() },
      { eq: { id: job.id } });
    return publicJob(done || { ...claimed, status: "done" });
  } catch (err) {
    // An AppError's message is written for people; anything else is not.
    const known = err instanceof AppError;
    console.error(`[bookpilot] AI job ${job.operation} ${job.id} failed:`, known ? `${err.code}: ${err.message}` : err);
    const failure = {
      status: "failed",
      error_code: known ? err.code : "internal_error",
      error_message: known ? err.message : "Something went wrong on our side. Please try again in a minute.",
      finished_at: now(),
    };
    const failed = await service.update("ai_jobs", failure, { eq: { id: job.id } }).catch(() => null);
    return publicJob(failed || { ...claimed, ...failure });
  }
}

/**
 * The job as the page should see it now. A job that has clearly been lost
 * (never picked up, or "running" far too long) is closed here, so the page
 * gets an answer instead of polling forever.
 */
export async function getJob(ctx, jobId, { service = dbAsService(), now = Date.now() } = {}) {
  const id = v.uuid(jobId, "Job");
  const job = await ctx.db.selectOne("ai_jobs", { eq: { id } }); // row-level security: own jobs only
  if (!job) throw Errors.notFound("job");

  const age = (iso) => now - Date.parse(iso);
  let failure = null;
  if (job.status === "queued" && age(job.created_at) > QUEUED_STALE_MS) {
    failure = {
      error_code: "job_not_started",
      error_message: "That didn't start. Nothing was charged. Please try again.",
    };
  } else if (job.status === "running" && age(job.started_at || job.created_at) > RUNNING_STALE_MS) {
    failure = {
      error_code: "job_lost",
      error_message: "That took much longer than expected and was stopped. Please try again.",
    };
  }
  if (!failure) return publicJob(job);

  const closed = await service.update("ai_jobs",
    { status: "failed", ...failure, finished_at: new Date(now).toISOString() },
    { eq: { id: job.id, status: job.status } }).catch(() => null);
  return publicJob(closed || { ...job, status: "failed", ...failure });
}
