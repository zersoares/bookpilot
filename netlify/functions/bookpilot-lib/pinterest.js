// Pinterest Ads API client (v5): read-only.
//
// BookPilot asks for one scope, `ads:read`, and calls three things: the
// author's ad accounts, their campaigns, and campaign analytics by day. It
// never creates or changes anything on Pinterest, and says so on screen.
//
// Written against Pinterest's published OpenAPI description (v5.28). It has
// NOT been run against a live Pinterest account — that needs an approved
// app — so the tests stub the network and check that requests are shaped
// as the spec says. When Pinterest rejects something, the detail goes to
// the log and the author sees a plain sentence, never a raw upstream error.

import { env } from "./env.js";
import { AppError, Errors } from "./errors.js";
import * as oauthState from "./oauth-state.js";

const API = "https://api.pinterest.com/v5";
const AUTHORIZE = "https://www.pinterest.com/oauth/";

/** Read-only, and the least that lets us see campaign figures. */
export const SCOPES = ["ads:read"];

/** Analytics allows at most 250 campaign ids per request and 90 days per range. */
export const MAX_CAMPAIGN_IDS = 250;
export const MAX_DAYS = 90;

export function configured() {
  return Boolean(env.pinterestAppId && env.pinterestAppSecret && env.pinterestRedirectUri);
}

// --- OAuth ------------------------------------------------------------

const stateSecret = () => env.oauthStateSecret || env.pinterestAppSecret;

export const signState = (userId) => oauthState.signState("pinterest", userId, stateSecret(), "Pinterest");
export const verifyState = (state) => oauthState.verifyState("pinterest", state, stateSecret());

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: env.pinterestAppId,
    redirect_uri: env.pinterestRedirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `${AUTHORIZE}?${params}`;
}

async function tokenRequest(form) {
  if (!configured()) throw Errors.notConfigured("The Pinterest integration");
  const basic = btoa(`${env.pinterestAppId}:${env.pinterestAppSecret}`);
  let res;
  try {
    res = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
  } catch (err) {
    console.error("[bookpilot] Pinterest unreachable:", err);
    throw Errors.pinterestConnect();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    console.error(`[bookpilot] Pinterest token request -> ${res.status}:`, JSON.stringify(body)?.slice(0, 300));
    throw Errors.pinterestConnect();
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresIn: Number(body.expires_in) || null,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

// `continuous_refresh` matters to apps created before 2025-09-25 and is
// ignored by newer ones, so it is always sent.
export const exchangeCode = (code) => tokenRequest({
  grant_type: "authorization_code", code, redirect_uri: env.pinterestRedirectUri, continuous_refresh: "true",
});

export const refreshTokens = (refreshToken) => tokenRequest({
  grant_type: "refresh_token", refresh_token: refreshToken, continuous_refresh: "true",
});

// --- Reading -----------------------------------------------------------

async function get(path, token, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    // The spec's default for an array is repeated parameters; `columns` is
    // the exception and is sent comma-separated, as the spec says.
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch (err) {
    console.error("[bookpilot] Pinterest unreachable:", err);
    throw Errors.pinterestConnect();
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return body;

  console.error(`[bookpilot] Pinterest GET ${path} -> ${res.status}:`, JSON.stringify(body)?.slice(0, 300));
  if (res.status === 401) throw Errors.pinterestConnect();
  if (res.status === 429) {
    throw new AppError("pinterest_rate_limited", "Pinterest is limiting requests right now. Try again in a few minutes.", 429);
  }
  throw Errors.pinterestAction();
}

/** Follow Pinterest's bookmark paging to the end, up to a sane cap. */
async function getAll(path, token, params = {}, maxPages = 20) {
  const items = [];
  let bookmark = null;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await get(path, token, { ...params, ...(bookmark ? { bookmark } : {}) });
    items.push(...(body?.items || []));
    bookmark = body?.bookmark || null;
    if (!bookmark) break;
  }
  return items;
}

export async function listAdAccounts(token) {
  const items = await getAll("/ad_accounts", token, { page_size: 100 });
  return items.map((a) => ({
    id: String(a.id),
    name: a.name || `Ad account ${a.id}`,
    currency: a.currency || null,
    country: a.country || null,
  }));
}

export async function listCampaigns(token, adAccountId) {
  const items = await getAll(`/ad_accounts/${adAccountId}/campaigns`, token, { page_size: 250 }, 10);
  return items.map((c) => ({ id: String(c.id), name: c.name || `Campaign ${c.id}`, status: c.status || null }));
}

// Columns from the sync enum in the spec. Money columns are micro-units of
// the ad account's currency. Outbound clicks are the ones that reached the
// author's site; link clicks are the fallback if an account does not report
// them. Checkouts are purchases: Total conversions counts every event.
export const COLUMNS = [
  "SPEND_IN_MICRO_DOLLAR", "IMPRESSION_1", "OUTBOUND_CLICK_1", "CLICKTHROUGH_1",
  "TOTAL_CHECKOUT", "TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR",
];

/** Daily analytics for campaigns, in request-sized batches. */
export async function campaignAnalytics(token, adAccountId, campaignIds, { since, until }) {
  const out = [];
  for (let i = 0; i < campaignIds.length; i += MAX_CAMPAIGN_IDS) {
    const body = await get(`/ad_accounts/${adAccountId}/campaigns/analytics`, token, {
      start_date: since,
      end_date: until,
      campaign_ids: campaignIds.slice(i, i + MAX_CAMPAIGN_IDS),
      columns: COLUMNS.join(","),
      granularity: "DAY",
    });
    if (Array.isArray(body)) out.push(...body);
  }
  return out;
}

// --- Pure helpers -------------------------------------------------------

/** Micro-units of a currency to whole cents (1,000,000 micro = 1 unit = 100 cents). */
export const microToCents = (micro) => Math.round(Number(micro || 0) / 10_000);

const nonNegative = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The date range to pull: at most 90 days, ending today (UTC). */
export function dateRange(days, now = Date.now()) {
  const n = Math.min(Math.max(Math.floor(Number(days) || 30), 1), MAX_DAYS);
  const day = 86_400_000;
  const until = new Date(now).toISOString().slice(0, 10);
  // A range of n days ending today starts n - 1 days back, so a 90-day
  // request stays inside Pinterest's 90-day limit.
  const since = new Date(now - (n - 1) * day).toISOString().slice(0, 10);
  return { since, until, days: n };
}

/**
 * Turn analytics items into performance rows. Items for campaigns we have
 * no BookPilot campaign for, or without a usable date, are dropped rather
 * than guessed at. "If a column has no value, it may not be returned", so
 * a missing figure is zero.
 */
export function toPerformanceRows(items, campaignIdMap, syncedAt = new Date().toISOString()) {
  const rows = [];
  for (const item of items) {
    const campaignId = campaignIdMap.get(String(item.CAMPAIGN_ID));
    if (!campaignId || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.DATE || ""))) continue;
    rows.push({
      campaign_id: campaignId,
      ad_id: null,
      metric_date: item.DATE,
      source: "pinterest",
      impressions: Math.round(nonNegative(item.IMPRESSION_1)),
      reach: 0, // unique reach cannot be summed across ad groups
      clicks: Math.round(nonNegative(item.OUTBOUND_CLICK_1 ?? item.CLICKTHROUGH_1)),
      spend_cents: microToCents(nonNegative(item.SPEND_IN_MICRO_DOLLAR)),
      conversions: Math.round(nonNegative(item.TOTAL_CHECKOUT)),
      revenue_cents: microToCents(nonNegative(item.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR)),
      synced_at: syncedAt,
    });
  }
  return rows;
}

/** BookPilot's status words for what Pinterest reports. */
export function statusFor(remoteStatus) {
  if (remoteStatus === "ACTIVE") return "active";
  if (remoteStatus === "ARCHIVED") return "completed";
  return "paused";
}

/**
 * Decide, for each Pinterest campaign, which BookPilot campaign it lands on.
 *
 *   match  — a BookPilot campaign already carries this Pinterest id
 *   link   — a BookPilot campaign (from a CSV import) has the same name and
 *            no Pinterest id yet, so it is claimed rather than duplicated
 *   create — nothing corresponds; a new one will be made
 *
 * A name is only used to link when it is unambiguous: two local campaigns
 * with the same name are left alone rather than guessed between.
 */
export function planCampaigns(remote, local) {
  const byExternal = new Map();
  const byName = new Map();
  for (const c of local) {
    if (c.external_campaign_id) byExternal.set(String(c.external_campaign_id), c);
    else {
      const key = c.name.trim().toLowerCase();
      byName.set(key, byName.has(key) ? null : c); // null marks an ambiguous name
    }
  }
  const claimed = new Set();
  return remote.map((r) => {
    const matched = byExternal.get(r.id);
    if (matched) return { remote: r, action: "match", local: matched };
    const named = byName.get(r.name.trim().toLowerCase());
    if (named && !claimed.has(named.id)) {
      claimed.add(named.id);
      return { remote: r, action: "link", local: named };
    }
    return { remote: r, action: "create", local: null };
  });
}
