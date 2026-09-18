// BookPilot AI — TikTok integration (read-only).
//
//   /api/bp-tiktok/*
//
// Connect an advertiser account, choose which one, and pull campaign-by-day
// figures into the same table the CSV import fills. It never creates,
// changes, pauses or launches anything on TikTok. When TIKTOK_APP_ID /
// TIKTOK_APP_SECRET / TIKTOK_AUTH_URL are not configured, every route
// answers 501 "not set up on this deployment" and the UI keeps the CSV
// import as the way in.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as tiktok from "./bookpilot-lib/tiktok.js";
import { planCampaigns } from "./bookpilot-lib/sync-plan.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { backToApp } from "./bookpilot-lib/oauth-return.js";

const PREFIX = "/api/bp-tiktok";

/**
 * The stored connection. Read with the service role: the client has no grant
 * on the integrations table by design. TikTok's token is long-term, so there
 * is nothing to refresh; it either works or the advertiser has removed
 * access.
 */
async function connection(userId) {
  const row = await dbAsService().selectOne("integrations", { eq: { user_id: userId, provider: "tiktok" } });
  if (!row || row.status !== "connected" || !row.access_token) throw Errors.integrationMissing("TikTok");
  return row;
}

/** Note that TikTok no longer honours the token, so the screen says "reconnect". */
async function markExpired(row) {
  await dbAsService().update(
    "integrations",
    { status: "expired", access_token: null, last_error: "TikTok access was removed or has expired. Reconnect to continue." },
    { eq: { id: row.id } }
  );
}

async function authorizeUrl(ctx) {
  if (!tiktok.configured()) throw Errors.notConfigured("The TikTok integration");
  return json({ url: tiktok.authorizeUrl(await tiktok.signState(ctx.user.id)) });
}

/**
 * TikTok redirects the browser here with `auth_code` and our `state`. No
 * bearer token is present, so the caller's identity comes from the
 * HMAC-signed state issued a moment ago.
 */
async function callback(req) {
  const url = new URL(req.url);
  const userId = await tiktok.verifyState(url.searchParams.get("state"));
  const authCode = url.searchParams.get("auth_code");
  if (!userId || !authCode) return backToApp("tiktok", "failed");

  try {
    const tokens = await tiktok.exchangeCode(authCode);
    const accounts = await tiktok.listAdAccounts(tokens.accessToken);
    // With one advertiser there is nothing to ask; with several the author
    // chooses, and nothing syncs until they have.
    const only = accounts.length === 1 ? accounts[0] : null;

    await dbAsService().upsert(
      "integrations",
      {
        user_id: userId,
        provider: "tiktok",
        status: "connected",
        scopes: tokens.scope.map(String),
        access_token: tokens.accessToken,
        refresh_token: null,
        expires_at: null, // a long-term token does not expire
        account_id: only?.id || null,
        account_name: only?.name || null,
        last_error: null,
      },
      { onConflict: "user_id,provider", returning: false }
    );
    await audit.record(userId, "integration.connected", { entity: "tiktok" });
    return backToApp("tiktok", "connected");
  } catch (err) {
    console.error("[bookpilot] TikTok callback failed:", err);
    return backToApp("tiktok", "failed");
  }
}

async function listAccounts(ctx) {
  const row = await connection(ctx.user.id);
  try {
    return json({ accounts: await tiktok.listAdAccounts(row.access_token), selected: row.account_id });
  } catch (err) {
    if (err.code === "tiktok_connection_failed") await markExpired(row);
    throw err;
  }
}

async function selectAccount(ctx, body) {
  const row = await connection(ctx.user.id);
  const accountId = v.str(body.account_id, "Ad account", { max: 40, required: true });
  if (!/^\d+$/.test(accountId)) throw Errors.invalid("That doesn't look like a TikTok ad account id.");
  // Only an account this token can actually see may be chosen.
  const chosen = (await tiktok.listAdAccounts(row.access_token)).find((a) => a.id === accountId);
  if (!chosen) throw Errors.invalid("That ad account isn't available to your TikTok login.");
  await dbAsService().update(
    "integrations",
    { account_id: chosen.id, account_name: chosen.name },
    { eq: { user_id: ctx.user.id, provider: "tiktok" } }
  );
  return json({ ok: true });
}

/**
 * Pull the last N days of campaign figures.
 *
 * Every TikTok campaign in the report becomes (or is matched to) a BookPilot
 * campaign marked external_only, so no screen ever offers to launch or pause
 * it. Nothing is written to TikTok.
 */
async function sync(ctx, body) {
  const row = await connection(ctx.user.id);
  if (!row.account_id) throw Errors.invalid("Choose a TikTok ad account first.");

  const range = tiktok.dateWindows(v.int(body.days ?? 30, "Days", { min: 1, max: tiktok.MAX_DAYS }));

  let list;
  let account;
  try {
    account = (await tiktok.listAdAccounts(row.access_token)).find((a) => a.id === row.account_id);
    if (!account) throw Errors.invalid("That ad account isn't available to your TikTok login any more. Choose another.");
    // An ad account with no stated currency cannot be summed with anything,
    // so this stops rather than assuming one.
    if (!account.currency) {
      throw Errors.invalid("TikTok didn't say which currency that ad account uses (the Ad Account Information permission may be missing), so its figures can't be imported safely.");
    }
    list = await tiktok.reportRows(row.access_token, account.id, range.windows);
  } catch (err) {
    if (err.code === "tiktok_connection_failed") await markExpired(row);
    throw err;
  }
  const currency = v.currency(account.currency);

  const remote = tiktok.campaignsFromReport(list);
  const local = await ctx.db.select("campaigns", {
    select: "id,name,currency,external_campaign_id",
    eq: { user_id: ctx.user.id, platform: "tiktok", external_only: true },
    limit: 500,
  });
  const plan = planCampaigns(remote, local);

  // A campaign in another currency would make the figures wrong, so it is
  // left alone and reported, not converted.
  const skipped = [];
  const usable = plan.filter((p) => {
    if (p.local && p.local.currency !== currency) {
      skipped.push({ name: p.remote.name, reason: `Your BookPilot campaign is in ${p.local.currency}, this ad account is in ${currency}.` });
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

  const idMap = new Map();
  for (const p of usable) idMap.set(p.remote.id, p.local?.id || null);

  // `external_campaign_id` is written with the service role only, after
  // TikTok has named the campaign, like the Meta and Pinterest connections.
  const service = dbAsService();
  const draft = tiktok.toPerformanceRows(list, new Map(usable.map((p) => [p.remote.id, p.remote.id])));
  const byRemote = new Map();
  for (const r of draft) {
    if (!byRemote.has(r.campaign_id)) byRemote.set(r.campaign_id, []);
    byRemote.get(r.campaign_id).push(r);
  }

  let created = 0;
  let linked = 0;
  for (const p of usable) {
    const status = tiktok.statusFromSpend(byRemote.get(p.remote.id) || [], range.until);
    if (p.action === "create") {
      const made = await service.insert("campaigns", {
        user_id: ctx.user.id, book_id: bookId, name: p.remote.name.slice(0, 200), platform: "tiktok",
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
      if (p.action === "link") linked += 1;
    }
  }

  const rows = tiktok.toPerformanceRows(list, idMap);
  for (let i = 0; i < rows.length; i += 500) {
    await service.upsert("performance_metrics", rows.slice(i, i + 500), {
      onConflict: "campaign_id,ad_id,metric_date,source", returning: false,
    });
  }

  await service.update(
    "integrations", { last_synced_at: new Date().toISOString(), last_error: null },
    { eq: { user_id: ctx.user.id, provider: "tiktok" } }
  );
  await audit.record(ctx.user.id, "tiktok.synced", {
    entity: "tiktok", detail: { campaigns: idMap.size, created, linked, rows: rows.length, since: range.since, until: range.until },
  });
  return json({ campaigns: idMap.size, created, linked, days: rows.length, since: range.since, until: range.until, currency, skipped });
}

/**
 * Forget the connection and, unlike Pinterest, actually revoke it: TikTok
 * lets an app invalidate its own long-term token. If the revoke call fails
 * (the token may already be dead), BookPilot's copy is cleared regardless.
 */
async function disconnect(ctx) {
  const service = dbAsService();
  const row = await service.selectOne("integrations", { eq: { user_id: ctx.user.id, provider: "tiktok" } });
  let revoked = false;
  if (row?.access_token && tiktok.configured()) {
    try {
      await tiktok.revokeToken(row.access_token);
      revoked = true;
    } catch (err) {
      console.warn("[bookpilot] TikTok token revoke did not complete:", err?.code || err?.message);
    }
  }
  await service.update(
    "integrations",
    { status: "disconnected", access_token: null, refresh_token: null, expires_at: null, account_id: null, account_name: null },
    { eq: { user_id: ctx.user.id, provider: "tiktok" } }
  );
  await audit.record(ctx.user.id, "integration.disconnected", { entity: "tiktok", detail: { revoked } });
  return json({ disconnected: true, revoked });
}

// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);

  // The OAuth callback arrives from TikTok without a session.
  if (action === "callback" && req.method === "GET") return callback(req);

  const ctx = await authenticate(req);
  memoryLimit(`tiktok:${ctx.user.id}`, 60, 60_000);

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

export const config = { path: "/api/bp-tiktok/*" };
