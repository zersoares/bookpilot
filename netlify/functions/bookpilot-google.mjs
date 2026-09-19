// BookPilot AI — Google Ads integration (reads only).
//
//   /api/bp-google/*
//
// Connect a Google Ads login, choose which account, and pull campaign-by-day
// figures into the same table the CSV import fills. It never creates,
// changes, pauses or launches anything in Google Ads.
//
// Google offers no read-only permission for this API, only one that also
// allows changes, so the guarantee here is in the code (a test checks that no
// mutate endpoint is ever called) and the screen says so plainly. When
// GOOGLE_ADS_CLIENT_ID / _CLIENT_SECRET / _DEVELOPER_TOKEN / _REDIRECT_URI
// are not configured, every route answers 501 "not set up on this
// deployment" and the UI keeps the CSV import as the way in.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as google from "./bookpilot-lib/google-ads.js";
import { planCampaigns } from "./bookpilot-lib/sync-plan.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { backToApp } from "./bookpilot-lib/oauth-return.js";

const PREFIX = "/api/bp-google";

/**
 * The stored connection, with a fresh access token. Read with the service
 * role: the client has no grant on the integrations table by design. Google
 * access tokens last an hour, so this refreshes a little before expiry.
 */
async function connection(userId) {
  const service = dbAsService();
  const row = await service.selectOne("integrations", { eq: { user_id: userId, provider: "google" } });
  if (!row || row.status !== "connected" || !row.access_token) throw Errors.integrationMissing("Google Ads");

  const expiring = !row.expires_at || Date.parse(row.expires_at) - Date.now() < 5 * 60_000;
  if (!expiring) return row;
  if (!row.refresh_token) {
    await service.update("integrations", { status: "expired", access_token: null }, { eq: { id: row.id } });
    throw Errors.integrationMissing("Google Ads");
  }
  try {
    const fresh = await google.refreshTokens(row.refresh_token);
    const patch = {
      access_token: fresh.accessToken,
      // Google does not rotate refresh tokens; keep the one we have.
      refresh_token: fresh.refreshToken || row.refresh_token,
      expires_at: fresh.expiresIn ? new Date(Date.now() + fresh.expiresIn * 1000).toISOString() : null,
      last_error: null,
    };
    await service.update("integrations", patch, { eq: { id: row.id } });
    return { ...row, ...patch };
  } catch (err) {
    await service.update(
      "integrations",
      { status: "expired", access_token: null, last_error: "Google access expired or was removed. Reconnect to continue." },
      { eq: { id: row.id } }
    );
    throw err;
  }
}

async function authorizeUrl(ctx) {
  if (!google.configured()) throw Errors.notConfigured("The Google Ads integration");
  return json({ url: google.authorizeUrl(await google.signState(ctx.user.id)) });
}

/**
 * Google redirects the browser here. No bearer token is present, so the
 * caller's identity comes from the HMAC-signed `state` issued a moment ago.
 */
async function callback(req) {
  const url = new URL(req.url);

  if (url.searchParams.get("error")) {
    console.warn("[bookpilot] Google OAuth declined:", url.searchParams.get("error"));
    return backToApp("google", "declined");
  }
  const userId = await google.verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!userId || !code) return backToApp("google", "failed");

  try {
    const tokens = await google.exchangeCode(code);
    const accounts = await google.listAdAccounts(tokens.accessToken);
    // With one account there is nothing to ask; with several the author
    // chooses, and nothing syncs until they have.
    const only = accounts.length === 1 ? accounts[0] : null;

    await dbAsService().upsert(
      "integrations",
      {
        user_id: userId,
        provider: "google",
        status: "connected",
        scopes: [google.SCOPE],
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
        account_id: only?.id || null,
        account_name: only?.name || null,
        last_error: null,
      },
      { onConflict: "user_id,provider", returning: false }
    );
    await audit.record(userId, "integration.connected", { entity: "google" });
    return backToApp("google", "connected");
  } catch (err) {
    console.error("[bookpilot] Google callback failed:", err);
    return backToApp("google", "failed");
  }
}

async function listAccounts(ctx) {
  const row = await connection(ctx.user.id);
  return json({ accounts: await google.listAdAccounts(row.access_token), selected: row.account_id });
}

async function selectAccount(ctx, body) {
  const row = await connection(ctx.user.id);
  const accountId = v.str(body.account_id, "Ad account", { max: 20, required: true });
  if (!/^\d+$/.test(accountId)) throw Errors.invalid("That doesn't look like a Google Ads account id.");
  // Only an account this login can actually read may be chosen.
  const chosen = (await google.listAdAccounts(row.access_token)).find((a) => a.id === accountId);
  if (!chosen) throw Errors.invalid("That account isn't available to your Google login.");
  await dbAsService().update(
    "integrations",
    { account_id: chosen.id, account_name: chosen.name },
    { eq: { user_id: ctx.user.id, provider: "google" } }
  );
  return json({ ok: true });
}

/**
 * Pull the last N days of campaign figures.
 *
 * Every Google Ads campaign in the report becomes (or is matched to) a
 * BookPilot campaign marked external_only, so no screen ever offers to
 * launch or pause it. Nothing is written to Google Ads.
 */
async function sync(ctx, body) {
  const row = await connection(ctx.user.id);
  if (!row.account_id) throw Errors.invalid("Choose a Google Ads account first.");

  const range = google.dateRange(v.int(body.days ?? 30, "Days", { min: 1, max: google.MAX_DAYS }));

  const account = (await google.listAdAccounts(row.access_token)).find((a) => a.id === row.account_id);
  if (!account) throw Errors.invalid("That account isn't available to your Google login any more. Choose another.");
  // An account with no stated currency cannot be summed with anything, so
  // this stops rather than assuming one.
  if (!account.currency) throw Errors.invalid("Google didn't say which currency that account uses, so its figures can't be imported safely.");
  const currency = v.currency(account.currency);

  const { base, purchases } = await google.report(row.access_token, account.id, range);

  const remote = google.campaignsFromReport(base);
  const local = await ctx.db.select("campaigns", {
    select: "id,name,currency,external_campaign_id",
    eq: { user_id: ctx.user.id, platform: "google", external_only: true },
    limit: 500,
  });
  const plan = planCampaigns(remote, local);

  // A campaign in another currency would make the figures wrong, so it is
  // left alone and reported, not converted.
  const skipped = [];
  const usable = plan.filter((p) => {
    if (p.local && p.local.currency !== currency) {
      skipped.push({ name: p.remote.name, reason: `Your BookPilot campaign is in ${p.local.currency}, this account is in ${currency}.` });
      return false;
    }
    return true;
  });

  const needsBook = usable.some((p) => p.action === "create");
  let bookId = null;
  if (needsBook) {
    bookId = v.uuid(body.book_id, "Book");
    const book = await ctx.db.selectOne("books", { select: "id", eq: { id: bookId } });
    if (!book) throw Errors.invalid("Choose the book these campaigns belong to.");
  }

  // `external_campaign_id` is written with the service role only, after
  // Google has named the campaign, like the other connections.
  const service = dbAsService();
  const idMap = new Map();
  let created = 0;
  let linked = 0;
  for (const p of usable) {
    // Google states the campaign's status, so unlike TikTok it is read, not inferred.
    const status = google.statusFor(p.remote.status);
    if (p.action === "create") {
      const made = await service.insert("campaigns", {
        user_id: ctx.user.id, book_id: bookId, name: p.remote.name.slice(0, 200), platform: "google",
        objective: "conversions", daily_budget_cents: 0, currency, status,
        external_only: true, external_campaign_id: p.remote.id,
      });
      idMap.set(p.remote.id, made.id);
      created += 1;
    } else {
      await service.update(
        "campaigns",
        { status, ...(p.action === "link" ? { external_campaign_id: p.remote.id } : {}) },
        { eq: { id: p.local.id, user_id: ctx.user.id } }
      );
      idMap.set(p.remote.id, p.local.id);
      if (p.action === "link") linked += 1;
    }
  }

  const rows = google.toPerformanceRows(base, purchases, idMap);
  for (let i = 0; i < rows.length; i += 500) {
    await service.upsert("performance_metrics", rows.slice(i, i + 500), {
      onConflict: "campaign_id,ad_id,metric_date,source", returning: false,
    });
  }

  await service.update(
    "integrations", { last_synced_at: new Date().toISOString(), last_error: null },
    { eq: { user_id: ctx.user.id, provider: "google" } }
  );
  await audit.record(ctx.user.id, "google.synced", {
    entity: "google", detail: { campaigns: idMap.size, created, linked, rows: rows.length, since: range.since, until: range.until },
  });
  return json({ campaigns: idMap.size, created, linked, days: rows.length, since: range.since, until: range.until, currency, skipped });
}

/**
 * Forget the connection and revoke it at Google, which supports revoking an
 * ordinary user's token. If the revoke cannot complete (the token may
 * already be dead) BookPilot's copy is cleared regardless.
 */
async function disconnect(ctx) {
  const service = dbAsService();
  const row = await service.selectOne("integrations", { eq: { user_id: ctx.user.id, provider: "google" } });
  let revoked = false;
  const token = row?.refresh_token || row?.access_token;
  if (token) {
    try {
      await google.revokeToken(token);
      revoked = true;
    } catch (err) {
      console.warn("[bookpilot] Google token revoke did not complete:", err?.code || err?.message);
    }
  }
  await service.update(
    "integrations",
    { status: "disconnected", access_token: null, refresh_token: null, expires_at: null, account_id: null, account_name: null },
    { eq: { user_id: ctx.user.id, provider: "google" } }
  );
  await audit.record(ctx.user.id, "integration.disconnected", { entity: "google", detail: { revoked } });
  return json({ disconnected: true, revoked });
}

// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);

  // The OAuth callback arrives from Google without a session.
  if (action === "callback" && req.method === "GET") return callback(req);

  const ctx = await authenticate(req);
  memoryLimit(`google:${ctx.user.id}`, 60, 60_000);

  if (req.method === "GET" && action === "authorize-url") return authorizeUrl(ctx);
  if (req.method === "GET" && action === "accounts") return listAccounts(ctx);

  if (req.method === "POST") {
    const body = await readJson(req);
    if (action === "select-account") return selectAccount(ctx, body);
    if (action === "sync") return sync(ctx, body);
    if (action === "disconnect") return disconnect(ctx);
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-google/*" };
