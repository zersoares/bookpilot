// BookPilot AI — Amazon Attribution integration (reads only).
//
//   /api/bp-amazon/*
//
// Connect an Amazon Ads login, choose which account, and pull Amazon
// Attribution figures (clicks, detail-page views, add-to-carts, purchases,
// units and sales, by campaign and day) into the same table the CSV import
// fills. It never creates or changes anything at Amazon.
//
// Amazon offers no read-only permission for its Ads API, only one that also
// allows changes, so the guarantee here is in the code (a test checks that
// only reads are ever made) and the screen says so plainly. When
// AMAZON_ADS_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI are not configured,
// every route answers 501 "not set up on this deployment" and the UI keeps
// the CSV import as the way in.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as amazonAds from "./bookpilot-lib/amazon-ads.js";
import * as amazon from "./bookpilot-lib/amazon.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { backToApp } from "./bookpilot-lib/oauth-return.js";

const PREFIX = "/api/bp-amazon";
const PROVIDER = "amazon_attribution";
const TABLE = "amazon_attribution_metrics";

/**
 * The stored connection, with a fresh access token. Read with the service
 * role: the client has no grant on the integrations table by design. Amazon
 * access tokens last an hour, so this refreshes a little before expiry.
 */
async function connection(userId) {
  const service = dbAsService();
  const row = await service.selectOne("integrations", { eq: { user_id: userId, provider: PROVIDER } });
  if (!row || row.status !== "connected" || !row.access_token) throw Errors.integrationMissing("Amazon Ads");
  const region = amazonAds.isRegion(row.region) ? row.region : "na";

  const expiring = !row.expires_at || Date.parse(row.expires_at) - Date.now() < 5 * 60_000;
  if (!expiring) return { ...row, region };
  if (!row.refresh_token) {
    await service.update("integrations", { status: "expired", access_token: null }, { eq: { id: row.id } });
    throw Errors.integrationMissing("Amazon Ads");
  }
  try {
    const fresh = await amazonAds.refreshTokens(region, row.refresh_token);
    const patch = {
      access_token: fresh.accessToken,
      refresh_token: fresh.refreshToken || row.refresh_token,
      expires_at: fresh.expiresIn ? new Date(Date.now() + fresh.expiresIn * 1000).toISOString() : null,
      last_error: null,
    };
    await service.update("integrations", patch, { eq: { id: row.id } });
    return { ...row, ...patch, region };
  } catch (err) {
    await service.update(
      "integrations",
      { status: "expired", access_token: null, last_error: "Amazon access expired or was removed. Reconnect to continue." },
      { eq: { id: row.id } }
    );
    throw err;
  }
}

async function authorizeUrl(ctx, req) {
  if (!amazonAds.configured()) throw Errors.notConfigured("The Amazon Attribution integration");
  const region = new URL(req.url).searchParams.get("region");
  if (!amazonAds.isRegion(region)) throw Errors.invalid("Choose your Amazon marketplace region.");
  return json({ url: amazonAds.authorizeUrl(await amazonAds.signState(ctx.user.id, region), region) });
}

/**
 * Amazon redirects the browser here. No bearer token is present, so the
 * caller's identity, and the region they chose, come from the HMAC-signed
 * `state` issued a moment ago.
 */
async function callback(req) {
  const url = new URL(req.url);

  if (url.searchParams.get("error")) {
    console.warn("[bookpilot] Amazon OAuth declined:", url.searchParams.get("error"));
    return backToApp("amazon", "declined");
  }
  const verified = await amazonAds.verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!verified || !code) return backToApp("amazon", "failed");
  const { userId, region } = verified;

  try {
    const tokens = await amazonAds.exchangeCode(region, code);

    // With one profile there is nothing to ask, but it is still checked for
    // Amazon Attribution before being chosen. A failure here just leaves the
    // choice to the author.
    let only = null;
    try {
      const profiles = await amazonAds.listProfiles(region, tokens.accessToken);
      if (profiles.length === 1) {
        await amazonAds.listAdvertisers(region, tokens.accessToken, profiles[0].id);
        only = profiles[0];
      }
    } catch (err) {
      console.warn("[bookpilot] Amazon profile not chosen automatically:", err?.code);
    }

    await dbAsService().upsert(
      "integrations",
      {
        user_id: userId,
        provider: PROVIDER,
        status: "connected",
        region,
        scopes: [amazonAds.SCOPE],
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
        account_id: only?.id || null,
        account_name: only ? accountLabel(only) : null,
        last_error: null,
      },
      { onConflict: "user_id,provider", returning: false }
    );
    await audit.record(userId, "integration.connected", { entity: PROVIDER, detail: { region } });
    return backToApp("amazon", "connected");
  } catch (err) {
    console.error("[bookpilot] Amazon callback failed:", err);
    return backToApp("amazon", "failed");
  }
}

const accountLabel = (profile) => [profile.name, profile.country].filter(Boolean).join(" · ");

async function listAccounts(ctx) {
  const row = await connection(ctx.user.id);
  return json({ accounts: await amazonAds.listProfiles(row.region, row.access_token), selected: row.account_id });
}

async function selectAccount(ctx, body) {
  const row = await connection(ctx.user.id);
  const accountId = v.str(body.account_id, "Ad account", { max: 25, required: true });
  if (!/^\d+$/.test(accountId)) throw Errors.invalid("That doesn't look like an Amazon Ads account.");
  const chosen = (await amazonAds.listProfiles(row.region, row.access_token)).find((a) => a.id === accountId);
  if (!chosen) throw Errors.invalid("That account isn't available to your Amazon login.");
  // Not every advertising profile has Amazon Attribution. Asking now means
  // the author hears it here, not at the first sync.
  const advertisers = await amazonAds.listAdvertisers(row.region, row.access_token, chosen.id);
  if (!advertisers.length) throw Errors.invalid("That Amazon Ads account doesn't have Amazon Attribution set up, so there is nothing to sync from it.");

  await dbAsService().update(
    "integrations",
    { account_id: chosen.id, account_name: accountLabel(chosen) },
    { eq: { user_id: ctx.user.id, provider: PROVIDER } }
  );
  return json({ ok: true });
}

/**
 * Pull the last N days of Attribution figures.
 *
 * Amazon restates recent days, and its campaigns are named differently here
 * (by publisher and Amazon's id) from a report downloaded from the console,
 * so re-importing by name would leave both. A sync therefore replaces every
 * Amazon figure the author has in the same currency for the days it covers,
 * imported reports included, and the screen says so. Nothing is removed when
 * Amazon returns no rows.
 */
async function sync(ctx, body) {
  const row = await connection(ctx.user.id);
  if (!row.account_id) throw Errors.invalid("Choose an Amazon Ads account first.");

  const range = amazonAds.dateRange(v.int(body.days ?? 30, "Days", { min: 1, max: amazonAds.MAX_DAYS }));

  const profile = (await amazonAds.listProfiles(row.region, row.access_token)).find((p) => p.id === row.account_id);
  if (!profile) throw Errors.invalid("That account isn't available to your Amazon login any more. Choose another.");
  // Sales come back "in local currency" with no currency beside them, so the
  // profile's is the only source; without one nothing can be summed safely.
  if (!profile.currency) throw Errors.invalid("Amazon didn't say which currency that account uses, so its figures can't be imported safely.");
  const currency = v.currency(profile.currency);

  const asked = await amazonAds.reportWithKindle(row.region, row.access_token, row.account_id, range);
  const { rows: found, dropped, kindle } = amazonAds.rowsFromReport(asked.entries);
  // Said out loud, so a missing Kindle figure is never mistaken for zero pages read.
  const notes = [];
  if (!asked.kindle) notes.push("Amazon didn't accept the Kindle pages-read figures for this account, so they were left out.");
  else if (found.length && !kindle) notes.push("Amazon returned no Kindle pages-read figures for these days.");
  const service = dbAsService();
  const finish = { last_synced_at: new Date().toISOString(), last_error: null };

  if (!found.length) {
    await service.update("integrations", finish, { eq: { user_id: ctx.user.id, provider: PROVIDER } });
    return json({ campaigns: 0, days: 0, since: range.since, until: range.until, currency, skipped: [], notes });
  }

  // The same validation an imported CSV gets.
  const parsed = amazon.normaliseRows(found);
  const dbRows = parsed.rows.map((r) => amazon.toDbRow(r, { userId: ctx.user.id, currency }));
  for (let i = 0; i < dbRows.length; i += 500) {
    await service.upsert(TABLE, dbRows.slice(i, i + 500), {
      onConflict: "user_id,external_campaign,metric_date", returning: false,
    });
  }

  // Replace, not add to: drop what this window held that the report no
  // longer contains (the console-named twin of a synced campaign, or a day
  // Amazon has since restated away).
  const keep = new Set(dbRows.map((r) => `${r.external_campaign}\u0000${r.metric_date}`));
  // PostgREST caps a response at 1000 rows, so page through, in a fixed order
  // so the pages neither overlap nor skip.
  const existing = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const page = await service.select(TABLE, {
      select: "id,external_campaign,metric_date",
      eq: { user_id: ctx.user.id, currency },
      filters: { and: `(metric_date.gte.${range.since},metric_date.lte.${range.until})` },
      order: "metric_date.asc,id.asc", limit: 1000, offset,
    });
    existing.push(...page);
    if (page.length < 1000) break;
  }
  const stale = existing.filter((r) => !keep.has(`${r.external_campaign}\u0000${r.metric_date}`)).map((r) => r.id);
  for (let i = 0; i < stale.length; i += 200) {
    await service.remove(TABLE, { eq: { user_id: ctx.user.id }, in: { id: stale.slice(i, i + 200) } });
  }

  await service.update("integrations", finish, { eq: { user_id: ctx.user.id, provider: PROVIDER } });
  await audit.record(ctx.user.id, "amazon.synced", {
    entity: PROVIDER,
    detail: { campaigns: parsed.campaigns.length, rows: dbRows.length, replaced: stale.length, dropped, since: range.since, until: range.until },
  });
  return json({
    campaigns: parsed.campaigns.length, days: dbRows.length, replaced: stale.length,
    since: range.since, until: range.until, currency, skipped: [], notes,
  });
}

/**
 * Forget the connection. Amazon offers no way for an app to revoke a login's
 * tokens, so the copy here is cleared and the author is told where to remove
 * the app's access on Amazon's side.
 */
async function disconnect(ctx) {
  const service = dbAsService();
  await service.update(
    "integrations",
    { status: "disconnected", access_token: null, refresh_token: null, expires_at: null, account_id: null, account_name: null },
    { eq: { user_id: ctx.user.id, provider: PROVIDER } }
  );
  await audit.record(ctx.user.id, "integration.disconnected", { entity: PROVIDER, detail: { revoked: false } });
  return json({ disconnected: true, revoked: false });
}

// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);

  // The OAuth callback arrives from Amazon without a session.
  if (action === "callback" && req.method === "GET") return callback(req);

  const ctx = await authenticate(req);
  memoryLimit(`amazon:${ctx.user.id}`, 60, 60_000);

  if (req.method === "GET" && action === "authorize-url") return authorizeUrl(ctx, req);
  if (req.method === "GET" && action === "accounts") return listAccounts(ctx);

  if (req.method === "POST") {
    const body = await readJson(req);
    if (action === "select-account") return selectAccount(ctx, body);
    if (action === "sync") return sync(ctx, body);
    if (action === "disconnect") return disconnect(ctx);
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-amazon/*" };
