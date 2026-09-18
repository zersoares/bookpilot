// Human-readable errors (spec §37).
//
// Nothing raw ever reaches the browser: an upstream "OAuthException 190"
// becomes "We couldn't connect your Meta account." The technical detail
// is kept server-side for the logs.

export class AppError extends Error {
  constructor(code, message, status = 400, detail = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const Errors = {
  unauthorized: () =>
    new AppError("unauthorized", "Please sign in to continue.", 401),
  forbidden: () =>
    new AppError("forbidden", "You don't have access to that.", 403),
  notFound: (what = "item") =>
    new AppError("not_found", `We couldn't find that ${what}.`, 404),
  invalid: (message) => new AppError("invalid_input", message, 400),
  rateLimited: (retryAfter) =>
    new AppError(
      "rate_limited",
      "That's a lot of requests in a short time. Please wait a moment and try again.",
      429,
      { retryAfter }
    ),
  noCredits: (needed, available) =>
    new AppError(
      "insufficient_credits",
      `This needs ${needed} AI credits and you have ${available} left. Top up on the Billing page to continue.`,
      402,
      { needed, available }
    ),
  planLimit: (message) => new AppError("plan_limit", message, 402),
  aiUnavailable: () =>
    new AppError(
      "ai_unavailable",
      "The AI service isn't reachable right now. Nothing was charged — please try again in a minute.",
      503
    ),
  aiRefused: () =>
    new AppError(
      "ai_refused",
      "The AI declined this request. Try rephrasing it, or check that the book details don't ask for claims we can't verify.",
      422
    ),
  metaConnect: () =>
    new AppError(
      "meta_connection_failed",
      "We couldn't connect your Meta account. Please reconnect it and try again.",
      502
    ),
  metaAction: () =>
    new AppError(
      "meta_action_failed",
      "Meta rejected that request. Your campaign was not changed — check that your ad account is active and try again.",
      502
    ),
  pinterestConnect: () =>
    new AppError(
      "pinterest_connection_failed",
      "We couldn't reach your Pinterest account. Please reconnect it and try again.",
      502
    ),
  pinterestAction: () =>
    new AppError(
      "pinterest_action_failed",
      "Pinterest didn't return that data. Check that the ad account is still active and that you can see it in Pinterest Ads Manager, then try again.",
      502
    ),
  tiktokConnect: () =>
    new AppError(
      "tiktok_connection_failed",
      "We couldn't reach your TikTok account. Please reconnect it and try again.",
      502
    ),
  tiktokAction: () =>
    new AppError(
      "tiktok_action_failed",
      "TikTok didn't return that data. Check that the ad account is still active and that you can see it in TikTok Ads Manager, then try again.",
      502
    ),
  integrationMissing: (name) =>
    new AppError(
      "integration_missing",
      `Connect your ${name} account first — this action needs it.`,
      409
    ),
  notConfigured: (what) =>
    new AppError(
      "not_configured",
      `${what} isn't set up on this deployment yet.`,
      501
    ),
  database: () =>
    new AppError(
      "database_error",
      "We couldn't save that. Please try again — if it keeps happening, contact support.",
      502
    ),
  internal: () =>
    new AppError("internal_error", "Something went wrong on our side.", 500),
};

// Map an error to the payload the client receives. Never leaks stack
// traces, SQL, provider codes or configuration values.
export function toResponseBody(err) {
  if (err instanceof AppError) {
    return {
      error: { code: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) },
    };
  }
  return { error: { code: "internal_error", message: Errors.internal().message } };
}
