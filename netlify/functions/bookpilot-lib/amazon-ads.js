// Amazon Ads API client: the Amazon Attribution API, reads only.
//
// BookPilot calls three things: the advertising profiles a login can reach
// (`GET /v2/profiles`), the advertisers behind one of them
// (`GET /attribution/advertisers`), and an Attribution performance report
// (`POST /attribution/report`). It never calls anything that creates or
// changes an advertising resource, and a test enforces that.
//
// IMPORTANT, as with Google Ads and unlike Pinterest and TikTok: the Amazon
// Ads API has one OAuth scope, `advertising::campaign_management`, and its
// name says what it allows. There is no read-only scope to ask for. So "reads
// only" is a promise the code keeps, not one the permission enforces, and
// the screen says exactly that.
//
// Amazon Attribution figures are Amazon-attributed (ad-click purchases on
// Amazon within 14 days of the click). They are not KDP sales, and they go
// in their own table, never added to Meta or website numbers.
//
// Written against Amazon's published OpenAPI specification for the
// Attribution API and the request shapes in its Postman collection. It has
// NOT been run against a live Amazon Ads account: that needs approved Amazon
// Ads API access for BookPilot and an author whose account has Amazon
// Attribution. The specification does not define the metric fields of a
// report entry (they come back "dynamically"), so their names are matched
// loosely and an answer with none of them is refused rather than stored as
// zeros. The tests stub the network.

import { env } from "./env.js";
import { AppError, Errors } from "./errors.js";
import * as oauthState from "./oauth-state.js";
import { UNNAMED } from "./amazon.js";

export const SCOPE = "advertising::campaign_management";

/**
 * Amazon's Ads API is regional: a login, its token and its profiles all
 * belong to one region, and each has its own hosts. Attribution's API is
 * offered to sellers, vendors and authors in the US, Canada, UK, Germany,
 * France, Italy and Spain, which is these two. (The Far East region has
 * hosts of its own and is not offered.)
 */
export const REGIONS = {
  na: {
    label: "North America (Amazon.com, Amazon.ca)",
    authorize: "https://www.amazon.com/ap/oa",
    token: "https://api.amazon.com/auth/o2/token",
    api: "https://advertising-api.amazon.com",
  },
  eu: {
    label: "Europe (Amazon.co.uk, .de, .fr, .it, .es)",
    authorize: "https://eu.account.amazon.com/ap/oa",
    token: "https://api.amazon.co.uk/auth/o2/token",
    api: "https://advertising-api-eu.amazon.com",
  },
};

export const MAX_DAYS = 90;
const MAX_PROFILES = 50;
const PAGE = 5000; // the specification's maximum `count`
const MAX_PAGES = 20;

/**
 * The metrics asked for, for the products the campaign promotes (not the
 * "brand halo" products), which is what the CSV import's columns mean too.
 * `name` is Amazon's; `key` is BookPilot's.
 */
export const METRICS = [
  { key: "clicks", name: "Click-throughs" },
  { key: "detail_page_views", name: "attributedDetailPageViewsClicks14d" },
  { key: "add_to_carts", name: "attributedAddToCartClicks14d" },
  { key: "purchases", name: "attributedPurchases14d" },
  { key: "units_sold", name: "unitsSold14d" },
  { key: "product_sales_cents", name: "attributedSales14d", money: true },
];

export function configured() {
  return Boolean(env.amazonAdsClientId && env.amazonAdsClientSecret && env.amazonAdsRedirectUri);
}

export const isRegion = (value) => Object.hasOwn(REGIONS, String(value));

// --- OAuth --------------------------------------------------------------------

const stateSecret = () => env.oauthStateSecret || env.amazonAdsClientSecret;

/** The region travels in the signed state's provider tag, so it cannot be swapped. */
export async function signState(userId, region) {
  if (!isRegion(region)) throw Errors.invalid("Choose your Amazon marketplace region.");
  return oauthState.signState(`amazon-${region}`, userId, stateSecret(), "Amazon Attribution");
}

/** `{ userId, region }` for a valid, fresh state; otherwise null. */
export async function verifyState(state) {
  for (const region of Object.keys(REGIONS)) {
    const userId = await oauthState.verifyState(`amazon-${region}`, state, stateSecret());
    if (userId) return { userId, region };
  }
  return null;
}

export function authorizeUrl(state, region) {
  if (!isRegion(region)) throw Errors.invalid("Choose your Amazon marketplace region.");
  const params = new URLSearchParams({
    client_id: env.amazonAdsClientId,
    scope: SCOPE,
    response_type: "code",
    redirect_uri: env.amazonAdsRedirectUri,
    state,
  });
  return `${REGIONS[region].authorize}?${params}`;
}

async function tokenRequest(region, form) {
  if (!configured()) throw Errors.notConfigured("The Amazon Attribution integration");
  let res;
  try {
    res = await fetch(REGIONS[region].token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.amazonAdsClientId, client_secret: env.amazonAdsClientSecret, ...form }),
    });
  } catch (err) {
    console.error("[bookpilot] Amazon unreachable:", err);
    throw Errors.amazonConnect();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    console.error(`[bookpilot] Amazon token request -> ${res.status}:`, JSON.stringify(body)?.slice(0, 300));
    throw Errors.amazonConnect();
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresIn: Number(body.expires_in) || null,
  };
}

export async function exchangeCode(region, code) {
  const tokens = await tokenRequest(region, { grant_type: "authorization_code", code, redirect_uri: env.amazonAdsRedirectUri });
  if (!tokens.refreshToken) {
    // Access tokens last an hour; without a refresh token the connection would end then.
    console.error("[bookpilot] Amazon returned no refresh token");
    throw Errors.amazonConnect();
  }
  return tokens;
}

export const refreshTokens = (region, refreshToken) =>
  tokenRequest(region, { grant_type: "refresh_token", refresh_token: refreshToken });

// --- Requests -----------------------------------------------------------------

function mapError(status, body) {
  console.error(`[bookpilot] Amazon Ads -> ${status}:`, String(body?.code ?? ""), String(body?.details ?? body?.message ?? "").slice(0, 200));

  if (status === 429) {
    return new AppError("amazon_rate_limited", "Amazon is limiting requests right now. Try again in a few minutes.", 429);
  }
  if (status === 401) return Errors.amazonConnect();
  // Amazon's reply for "not allowed" is the same whether the author's account
  // has no Attribution or BookPilot's own API access is not yet approved, so
  // the message names both and blames neither.
  if (status === 403) {
    return new AppError(
      "amazon_not_available",
      "Amazon didn't allow that. This account may not have Amazon Attribution set up, or BookPilot's Amazon Ads API access may not be approved for it yet. Import a report in the meantime.",
      502
    );
  }
  return Errors.amazonAction();
}

/**
 * Profile ids are 15 or 16 digits and arrive as JSON numbers, which are
 * doubles, so the last digits can be lost. They are turned into strings in
 * the text before it is parsed.
 */
const parseJson = (text) => {
  try { return JSON.parse(String(text).replace(/("profileId"\s*:\s*)(\d+)/g, '$1"$2"')); } catch { return null; }
};

async function ads(region, method, path, token, { scope, body } = {}) {
  let res;
  try {
    res = await fetch(`${REGIONS[region].api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Amazon-Advertising-API-ClientId": env.amazonAdsClientId,
        ...(scope ? { "Amazon-Advertising-API-Scope": String(scope) } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("[bookpilot] Amazon Ads unreachable:", err);
    throw Errors.amazonConnect();
  }
  const parsed = parseJson(await res.text().catch(() => ""));
  if (res.ok) return parsed ?? {};
  throw mapError(res.status, parsed);
}

// --- Accounts -----------------------------------------------------------------

/**
 * The advertising profiles this login can reach in a region, one per
 * marketplace. Whether a profile has Amazon Attribution is only known by
 * asking (`listAdvertisers`), which happens when one is chosen.
 */
export async function listProfiles(region, token) {
  const list = await ads(region, "GET", "/v2/profiles", token);
  return (Array.isArray(list) ? list : []).slice(0, MAX_PROFILES).flatMap((p) => {
    const id = String(p?.profileId ?? "");
    if (!/^\d{5,20}$/.test(id)) return [];
    const info = p.accountInfo || {};
    return [{
      id,
      name: [info.name || `Account ${id}`, info.type].filter(Boolean).join(" · "),
      country: p.countryCode || null,
      currency: p.currencyCode || null,
      timezone: p.timezone || null,
    }];
  });
}

/** The Attribution advertisers behind a profile (403 when it has none). */
export async function listAdvertisers(region, token, profileId) {
  const body = await ads(region, "GET", "/attribution/advertisers", token, { scope: profileId });
  return (body.advertisers || []).map((a) => ({ id: String(a.advertiserId ?? ""), name: a.advertiserName || null })).filter((a) => a.id);
}

// --- Reports --------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

/**
 * The last `days` days, ending yesterday (UTC). Amazon reports each event on
 * the day it happened and restates recent days, so the newest figures are
 * the least settled; today is left out rather than stored half-counted.
 */
export function dateRange(days, now = Date.now()) {
  const n = Math.min(Math.max(Math.floor(Number(days) || 30), 1), MAX_DAYS);
  const startOfToday = Math.floor(now / 86_400_000) * 86_400_000;
  const since = iso(startOfToday - n * 86_400_000);
  const until = iso(startOfToday - 86_400_000);
  return { since, until, startDate: since.replaceAll("-", ""), endDate: until.replaceAll("-", "") };
}

/**
 * The report, page by page. Performance grouped by ad group is used because
 * it is the coarsest level that names the publisher (Google Ads, Meta, …);
 * grouped by campaign the rows would carry only Amazon's campaign id.
 * A report too big to finish is an error, not a silently partial import.
 */
export async function report(region, token, profileId, { startDate, endDate }) {
  const out = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await ads(region, "POST", "/attribution/report", token, {
      scope: profileId,
      body: {
        reportType: "PERFORMANCE",
        groupBy: "ADGROUP",
        startDate,
        endDate,
        count: PAGE,
        metrics: METRICS.map((m) => m.name).join(","),
        cursorId: cursor,
      },
    });
    const entries = Array.isArray(body.reports) ? body.reports : [];
    out.push(...entries);
    const next = typeof body.cursorId === "string" ? body.cursorId : "";
    if (!entries.length || !next || next === cursor) return out;
    cursor = next;
  }
  console.error("[bookpilot] Amazon report exceeded", MAX_PAGES, "pages");
  throw Errors.invalid("That report is too large to pull in one go. Choose fewer days.");
}

const norm = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Money from Amazon's number, in whole cents. The decimal point is moved in
 * the string ("1.005e2") rather than by multiplying, because 1.005 * 100 is
 * 100.49999999999999 in floating point. Anything that is not a plain
 * non-negative decimal is zero.
 */
export function cents(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return 0;
  return Math.round(Number(`${text}e2`));
}

const count = (value) => {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Amazon dates arrive as YYYYMMDD; YYYY-MM-DD is accepted too. Anything else is null. */
export function reportDate(value) {
  const text = String(value ?? "").trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

/** What BookPilot calls a campaign: the publisher and Amazon's id, since no name comes back. */
export function campaignLabel(entry) {
  const publisher = String(entry?.publisher ?? "").trim();
  const id = String(entry?.campaignId ?? "").trim();
  const label = publisher && id ? `${publisher} · ${id}` : id ? `Amazon campaign ${id}` : publisher || UNNAMED;
  return label.slice(0, 200);
}

/**
 * Turn report entries into one row per campaign per day, adding up the ad
 * groups within a campaign. Says what it left out. Throws when entries came
 * back but none carried any of the metrics asked for, because storing that as
 * zeros would look like a real "no results".
 *
 * @returns {{ rows: object[], dropped: number }}
 */
export function rowsFromReport(entries) {
  const byKey = new Map();
  const seen = new Set();
  let dropped = 0;

  for (const entry of entries) {
    const date = reportDate(entry?.date);
    if (!entry || typeof entry !== "object" || !date) { dropped += 1; continue; }

    const fields = new Map(Object.keys(entry).map((k) => [norm(k), entry[k]]));
    const campaign = campaignLabel(entry);
    const key = `${campaign} ${date}`;
    const row = byKey.get(key) || {
      campaign, date, clicks: 0, detail_page_views: 0, add_to_carts: 0, purchases: 0, units_sold: 0, product_sales_cents: 0,
    };
    for (const m of METRICS) {
      const field = norm(m.name);
      if (!fields.has(field)) continue;
      seen.add(m.key);
      row[m.key] += m.money ? cents(fields.get(field)) : count(fields.get(field));
    }
    byKey.set(key, row);
  }

  if (entries.length && !seen.size) {
    console.error("[bookpilot] Amazon report had none of the requested metrics; keys:", Object.keys(entries[0] || {}).join(","));
    throw Errors.amazonAction();
  }
  if (entries.length && !byKey.size) {
    console.error("[bookpilot] Amazon report had no usable dates; first date:", String(entries[0]?.date));
    throw Errors.amazonAction();
  }
  return { rows: [...byKey.values()], dropped };
}
