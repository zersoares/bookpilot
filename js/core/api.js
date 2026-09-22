// The API client.
//
// One place that knows how to attach the bearer token, how to turn a
// non-2xx response into a readable message, and how to route a call to
// the demo workspace instead of the network when demo mode is on.

import { accessToken, signOut } from "./auth.js";
import { pollJob } from "./ai-job.js";

export class ApiError extends Error {
  constructor(code, message, status, detail) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

let demoAdapter = null;

/** Demo mode swaps the whole client for an in-memory implementation. */
export function useDemoAdapter(adapter) {
  demoAdapter = adapter;
}

export function isDemo() {
  return Boolean(demoAdapter);
}

/**
 * The adapter itself, for the few calls that are not JSON over `request`.
 *
 * Exporting a book returns a file, so the download path in
 * core/builder-api.js cannot go through `request` — it needs to ask the
 * adapter directly when the demo workspace is on.
 */
export function currentAdapter() {
  return demoAdapter;
}

async function request(method, path, body) {
  if (demoAdapter) return demoAdapter.request(method, path, body);

  const token = await accessToken();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "offline",
      "We couldn't reach BookPilot. Check your connection and try again.",
      0
    );
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error || {};
    if (res.status === 401) {
      // The session is gone or invalid; drop it so the app returns to
      // the sign-in screen rather than looping on failed calls.
      await signOut();
    }
    throw new ApiError(
      error.code || "error",
      error.message || "Something went wrong. Please try again.",
      res.status,
      error.detail
    );
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body || {}),
  patch: (path, body) => request("PATCH", path, body || {}),
  delete: (path) => request("DELETE", path),
};

// --- Background AI jobs ------------------------------------------------
//
// The AI Strategy steps take 30 to 40 seconds or more, longer than the
// platform lets a web request run, so they used to time out every time. They
// run in a background function instead: create a job, start the runner, poll.
// The result lands in the same tables it always did; callers re-read it.

const BACKGROUND_RUNNER = "/.netlify/functions/bookpilot-ai-background";

async function startBackgroundRunner(jobId) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(BACKGROUND_RUNNER, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ job_id: jobId }),
    });
  } catch {
    throw new ApiError("offline", "We couldn't reach BookPilot. Check your connection and try again.", 0);
  }
  // A background function answers 202 straight away; anything else means it did not start.
  if (!res.ok) {
    throw new ApiError("job_start_failed", "We couldn't start that. Nothing was charged. Please try again.", res.status);
  }
}

async function runAiJob(route, body) {
  // The demo answers instantly from memory; there is nothing to wait for.
  if (demoAdapter) return api.post(`/api/bp-ai/${route}`, body);

  const { job } = await api.post("/api/bp-ai/jobs", { route, ...body });
  // A second click while one is already running comes back with that one:
  // start the runner only for a job that has not started (starting twice is
  // harmless, the server lets exactly one run).
  if (job.status === "queued") await startBackgroundRunner(job.id);

  const { job: finished, timedOut } = await pollJob(() => api.get(`/api/bp-ai/jobs/${job.id}`).then((r) => r.job));
  if (timedOut) {
    throw new ApiError(
      "job_pending",
      "This is taking longer than usual, but it's still running. Check back in a minute; the result will be here when it's done, and you're not charged if it fails.",
      202,
    );
  }
  if (finished.status === "failed") {
    throw new ApiError(finished.error?.code || "error", finished.error?.message || "Something went wrong. Please try again.", 503);
  }
  return { creditsUsed: finished.credits_used };
}

// --- Endpoints --------------------------------------------------------
// Named wrappers so a route change touches one line, and so the demo
// adapter has a single vocabulary to implement.

export const API = {
  config: () => api.get("/api/bp/config"),

  me: () => api.get("/api/bp/me"),
  updateMe: (patch) => api.patch("/api/bp/me", patch),
  exportData: () => api.get("/api/bp/me/export"),
  deleteAccount: (confirm) => api.post("/api/bp/me/delete", { confirm }),

  books: () => api.get("/api/bp/books"),
  book: (id) => api.get(`/api/bp/books/${id}`),
  createBook: (book) => api.post("/api/bp/books", book),
  updateBook: (id, patch) => api.patch(`/api/bp/books/${id}`, patch),
  deleteBook: (id) => api.delete(`/api/bp/books/${id}`),
  strategy: (id) => api.get(`/api/bp/books/${id}/strategy`),

  creatives: (query = "") => api.get(`/api/bp/creatives${query}`),
  creative: (id) => api.get(`/api/bp/creatives/${id}`),
  createCreative: (creative) => api.post("/api/bp/creatives", creative),
  updateCreative: (id, patch) => api.patch(`/api/bp/creatives/${id}`, patch),
  deleteCreative: (id) => api.delete(`/api/bp/creatives/${id}`),

  campaigns: () => api.get("/api/bp/campaigns"),
  campaign: (id) => api.get(`/api/bp/campaigns/${id}`),
  createCampaign: (campaign) => api.post("/api/bp/campaigns", campaign),
  updateCampaign: (id, patch) => api.patch(`/api/bp/campaigns/${id}`, patch),
  deleteCampaign: (id) => api.delete(`/api/bp/campaigns/${id}`),
  campaignPerformance: (id) => api.get(`/api/bp/campaigns/${id}/performance`),

  analytics: (days = 30) => api.get(`/api/bp/analytics?days=${days}`),

  notifications: () => api.get("/api/bp/notifications"),
  markAllRead: () => api.post("/api/bp/notifications/read-all"),
  markRead: (id) => api.patch(`/api/bp/notifications/${id}`, {}),

  recommendations: () => api.get("/api/bp/recommendations"),
  resolveRecommendation: (id, status) => api.patch(`/api/bp/recommendations/${id}`, { status }),

  integrations: () => api.get("/api/bp/integrations"),
  disconnect: (provider) => api.delete(`/api/bp/integrations/${provider}`),

  trackingSites: () => api.get("/api/bp/tracking-sites"),
  createTrackingSite: (site) => api.post("/api/bp/tracking-sites", site),
  deleteTrackingSite: (id) => api.delete(`/api/bp/tracking-sites/${id}`),
  // Platforms BookPilot doesn't run (tiktok, google): tracking campaigns and report imports.
  platformCampaigns: (platform) => api.get(`/api/bp/platform-campaigns/${platform}`),
  createPlatformCampaign: (platform, payload) => api.post(`/api/bp/platform-campaigns/${platform}`, payload),
  platformSummary: (platform) => api.get(`/api/bp/platform-import/${platform}`),
  platformImport: (platform, payload) => api.post(`/api/bp/platform-import/${platform}`, payload),
  platformRemove: (platform) => api.delete(`/api/bp/platform-import/${platform}`),
  amazonSummary: () => api.get("/api/bp/amazon-import"),
  amazonImport: (payload) => api.post("/api/bp/amazon-import", payload),
  amazonRemove: () => api.delete("/api/bp/amazon-import"),
  kdpSalesSummary: () => api.get("/api/bp/kdp-sales-import"),
  kdpSalesImport: (payload) => api.post("/api/bp/kdp-sales-import", payload),
  kdpSalesRemove: () => api.delete("/api/bp/kdp-sales-import"),

  landingPage: (bookId) => api.get(`/api/bp/landing-pages?book_id=${encodeURIComponent(bookId)}`),
  landingPageSlugAvailable: (slug, excludeId) =>
    api.get(`/api/bp/landing-pages/slug-available?slug=${encodeURIComponent(slug)}${excludeId ? `&exclude=${excludeId}` : ""}`),
  createLandingPage: (payload) => api.post("/api/bp/landing-pages", payload),
  updateLandingPage: (id, patch) => api.patch(`/api/bp/landing-pages/${id}`, patch),
  deleteLandingPage: (id) => api.delete(`/api/bp/landing-pages/${id}`),
  landingPageLeads: (id) => api.get(`/api/bp/landing-pages/${id}/leads`),
  trackingStatus: (id) => api.get(`/api/bp/tracking-sites/${id}/status`),
  // Demo workspace only: there is no real site to visit.
  simulateTestVisit: (id) => api.post(`/api/bp/tracking-sites/${id}/simulate-test`, {}),

  // AI
  // The three AI Strategy steps run as background jobs (see runAiJob above).
  analyzeBook: (bookId) => runAiJob("analyze", { book_id: bookId }),
  generatePersonas: (bookId, count) => runAiJob("personas", { book_id: bookId, count }),
  generateAngles: (bookId, count) => runAiJob("angles", { book_id: bookId, count }),
  generateCopy: (payload) => api.post("/api/bp-ai/copy", payload),
  generateCreatives: (payload) => api.post("/api/bp-ai/creatives", payload),
  generateVideoScript: (payload) => api.post("/api/bp-ai/video-script", payload),
  scoreCreative: (creativeId) => api.post("/api/bp-ai/score", { creative_id: creativeId }),
  analyzeCampaign: (campaignId) => api.post("/api/bp-ai/analyze-campaign", { campaign_id: campaignId }),
  budgetAdvice: (campaignId) => api.post("/api/bp-ai/budget", { campaign_id: campaignId }),
  askAdvisor: (question) => api.post("/api/bp-ai/advisor", { question }),
  patterns: () => api.post("/api/bp-ai/patterns", {}),

  // Billing
  billing: () => api.get("/api/bp-billing/summary"),
  checkout: (planId) => api.post("/api/bp-billing/checkout", { plan_id: planId }),
  portal: () => api.post("/api/bp-billing/portal"),

  // Platforms with a read-only API connection (pinterest, tiktok, google, amazon)
  connectAuthorizeUrl: (platform, params) =>
    api.get(`/api/bp-${platform}/authorize-url${params ? `?${new URLSearchParams(params)}` : ""}`),
  connectAccounts: (platform) => api.get(`/api/bp-${platform}/accounts`),
  connectSelectAccount: (platform, payload) => api.post(`/api/bp-${platform}/select-account`, payload),
  connectSync: (platform, payload) => api.post(`/api/bp-${platform}/sync`, payload),
  connectDisconnect: (platform) => api.post(`/api/bp-${platform}/disconnect`, {}),

  // Meta
  metaAuthorizeUrl: () => api.get("/api/bp-meta/authorize-url"),
  metaAccounts: () => api.get("/api/bp-meta/accounts"),
  metaSelectAccount: (payload) => api.post("/api/bp-meta/select-account", payload),
  metaPush: (payload) => api.post("/api/bp-meta/push", payload),
  metaStatus: (payload) => api.post("/api/bp-meta/status", payload),
  metaSync: (campaignId) => api.post("/api/bp-meta/sync", { campaign_id: campaignId }),

  // Admin
  changePlan: (planId) => api.post("/api/bp-billing/change-plan", { plan_id: planId }),
  adminBillingCheck: () => api.get("/api/bp-admin/billing-check"),
  adminCreatePrices: () => api.post("/api/bp-admin/billing/create-prices", {}),
  adminOverview: () => api.get("/api/bp-admin/overview"),
  adminUsers: () => api.get("/api/bp-admin/users"),
  adminSettings: () => api.get("/api/bp-admin/settings"),
  adminPrompts: () => api.get("/api/bp-admin/prompts"),
  adminPublishPrompts: () => api.post("/api/bp-admin/prompts/publish-defaults"),
  adminUpdatePlan: (id, patch) => api.patch(`/api/bp-admin/plans/${id}`, patch),
  adminUpdateCost: (operation, credits) => api.patch(`/api/bp-admin/credit-costs/${operation}`, { credits }),
  adminUpdateFlag: (key, enabled) => api.patch(`/api/bp-admin/flags/${key}`, { enabled }),
  adminUpdatePrompt: (key, patch) => api.patch(`/api/bp-admin/prompts/${key}`, patch),
  adminUpdateSetting: (key, value) => api.patch(`/api/bp-admin/settings/${key}`, { value }),
};
