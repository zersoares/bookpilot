// BookPilot AI — the background runner.
//
//   POST /.netlify/functions/bookpilot-ai-background   { "job_id": "<uuid>" }
//
// Netlify treats a function whose file name ends in "-background" differently:
// it answers the caller with 202 at once and lets the code keep running, for up
// to 15 minutes instead of the 30 seconds a normal function gets. That is the
// whole point of this file. The AI Strategy steps take 30 to 40 seconds or more,
// so they cannot run inside a web request; they run here, and the page polls
// GET /api/bp-ai/jobs/:id (bookpilot-ai.mjs) for the outcome.
//
// The caller has nothing to read from this response, so failures are recorded
// on the job row, which is what the page reads. See lib/ai-jobs.js.

import { originAllowed, readJson } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import * as v from "./bookpilot-lib/validate.js";
import { runJob } from "./bookpilot-lib/ai-jobs.js";
import { JOB_RUNNERS } from "./bookpilot-ai.mjs";

export default async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!originAllowed(req)) return new Response("Forbidden", { status: 403 });

    // The same authentication as every other endpoint: the person's own token.
    // A job can only be run by the person who created it (runJob checks).
    const ctx = await authenticate(req);
    const { job_id } = await readJson(req);
    await runJob(v.uuid(job_id, "Job"), ctx, JOB_RUNNERS);
  } catch (err) {
    // Nothing is listening for this response. If the job exists it has
    // already been marked failed; if it never got that far (a bad token) the
    // page will see it as "didn't start" and say so.
    console.error("[bookpilot] background job did not run:", err?.code || err);
  }
  return new Response("ok");
};
