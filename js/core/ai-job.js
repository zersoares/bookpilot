// Waiting for a background AI job.
//
// The AI Strategy steps run server-side in the background (see
// netlify/functions/bookpilot-ai-background.mjs); the page starts one and then
// asks how it is going. This is the asking, kept free of network and timer
// details so it can be tested: the caller passes in how to fetch a job and how
// to wait.

/**
 * Poll until the job is `done` or `failed`, or the wait runs out.
 *
 * Starts quickly (most jobs finish in under a minute) and eases off, so a long
 * job does not become a request every second.
 *
 * @param {() => Promise<{status: string}>} fetchJob
 * @returns {Promise<{job: object, timedOut: boolean}>}
 */
export async function pollJob(fetchJob, {
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  maxWaitMs = 5 * 60_000,
  firstDelayMs = 2000,
  maxDelayMs = 5000,
} = {}) {
  const deadline = now() + maxWaitMs;
  let delay = firstDelayMs;
  let job = await fetchJob();
  while (job.status === "queued" || job.status === "running") {
    if (now() >= deadline) return { job, timedOut: true };
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), maxDelayMs);
    job = await fetchJob();
  }
  return { job, timedOut: false };
}
