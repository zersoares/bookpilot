// Meta Marketing API client (spec §16).
//
// This is the real integration, not a stub: OAuth code exchange,
// campaign/ad-set/ad creation and insights reads all call Meta's Graph
// API. What it will *not* do is pretend. When META_APP_ID and
// META_APP_SECRET are absent, `configured()` returns false, the API
// reports the capability as unavailable, and the UI shows "Connect
// integration" — no simulated campaign is ever presented as a real one.
//
// Passwords are never involved: Meta returns a token to the callback,
// and that token is stored in the integrations table, which
// `authenticated` has no grant on (see 002_rls.sql).

import { env } from "./env.js";
import { Errors } from "./errors.js";

// Bumped from v21.0 (which Meta retires on 2027-01-21) to v25.0, supported
// until 2028-07-29. v22–v25 were checked against Meta's changelog for the
// calls made here; the one that bites is v24's mandatory
// is_adset_budget_sharing_enabled on ad-set budgets (see createAdSet).
// v26.0 was not adopted: its changelog could not be read.
const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const REQUIRED_SCOPES = ["ads_management", "ads_read", "business_management"];

export function configured() {
  return Boolean(env.metaAppId && env.metaAppSecret && env.metaRedirectUri);
}

// --- OAuth state signing ---------------------------------------------
// The `state` parameter carries the user id through the redirect. It is
// HMAC-signed so a third party cannot craft a callback that attaches
// their ad account to someone else's BookPilot account.

async function hmac(value) {
  const secret = env.oauthStateSecret || env.metaAppSecret;
  if (!secret) throw Errors.notConfigured("The Meta integration");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(state, maxAgeMs = 15 * 60_000) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedAt, signature] = parts;
  const expected = await hmac(`${userId}.${issuedAt}`);
  // Constant-time-ish comparison: lengths are fixed hex digests.
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < signature.length; i += 1) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;
  if (Date.now() - Number(issuedAt) > maxAgeMs) return null;
  return userId;
}

export function authorizeUrl(state) {
  if (!configured()) throw Errors.notConfigured("The Meta integration");
  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: env.metaRedirectUri,
    state,
    scope: REQUIRED_SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
}

async function graph(path, { method = "GET", token, params = {}, body } = {}) {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("[bookpilot] Meta unreachable:", err);
    throw Errors.metaConnect();
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }

  if (!res.ok || parsed?.error) {
    // "OAuthException 190" belongs in the log, not in front of an author.
    console.error(
      `[bookpilot] Meta ${method} ${path} -> ${res.status}:`,
      parsed?.error ? JSON.stringify(parsed.error) : text.slice(0, 300)
    );
    const code = parsed?.error?.code;
    if (code === 190 || res.status === 401) throw Errors.metaConnect();
    throw Errors.metaAction();
  }
  return parsed;
}

export async function exchangeCode(code) {
  if (!configured()) throw Errors.notConfigured("The Meta integration");
  const short = await graph("/oauth/access_token", {
    params: {
      client_id: env.metaAppId,
      client_secret: env.metaAppSecret,
      redirect_uri: env.metaRedirectUri,
      code,
    },
  });
  // Short-lived tokens expire in about an hour; swap immediately for the
  // ~60-day long-lived one so a campaign sync doesn't die overnight.
  const long = await graph("/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: env.metaAppId,
      client_secret: env.metaAppSecret,
      fb_exchange_token: short.access_token,
    },
  });
  return {
    accessToken: long.access_token || short.access_token,
    expiresIn: long.expires_in || short.expires_in || null,
  };
}

export async function listAdAccounts(token) {
  const res = await graph("/me/adaccounts", {
    token,
    params: { fields: "id,account_id,name,currency,account_status" },
  });
  return (res?.data || []).map((a) => ({
    id: a.id,
    accountId: a.account_id,
    name: a.name,
    currency: a.currency,
    active: a.account_status === 1,
  }));
}

// --- Campaign creation ------------------------------------------------
//
// Everything is created PAUSED. BookPilot never starts spending an
// author's money as a side effect of a click that said "create"; the
// launch step is separate and explicit (spec §21).

const OBJECTIVES = {
  conversions: "OUTCOME_SALES",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
  engagement: "OUTCOME_ENGAGEMENT",
};

export async function createCampaign(token, adAccountId, { name, objective = "conversions" }) {
  const res = await graph(`/${adAccountId}/campaigns`, {
    method: "POST",
    token,
    params: {
      name,
      objective: OBJECTIVES[objective] || OBJECTIVES.traffic,
      status: "PAUSED",
      special_ad_categories: [],
    },
  });
  return res.id;
}

export async function createAdSet(token, adAccountId, {
  name, campaignId, dailyBudgetCents, targeting, startTime, endTime, destinationUrl,
}) {
  const res = await graph(`/${adAccountId}/adsets`, {
    method: "POST",
    token,
    params: {
      name,
      campaign_id: campaignId,
      daily_budget: String(dailyBudgetCents),
      // Required with an ad-set budget from v24. False keeps each ad
      // set to exactly the budget the author set; Meta's default of
      // sharing budget between ad sets would move their money around.
      is_adset_budget_sharing_enabled: false,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
      ...(startTime ? { start_time: startTime } : {}),
      ...(endTime ? { end_time: endTime } : {}),
      ...(destinationUrl ? { destination_type: "WEBSITE" } : {}),
    },
  });
  return res.id;
}

export async function createAd(token, adAccountId, {
  name, adSetId, pageId, message, headline, description, linkUrl, imageHash,
}) {
  const creative = await graph(`/${adAccountId}/adcreatives`, {
    method: "POST",
    token,
    params: {
      name: `${name} — creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message,
          name: headline,
          description,
          link: linkUrl,
          ...(imageHash ? { image_hash: imageHash } : {}),
          call_to_action: { type: "LEARN_MORE", value: { link: linkUrl } },
        },
      },
    },
  });

  const ad = await graph(`/${adAccountId}/ads`, {
    method: "POST",
    token,
    params: { name, adset_id: adSetId, creative: { creative_id: creative.id }, status: "PAUSED" },
  });
  return { adId: ad.id, creativeId: creative.id };
}

export async function setCampaignStatus(token, campaignId, status) {
  await graph(`/${campaignId}`, {
    method: "POST",
    token,
    params: { status: status === "active" ? "ACTIVE" : "PAUSED" },
  });
  return true;
}

/**
 * Daily insights for one campaign, broken down per ad. Returned in the
 * shape performance_metrics expects; money is converted to integer cents.
 */
export async function campaignInsights(token, campaignId, { since, until }) {
  const res = await graph(`/${campaignId}/insights`, {
    token,
    params: {
      level: "ad",
      time_increment: 1,
      time_range: { since, until },
      fields: "ad_id,date_start,impressions,reach,clicks,spend,actions,action_values",
      limit: 500,
    },
  });

  return (res?.data || []).map((row) => {
    const purchases = (row.actions || []).find(
      (a) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase"
    );
    const value = (row.action_values || []).find(
      (a) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase"
    );
    const toCents = (amount) => Math.round(Number(amount || 0) * 100);
    return {
      external_ad_id: row.ad_id,
      metric_date: row.date_start,
      impressions: Number(row.impressions || 0),
      reach: Number(row.reach || 0),
      clicks: Number(row.clicks || 0),
      spend_cents: toCents(row.spend),
      conversions: Number(purchases?.value || 0),
      revenue_cents: toCents(value?.value),
    };
  });
}

/**
 * Translate a BookPilot persona into Meta targeting.
 *
 * Only age and broad interests cross over. Nothing derived from a
 * protected characteristic is ever sent, and detailed interest terms are
 * passed as free text for the operator to map to Meta's interest IDs
 * rather than guessed at here — a wrong ID spends money on the wrong
 * audience silently.
 */
export function personaToTargeting(persona, countries = ["DE"]) {
  const [min, max] = String(persona?.age_range || "25-65")
    .split(/[-–]/)
    .map((n) => parseInt(n, 10));
  return {
    geo_locations: { countries: countries.length ? countries : ["DE"] },
    age_min: Number.isFinite(min) ? Math.max(18, Math.min(65, min)) : 25,
    age_max: Number.isFinite(max) ? Math.max(18, Math.min(65, max)) : 65,
    targeting_automation: { advantage_audience: 1 },
    // Interests are carried as a note on the ad set for the operator to
    // confirm in Ads Manager; see docs/meta-targeting in the README.
    flexible_spec: [],
  };
}
