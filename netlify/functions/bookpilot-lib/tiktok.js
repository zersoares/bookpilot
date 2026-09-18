// TikTok Marketing API client (v1.3): read-only.
//
// BookPilot uses three calls: the advertisers that granted access, their
// currency and time zone, and a campaign-by-day report. It never creates,
// changes, pauses or launches anything on TikTok, and asks for nothing
// beyond the two permissions that needs: Reporting, and Ad Account
// Information. Campaign names come from the report itself, so the broader
// "Ads Management" permission is not needed.
//
// Written against TikTok's own documentation and its official SDK's OpenAPI
// files. It has NOT been run against a live TikTok account — that needs an
// approved developer app — so the tests stub the network and check that
// requests are shaped as the documentation says. TikTok's answers are
// treated as untrusted, upstream detail goes to the log and never to the
// author, and the first real sync is the real test.
//
// How TikTok differs from Pinterest, and what follows from it:
//   * The authorization URL is generated in the TikTok developer portal for
//     the app (with its redirect address baked in). It is configuration, not
//     something built here; only the `state` parameter is set.
//   * The callback carries `auth_code` (one hour, one use), not `code`.
//   * The access token is long-term: it does not expire and is not
//     refreshed. It stops working if the advertiser removes access, and it
//     can be revoked, which Disconnect does.
//   * A daily report may span at most 30 days, so a longer pull is windowed.

import { env } from "./env.js";
import { AppError, Errors } from "./errors.js";
import * as oauthState from "./oauth-state.js";

const API = "https://business-api.tiktok.com/open_api/v1.3";

export const MAX_DAYS = 90;
/** With a stat_time_day dimension TikTok allows at most 30 days per query. */
export const MAX_WINDOW_DAYS = 30;
export const PAGE_SIZE = 1000;

export const DIMENSIONS = ["campaign_id", "stat_time_day"];

// Names are TikTok's own. Two look odd and are right: `clicks` is "Clicks
// (destination)", the clicks that reached a landing page, and
// `total_complete_payment_rate` is what the documentation lists as "Purchase
// value (website)" (the name says rate; the description says value).
// Money is in the advertiser's currency, as decimal strings.
export const METRICS = [
  "campaign_name", "spend", "impressions", "clicks", "complete_payment", "total_complete_payment_rate",
];

export function configured() {
  return Boolean(env.tiktokAppId && env.tiktokAppSecret && env.tiktokAuthUrl);
}

// --- Authorization ----------------------------------------------------------

const stateSecret = () => env.oauthStateSecret || env.tiktokAppSecret;

export const signState = (userId) => oauthState.signState("tiktok", userId, stateSecret(), "TikTok");
export const verifyState = (state) => oauthState.verifyState("tiktok", state, stateSecret());

/**
 * The advertiser authorization URL from the developer portal, with our
 * signed state set. Refuses a URL that is not TikTok's, or that names a
 * different app than the one configured: a wrong value here would send
 * authors to the wrong place.
 */
export function authorizeUrl(state) {
  let url;
  try {
    url = new URL(env.tiktokAuthUrl);
  } catch {
    throw Errors.notConfigured("The TikTok integration");
  }
  const host = url.hostname.toLowerCase();
  const tiktokHost = host === "tiktok.com" || host.endsWith(".tiktok.com");
  if (url.protocol !== "https:" || !tiktokHost) throw Errors.notConfigured("The TikTok integration");
  const appId = url.searchParams.get("app_id");
  if (appId && appId !== env.tiktokAppId) throw Errors.notConfigured("The TikTok integration");
  url.searchParams.set("state", state);
  return url.toString();
}

// --- Requests ---------------------------------------------------------------

const encode = (value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/** A TikTok call: HTTP 200 with `code: 0` is success; anything else is not. */
async function call(method, path, { token, params = {}, body } = {}) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, encode(value));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(token ? { "Access-Token": token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("[bookpilot] TikTok unreachable:", err);
    throw Errors.tiktokConnect();
  }
  const json = await res.json().catch(() => null);
  if (res.ok && json && json.code === 0) return json.data ?? {};

  console.error(`[bookpilot] TikTok ${method} ${path} -> ${res.status}:`, JSON.stringify(json)?.slice(0, 300));
  if (res.status === 429) {
    throw new AppError("tiktok_rate_limited", "TikTok is limiting requests right now. Try again in a few minutes.", 429);
  }
  // A revoked or invalid token is the one failure the author can fix by
  // reconnecting; the wording of TikTok's message is the only signal.
  if (res.status === 401 || /access.?token|unauthori[sz]ed|authoriz/i.test(String(json?.message || ""))) {
    throw Errors.tiktokConnect();
  }
  throw Errors.tiktokAction();
}

/** Trade the one-hour, single-use auth_code for the long-term token. */
export async function exchangeCode(authCode) {
  if (!env.tiktokAppId || !env.tiktokAppSecret) throw Errors.notConfigured("The TikTok integration");
  const data = await call("POST", "/oauth2/access_token/", {
    body: { app_id: env.tiktokAppId, secret: env.tiktokAppSecret, auth_code: authCode },
  });
  if (!data.access_token) throw Errors.tiktokConnect();
  return {
    accessToken: data.access_token,
    advertiserIds: Array.isArray(data.advertiser_ids) ? data.advertiser_ids.map(String) : [],
    scope: Array.isArray(data.scope) ? data.scope : [],
  };
}

/** Invalidate the token at TikTok. The one platform here that supports it. */
export async function revokeToken(token) {
  await call("POST", "/oauth2/revoke_token/", {
    token,
    body: { app_id: env.tiktokAppId, secret: env.tiktokAppSecret, access_token: token },
  });
}

// --- Reading -----------------------------------------------------------------

/**
 * The advertiser accounts that granted access, with currency and time zone.
 * The list comes from the OAuth endpoint; the details from the account
 * endpoint. If the details cannot be read the account is still listed, with
 * no currency, and a sync will refuse it rather than guess.
 */
export async function listAdAccounts(token) {
  const listed = await call("GET", "/oauth2/advertiser/get/", {
    token,
    params: { app_id: env.tiktokAppId, secret: env.tiktokAppSecret },
  });
  const accounts = (listed.list || []).map((a) => ({
    id: String(a.advertiser_id),
    name: a.advertiser_name || `Ad account ${a.advertiser_id}`,
    currency: null,
    timezone: null,
  }));
  if (!accounts.length) return accounts;

  const details = new Map();
  try {
    for (let i = 0; i < accounts.length; i += 100) {
      const info = await call("GET", "/advertiser/info/", {
        token,
        params: {
          advertiser_ids: accounts.slice(i, i + 100).map((a) => a.id),
          fields: ["advertiser_id", "name", "currency", "timezone"],
        },
      });
      for (const d of info.list || []) details.set(String(d.advertiser_id), d);
    }
  } catch (err) {
    // Without the Ad Account Information permission this fails; the list is
    // still worth showing.
    console.warn("[bookpilot] TikTok advertiser details unavailable:", err?.code || err?.message);
  }
  return accounts.map((a) => {
    const d = details.get(a.id);
    return d ? { ...a, name: d.name || a.name, currency: d.currency || null, timezone: d.timezone || null } : a;
  });
}

/** Daily campaign rows for an advertiser, across 30-day windows and pages. */
export async function reportRows(token, advertiserId, windows) {
  const out = [];
  for (const window of windows) {
    for (let page = 1; page <= 20; page += 1) {
      const data = await call("GET", "/report/integrated/get/", {
        token,
        params: {
          advertiser_id: advertiserId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: DIMENSIONS,
          metrics: METRICS,
          start_date: window.since,
          end_date: window.until,
          page,
          page_size: PAGE_SIZE,
        },
      });
      out.push(...(data.list || []));
      const totalPages = Number(data.page_info?.total_page) || 1;
      if (page >= totalPages) break;
    }
  }
  return out;
}

// --- Pure helpers -------------------------------------------------------------

/** A figure from TikTok's string metrics; "-" and junk are zero, negatives too. */
export function figure(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Money from TikTok's decimal string, in whole cents. The decimal point is
 * moved in the string ("1.005e2") rather than by multiplying, because
 * 1.005 * 100 is 100.49999999999999 in floating point and a half cent would
 * round the wrong way. Anything that is not a plain non-negative decimal is
 * zero, as with the other figures.
 */
export function cents(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return 0;
  return Math.round(Number(`${text}e2`));
}

/**
 * The days to pull, cut into windows TikTok will accept. The range ends
 * yesterday (UTC): TikTok dates are in the ad account's own time zone, and
 * asking for a day that has not started there yet is an error, while
 * yesterday in UTC has started everywhere.
 */
export function dateWindows(days, now = Date.now()) {
  const n = Math.min(Math.max(Math.floor(Number(days) || 30), 1), MAX_DAYS);
  const day = 86_400_000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const end = now - day;
  const windows = [];
  let remaining = n;
  let windowEnd = end;
  while (remaining > 0) {
    const length = Math.min(remaining, MAX_WINDOW_DAYS);
    windows.unshift({ since: iso(windowEnd - (length - 1) * day), until: iso(windowEnd) });
    windowEnd -= length * day;
    remaining -= length;
  }
  return { since: windows[0].since, until: iso(end), days: n, windows };
}

const dayOf = (item) => String(item?.dimensions?.stat_time_day || "").slice(0, 10);

/** The campaigns a report mentions, named as TikTok names them. */
export function campaignsFromReport(list) {
  const names = new Map();
  for (const item of list) {
    const id = item?.dimensions?.campaign_id;
    if (!id) continue;
    const name = String(item.metrics?.campaign_name || "").trim();
    // "-" is how TikTok marks a value it cannot state.
    if (name && name !== "-") names.set(String(id), name);
    else if (!names.has(String(id))) names.set(String(id), `Campaign ${id}`);
  }
  return [...names].map(([id, name]) => ({ id, name }));
}

/**
 * Report items to performance rows. Items without a campaign we mapped, or
 * without a real date, are dropped rather than guessed at.
 */
export function toPerformanceRows(list, campaignIdMap, syncedAt = new Date().toISOString()) {
  const rows = [];
  for (const item of list) {
    const campaignId = campaignIdMap.get(String(item?.dimensions?.campaign_id));
    const date = dayOf(item);
    if (!campaignId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const m = item.metrics || {};
    rows.push({
      campaign_id: campaignId,
      ad_id: null,
      metric_date: date,
      source: "tiktok",
      impressions: Math.round(figure(m.impressions)),
      reach: 0, // unique reach cannot be summed across ad groups
      clicks: Math.round(figure(m.clicks)),
      spend_cents: cents(m.spend),
      conversions: Math.round(figure(m.complete_payment)),
      revenue_cents: cents(m.total_complete_payment_rate),
      synced_at: syncedAt,
    });
  }
  return rows;
}

/**
 * BookPilot does not ask TikTok for a campaign's status (that would need
 * the broader Ads Management permission), so status is read from what the
 * figures show: spending in the last three days of the range means it is
 * running. It is an inference, and the screen says so.
 */
export function statusFromSpend(rows, until) {
  const last = Date.parse(`${until}T00:00:00Z`);
  const recent = rows.some((r) => r.spend_cents > 0 && last - Date.parse(`${r.metric_date}T00:00:00Z`) <= 2 * 86_400_000);
  return recent ? "active" : "paused";
}
