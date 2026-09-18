// BookPilot AI — Pinterest integration (read-only).
//
//   /api/bp-pinterest/*
//
// Connect an ad account with one read-only scope (ads:read), choose which
// account, and pull campaign-by-day figures into the same table the CSV
// import fills. It never creates, changes, pauses or launches anything on
// Pinterest. When PINTEREST_APP_ID / PINTEREST_APP_SECRET /
// PINTEREST_REDIRECT_URI are not configured, every route answers 501 "not
// set up on this deployment" and the UI keeps the CSV import as the way in.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as pinterest from "./bookpilot-lib/pinterest.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { backToApp } from "./bookpilot-lib/oauth-return.js";

const PREFIX = "/api/bp-pinterest";

/**
 * The stored connection, with a fresh access token. Read with the service
 * role: the client has no grant on the integrations table by design.
 */
async function connection(userId) {
  const service = dbAsService();
  const row = await service.selectOne("integrations", { eq: { user_id: userId, provider: "pinterest" } });
  if (!row || row.status !== "connected" || !row.access_token) throw Errors.integrationMissing("Pinterest");

  // Refresh a little before expiry, so a sync does not die halfway.
  const expiring = row.expires_at && Date.parse(row.expires_at) - Date.now() < 5 * 60_000;
  if (!expiring) return row;
  if (!row.refresh_token) {
    await service.update("integrations", { status: "expired", access_token: null }, { eq: { id: row.id } });
    throw Errors.integrationMissing("Pinterest");
  }
  try {
    const fresh = await pinterest.refreshTokens(row.refresh_token);
    const patch = {
      access_token: fresh.accessToken,
      refresh_token: fresh.refreshToken || row.refresh_token,
      expires_at: fresh.expiresIn ? new Date(Date.now() + fresh.expiresIn * 1000).toISOString() : null,
      last_error: null,
    };
    await service.update("integrations", patch, { eq: { id: row.id } });
    return { ...row, ...patch };
  } catch (err) {
    await service.update("integrations", { status: "expired", last_error: "Pinterest access expired. Reconnect to continue." }, { eq: { id: row.id } });
    throw err;
  }
}

async function authorizeUrl(ctx) {
  if (!pinterest.configured()) throw Errors.notConfigured("The Pinterest integration");
  return json({ url: pinterest.authorizeUrl(await pinterest.signState(ctx.user.id)) });
}

/**
 * Pinterest redirects the browser here. No bearer token is present, so the
 * caller's identity comes from the HMAC-signed `state` issued a moment ago.
 */
async function callback(req) {
  const url = new URL(req.url);

  if (url.searchParams.get("error")) {
    console.warn("[bookpilot] Pinterest OAuth declined:", url.searchParams.get("error"));
    return backToApp("pinterest", "declined");
  }
  const userId = await pinterest.verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!userId || !code) return backToApp("pinterest", "failed");

  try {
    const tokens = await pinterest.exchangeCode(code);
    const accounts = await pinterest.listAdAccounts(tokens.accessToken);
    // With one ad account there is nothing to ask; with several the author
    // chooses, and nothing syncs until they have.
    const only = accounts.length === 1 ? accounts[0] : null;

    await dbAsService().upsert(
      "integrations",
      {
        user_id: userId,
        provider: "pinterest",
        status: "connected",
        scopes: pinterest.SCOPES,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
        account_id: only?.id || null,
        account_name: only?.name || null,
        last_error: null,
      },
      { onConflict: "user_id,provider", returning: false }
    );
    await audit.record(userId, "integration.connected", { entity: "pinterest" });
    return backToApp("pinterest", "connected");
  } catch (err) {
    console.error("[bookpilot] Pinterest callback failed:", err);
    return backToApp("pinterest", "failed");
  }
}

async function listAccounts(ctx) {
  const row = await connection(ctx.user.id);
  return json({ accounts: await pinterest.listAdAccounts(row.access_token), selected: row.account_id });
}

async function selectAccount(ctx, body) {
  const row = await connection(ctx.user.id);
  const accountId = v.str(body.account_id, "Ad account", { max: 40, required: true });
  if (!/^\d+$/.test(accountId)) throw Errors.invalid("That doesn't look like a Pinterest ad account id.");
  // Only an account this token can actually see may be chosen.
  const accounts = await pinterest.listAdAccounts(row.access_token);
  const chosen = accounts.find((a) => a.id === accountId);
  if (!chosen) throw Errors.invalid("That ad account isn't available to your Pinterest login.");
  await dbAsService().update(
    "integrations",
    { account_id: chosen.id, account_name: chosen.name },
    { eq: { user_id: ctx.user.id, provider: "pinterest" } }
  );
  return json({ ok: true });
}

/**
 * Pull the last N days of campaign figures.
 *
 * Every Pinterest campaign becomes (or is matched to) a BookPilot campaign
 * marked external_only, so no screen ever offers to launch or pause it.
 * Nothing is written to Pinterest.
 */
async function sync(ctx, body) {
  const row = await connection(ctx.user.id);
  if (!row.account_id) throw Errors.invalid("Choose a Pinterest ad account first.");

  const { since, until, days } = pinterest.dateRange(v.int(body.days ?? 30, "Days", { min: 1, max: pinterest.MAX_DAYS }));

  const accounts = await pinterest.listAdAccounts(row.access_token);
  const account = accounts.find((a) => a.id === row.account_id);
  if (!account) throw Errors.invalid("That ad account isn't available to your Pinterest login any more. Choose another.");
  // An ad account with no stated currency cannot be summed with anything, so
  // this stops rather than assuming one.
  if (!account.currency) throw Errors.invalid("Pinterest didn't say which currency that ad account uses, so its figures can't be imported safely.");
  const currency = v.currency(account.currency);

  const remote = await pinterest.listCampaigns(row.access_token, account.id);
  const local = await ctx.db.select("campaigns", {
    select: "id,name,currency,external_campaign_id",
    eq: { user_id: ctx.user.id, platform: "pinterest", external_only: true },
    limit: 500,
  });
  const plan = pinterest.planCampaigns(remote, local);

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

  // `external_campaign_id` is written with the service role only, after
  // Pinterest has named the campaign, like the Meta connection.
  const service = dbAsService();
  const idMap = new Map();
  let created = 0;
  let linked = 0;
  for (const p of usable) {
    const status = pinterest.statusFor(p.remote.status);
    if (p.action === "create") {
      const made = await service.insert("campaigns", {
        user_id: ctx.user.id, book_id: bookId, name: p.remote.name.slice(0, 200), platform: "pinterest",
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

  const items = idMap.size
    ? await pinterest.campaignAnalytics(row.access_token, account.id, [...idMap.keys()], { since, until })
    : [];
  const rows = pinterest.toPerformanceRows(items, idMap);
  for (let i = 0; i < rows.length; i += 500) {
    await service.upsert("performance_metrics", rows.slice(i, i + 500), {
      onConflict: "campaign_id,ad_id,metric_date,source", returning: false,
    });
  }

  await service.update(
    "integrations", { last_synced_at: new Date().toISOString(), last_error: null },
    { eq: { user_id: ctx.user.id, provider: "pinterest" } }
  );
  await audit.record(ctx.user.id, "pinterest.synced", {
    entity: "pinterest", detail: { campaigns: idMap.size, created, linked, rows: rows.length, since, until },
  });
  return json({ campaigns: idMap.size, created, linked, days: rows.length, since, until, currency, skipped });
}

/**
 * Forget the connection. Pinterest only supports revoking tokens issued to
 * system users, so this clears BookPilot's copy and the author removes
 * BookPilot's access in their Pinterest settings if they want it gone there.
 */
async function disconnect(ctx) {
  await dbAsService().update(
    "integrations",
    { status: "disconnected", access_token: null, refresh_token: null, expires_at: null, account_id: null, account_name: null },
    { eq: { user_id: ctx.user.id, provider: "pinterest" } }
  );
  await audit.record(ctx.user.id, "integration.disconnected", { entity: "pinterest" });
  return json({ disconnected: true });
}

// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);

  // The OAuth callback arrives from Pinterest without a session.
  if (action === "callback" && req.method === "GET") return callback(req);

  const ctx = await authenticate(req);
  memoryLimit(`pinterest:${ctx.user.id}`, 60, 60_000);

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

export const config = { path: "/api/bp-pinterest/*" };
