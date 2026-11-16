// Book Builder — the background runner.
//
//   POST /.netlify/functions/bookbuilder-ai-background   { "job_id": "<uuid>" }
//
// The same arrangement as bookpilot-ai-background.mjs, for the Book Builder's
// agents. Netlify answers a function whose name ends in "-background" with 202
// at once and lets it run for up to 15 minutes. Positioning, the blueprint, the
// Book Bible and every chapter take longer than the 30 seconds a normal
// function gets, so the page starts a job (POST /api/bb-ai/jobs), calls this
// with its id, and polls GET /api/bb-ai/jobs/:id for the outcome and result.
//
// Failures are recorded on the job row, which is what the page reads.
// See lib/ai-jobs.js and sql/020_bb_ai_jobs.sql.

import { originAllowed, readJson } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import * as v from "./bookpilot-lib/validate.js";
import { runJob } from "./bookpilot-lib/ai-jobs.js";
import { JOB_RUNNERS } from "./bookbuilder-ai.mjs";

export default async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!originAllowed(req)) return new Response("Forbidden", { status: 403 });

    // The person's own token, like every other endpoint. A job can only be run
    // by the person who created it (runJob checks).
    const ctx = await authenticate(req);
    const { job_id } = await readJson(req);
    await runJob(v.uuid(job_id, "Job"), ctx, JOB_RUNNERS);
  } catch (err) {
    console.error("[bookpilot] Book Builder background job did not run:", err?.code || err);
  }
  return new Response("ok");
};
