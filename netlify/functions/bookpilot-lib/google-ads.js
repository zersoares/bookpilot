// Google Ads API client (v25): reads only.
//
// BookPilot calls three things: the accounts a login can reach, each
// account's currency, and a campaign-by-day report written in GAQL. It never
// calls a mutate endpoint, and a test enforces that.
//
// IMPORTANT, and unlike Pinterest and TikTok: Google offers exactly one
// OAuth scope for this API, `https://www.googleapis.com/auth/adwords`, which
// its own description calls "See, edit, create, and delete your Google Ads
// accounts and data". There is no read-only scope to ask for. So "reads
// only" is a promise the code keeps, not one the permission enforces, and
// the screen says exactly that instead of implying otherwise.
//
// Written against Google's published discovery document for v25 and its
// documented OAuth endpoints. It has NOT been run against a live Google Ads
// account: that needs a developer token approved for production and an
// OAuth app Google has verified. The tests stub the network and check the
// requests against the specification.

import { env } from "./env.js";
import { AppError, Errors } from "./errors.js";
import * as oauthState from "./oauth-state.js";

/**
 * Google retires each API version about a year after it ships (v22 in
 * October 2026, v25 in August 2027, per Google's sunset schedule), so this
 * needs bumping roughly yearly. Fields used here were checked against v25.
 */
export const API_VERSION = "v25";
const API = `https://googleads.googleapis.com/${API_VERSION}`;

export const SCOPE = "https://www.googleapis.com/auth/adwords";
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";

export const MAX_DAYS = 90;
const MAX_ACCOUNTS = 50;
const MAX_PAGES = 20;

export function configured() {
  return Boolean(env.googleAdsClientId && env.googleAdsClientSecret && env.googleAdsDeveloperToken && env.googleAdsRedirectUri);
}

// --- OAuth --------------------------------------------------------------------

const stateSecret = () => env.oauthStateSecret || env.googleAdsClientSecret;

export const signState = (userId) => oauthState.signState("google", userId, stateSecret(), "Google Ads");
export const verifyState = (state) => oauthState.verifyState("google", state, stateSecret());

/**
 * `access_type=offline` and `prompt=consent` together make Google return a
 * refresh token every time; without the prompt a returning user gets none
 * and the connection dies when the one-hour access token does.
 */
export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: env.googleAdsClientId,
    redirect_uri: env.googleAdsRedirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTHORIZE}?${params}`;
}

async function tokenRequest(form) {
  if (!configured()) throw Errors.notConfigured("The Google Ads integration");
  let res;
  try {
    res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.googleAdsClientId, client_secret: env.googleAdsClientSecret, ...form }),
    });
  } catch (err) {
    console.error("[bookpilot] Google unreachable:", err);
    throw Errors.googleConnect();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    console.error(`[bookpilot] Google token request -> ${res.status}:`, JSON.stringify(body)?.slice(0, 300));
    throw Errors.googleConnect();
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresIn: Number(body.expires_in) || null,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

export async function exchangeCode(code) {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env.googleAdsRedirectUri });
  if (!tokens.refreshToken) {
    // Without one, the connection would end in an hour. Better to say so now.
    console.error("[bookpilot] Google returned no refresh token");
    throw Errors.googleConnect();
  }
  return tokens;
}

export const refreshTokens = (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

/** Ask Google to invalidate a token (a refresh token also ends its access tokens). */
export async function revokeToken(token) {
  const res = await fetch(REVOKE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!res.ok) throw Errors.googleAction();
}

// --- Requests -----------------------------------------------------------------

/**
 * Google reports the reason inside the error: `details[].errors[].errorCode`
 * is an object with one key, the error family, and one value, the code.
 */
export function errorCodes(body) {
  const out = [];
  for (const detail of body?.error?.details || []) {
    for (const e of detail?.errors || []) {
      for (const [family, code] of Object.entries(e?.errorCode || {})) out.push([family, String(code)]);
    }
  }
  return out;
}

function mapError(status, body) {
  const codes = errorCodes(body);
  const has = (family, code) => codes.some(([f, c]) => f === family && (code === undefined || c === code));
  console.error(`[bookpilot] Google Ads -> ${status}:`, JSON.stringify(codes), String(body?.error?.message || "").slice(0, 200));

  if (status === 429 || body?.error?.status === "RESOURCE_EXHAUSTED" || has("quotaError")) {
    return new AppError("google_rate_limited", "Google is limiting requests right now. Try again in a few minutes.", 429);
  }
  // Our developer token, not the author's login: nothing they can fix.
  if (has("authorizationError", "DEVELOPER_TOKEN_NOT_APPROVED") || has("authorizationError", "DEVELOPER_TOKEN_PROHIBITED")) {
    return new AppError(
      "google_ads_not_approved",
      "BookPilot's Google Ads access hasn't been approved for live accounts yet, so this account can't be read. That is on our side, not yours. Import a report in the meantime.",
      503
    );
  }
  if (status === 401 || has("authenticationError") || body?.error?.status === "UNAUTHENTICATED") return Errors.googleConnect();
  return Errors.googleAction();
}

async function ads(method, path, token, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": env.googleAdsDeveloperToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("[bookpilot] Google Ads unreachable:", err);
    throw Errors.googleConnect();
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return json ?? {};
  throw mapError(res.status, json);
}

/**
 * Run a GAQL query and follow its pages. `pageSize` is deliberately not
 * sent: v25 rejects it with PAGE_SIZE_NOT_SUPPORTED, and pages are a fixed
 * size chosen by Google.
 */
export async function search(token, customerId, query) {
  if (!/^\d{5,15}$/.test(String(customerId))) throw Errors.invalid("That doesn't look like a Google Ads account id.");
  const out = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await ads("POST", `/customers/${customerId}/googleAds:search`, token, { query, ...(pageToken ? { pageToken } : {}) });
    out.push(...(body.results || []));
    pageToken = body.nextPageToken || null;
    if (!pageToken) break;
  }
  return out;
}

// --- Accounts -----------------------------------------------------------------

const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status " +
  "FROM customer LIMIT 1";

/**
 * The accounts this login can reach directly, ready to sync. Manager
 * accounts are left out (they hold no metrics of their own; their clients
 * are separate accounts), and so is anything that cannot be read, rather
 * than listing something a sync would only fail on.
 */
export async function listAdAccounts(token) {
  const listed = await ads("GET", "/customers:listAccessibleCustomers", token);
  const ids = (listed.resourceNames || []).map((n) => /^customers\/(\d+)$/.exec(n)?.[1]).filter(Boolean).slice(0, MAX_ACCOUNTS);

  const accounts = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      try {
        const [row] = await search(token, id, CUSTOMER_QUERY);
        return row?.customer || null;
      } catch (err) {
        // An account the login can list but not read (cancelled, no access).
        if (err?.code === "google_connection_failed") throw err;
        console.warn("[bookpilot] Google Ads account not readable:", id, err?.code);
        return null;
      }
    }));
    for (const c of batch) {
      if (!c || c.manager) continue;
      accounts.push({
        id: String(c.id),
        name: c.descriptiveName || `Account ${c.id}`,
        currency: c.currencyCode || null,
        timezone: c.timeZone || null,
      });
    }
  }
  return accounts;
}

// --- Reports --------------------------------------------------------------------

const assertDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw Errors.invalid("That isn't a date.");
  return value;
};

/** Campaign by day: cost, impressions, clicks, and the campaign's real status. */
export function campaignQuery({ since, until }) {
  return "SELECT campaign.id, campaign.name, campaign.status, segments.date, " +
    "metrics.impressions, metrics.clicks, metrics.cost_micros " +
    `FROM campaign WHERE segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}' ` +
    "AND campaign.status != 'REMOVED'";
}

/**
 * Purchases only. `metrics.conversions` on its own counts every conversion
 * action the account includes in its Conversions column (sign-ups, add to
 * carts, calls), which is what makes the CSV import overcount. Filtering on
 * the Purchase category counts what an author means by a sale. The segment
 * is selected as well as filtered, so the query is valid either way.
 */
export function purchaseQuery({ since, until }) {
  return "SELECT campaign.id, segments.date, segments.conversion_action_category, " +
    "metrics.conversions, metrics.conversions_value " +
    `FROM campaign WHERE segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}' ` +
    "AND segments.conversion_action_category = 'PURCHASE' AND campaign.status != 'REMOVED'";
}

export async function report(token, customerId, range) {
  const base = await search(token, customerId, campaignQuery(range));
  const purchases = await search(token, customerId, purchaseQuery(range));
  return { base, purchases };
}

// --- Pure helpers -----------------------------------------------------------------

/** A figure from Google's numbers, which arrive as int64 strings or doubles. */
export function figure(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Micro-units (1,000,000 = one currency unit) to whole cents. */
export const microsToCents = (micros) => Math.round(figure(micros) / 10_000);

/**
 * The days to pull, ending yesterday (UTC): Google reports in the account's
 * own time zone, and yesterday in UTC has started everywhere.
 */
export function dateRange(days, now = Date.now()) {
  const n = Math.min(Math.max(Math.floor(Number(days) || 30), 1), MAX_DAYS);
  const day = 86_400_000;
  const until = new Date(now - day).toISOString().slice(0, 10);
  const since = new Date(now - n * day).toISOString().slice(0, 10);
  return { since, until, days: n };
}

/** Google's campaign statuses, in BookPilot's words. REMOVED is never queried. */
export function statusFor(status) {
  return status === "ENABLED" ? "active" : "paused";
}

/** The campaigns a report mentions, with the status Google gave them. */
export function campaignsFromReport(baseRows) {
  const seen = new Map();
  for (const row of baseRows) {
    const c = row?.campaign;
    if (!c?.id) continue;
    seen.set(String(c.id), { id: String(c.id), name: String(c.name || "").trim() || `Campaign ${c.id}`, status: c.status || null });
  }
  return [...seen.values()];
}

/**
 * Campaign-by-day rows from the two reports. Rows for a campaign we did not
 * map, or without a real date, are dropped rather than guessed at.
 */
export function toPerformanceRows(base, purchases, campaignIdMap, syncedAt = new Date().toISOString()) {
  const byKey = new Map();
  const at = (campaignId, date) => {
    const key = `${campaignId}|${date}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        campaign_id: campaignId, ad_id: null, metric_date: date, source: "google",
        impressions: 0, reach: 0, clicks: 0, spend_cents: 0, conversions: 0, revenue_cents: 0, synced_at: syncedAt,
      });
    }
    return byKey.get(key);
  };
  const usable = (row) => {
    const campaignId = campaignIdMap.get(String(row?.campaign?.id));
    const date = String(row?.segments?.date || "");
    return campaignId && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { campaignId, date } : null;
  };

  for (const row of base) {
    const k = usable(row);
    if (!k) continue;
    const r = at(k.campaignId, k.date);
    r.impressions += Math.round(figure(row.metrics?.impressions));
    r.clicks += Math.round(figure(row.metrics?.clicks));
    r.spend_cents += microsToCents(row.metrics?.costMicros);
  }
  for (const row of purchases) {
    const k = usable(row);
    if (!k) continue;
    const r = at(k.campaignId, k.date);
    r.conversions += Math.round(figure(row.metrics?.conversions));
    r.revenue_cents += Math.round(figure(row.metrics?.conversionsValue) * 100);
  }
  return [...byKey.values()];
}
