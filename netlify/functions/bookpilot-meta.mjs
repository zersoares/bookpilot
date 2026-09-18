// BookPilot AI — Meta integration.
//
//   /api/bp-meta/*
//
// OAuth connect, ad-account selection, campaign launch and insights
// sync. When META_APP_ID / META_APP_SECRET / META_REDIRECT_URI are not
// configured, every route here answers 501 "not set up on this
// deployment" and the UI shows a Connect Integration state — the one
// thing this file will never do is invent a campaign id and call it
// launched.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as meta from "./bookpilot-lib/meta.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";
import { backToApp } from "./bookpilot-lib/oauth-return.js";

const PREFIX = "/api/bp-meta";

/** Read the stored token for a user. Service role: the client has no
 *  grant on the integrations table by design. */
async function connection(userId) {
  const row = await dbAsService().selectOne("integrations", {
    eq: { user_id: userId, provider: "meta" },
  });
  if (!row || row.status !== "connected" || !row.access_token) {
    throw Errors.integrationMissing("Meta");
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await dbAsService().update("integrations", { status: "expired" }, { eq: { id: row.id } });
    throw Errors.integrationMissing("Meta");
  }
  return row;
}

async function authorizeUrl(ctx) {
  if (!meta.configured()) throw Errors.notConfigured("The Meta integration");
  const state = await meta.signState(ctx.user.id);
  return json({ url: meta.authorizeUrl(state) });
}

/**
 * Meta redirects the browser here. No bearer token is present, so the
 * caller's identity comes from the HMAC-signed `state` parameter that
 * was issued to them a moment ago.
 */
async function callback(req) {
  const url = new URL(req.url);

  const error = url.searchParams.get("error");
  if (error) {
    console.warn("[bookpilot] Meta OAuth declined:", error);
    return backToApp("meta", "declined");
  }

  const userId = await meta.verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!userId || !code) return backToApp("meta", "failed");

  try {
    const { accessToken, expiresIn } = await meta.exchangeCode(code);
    const accounts = await meta.listAdAccounts(accessToken);

    await dbAsService().upsert(
      "integrations",
      {
        user_id: userId,
        provider: "meta",
        status: "connected",
        scopes: meta.REQUIRED_SCOPES,
        access_token: accessToken,
        expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        account_id: accounts[0]?.id || null,
        account_name: accounts[0]?.name || null,
        last_error: null,
      },
      { onConflict: "user_id,provider", returning: false }
    );

    await audit.record(userId, "integration.connected", { entity: "meta" });
    return backToApp("meta", "connected");
  } catch (err) {
    console.error("[bookpilot] Meta callback failed:", err);
    return backToApp("meta", "failed");
  }
}

async function listAccounts(ctx) {
  const row = await connection(ctx.user.id);
  const accounts = await meta.listAdAccounts(row.access_token);
  return json({ accounts, selected: row.account_id });
}

async function selectAccount(ctx, body) {
  await connection(ctx.user.id);
  const accountId = v.str(body.account_id, "Ad account", { max: 60, required: true });
  if (!/^act_\d+$/.test(accountId)) throw Errors.invalid("That doesn't look like a Meta ad account id.");
  await dbAsService().update(
    "integrations",
    { account_id: accountId, account_name: v.str(body.account_name, "Account name", { max: 200 }) },
    { eq: { user_id: ctx.user.id, provider: "meta" } }
  );
  return json({ ok: true });
}

/**
 * Push a draft campaign to Meta.
 *
 * Everything is created PAUSED. Launching (which is when money starts
 * moving) is a second, explicit call — spec §21: never spend more
 * without the author authorising it.
 */
async function pushCampaign(ctx, body) {
  const row = await connection(ctx.user.id);
  if (!row.account_id) throw Errors.invalid("Choose which Meta ad account to use first.");
  const pageId = v.str(body.page_id, "Facebook Page", { max: 40, required: true });

  const campaign = await ctx.db.selectOne("campaigns", {
    eq: { id: v.uuid(body.campaign_id, "Campaign") },
  });
  if (!campaign) throw Errors.notFound("campaign");
  if (campaign.external_campaign_id) throw Errors.invalid("This campaign is already on Meta.");
  if (!campaign.destination_url) throw Errors.invalid("Set the campaign's destination URL first.");

  const [book, adSets] = await Promise.all([
    ctx.db.selectOne("books", { eq: { id: campaign.book_id } }),
    ctx.db.select("ad_sets", { select: "*", eq: { campaign_id: campaign.id } }),
  ]);
  if (!adSets.length) throw Errors.invalid("This campaign has no audiences yet.");

  const externalCampaignId = await meta.createCampaign(row.access_token, row.account_id, {
    name: `${book?.title || "Book"} — ${campaign.name}`,
    objective: campaign.objective,
  });

  for (const set of adSets) {
    const persona = set.persona_id
      ? await ctx.db.selectOne("reader_personas", { eq: { id: set.persona_id } })
      : null;
    const externalSetId = await meta.createAdSet(row.access_token, row.account_id, {
      name: set.name,
      campaignId: externalCampaignId,
      dailyBudgetCents: set.daily_budget_cents || campaign.daily_budget_cents,
      targeting: meta.personaToTargeting(persona, book?.target_countries || []),
      startTime: campaign.start_date ? `${campaign.start_date}T00:00:00+0000` : undefined,
      endTime: campaign.end_date ? `${campaign.end_date}T23:59:00+0000` : undefined,
      destinationUrl: campaign.destination_url,
    });
    await ctx.db.update("ad_sets", { external_id: externalSetId, status: "paused" }, { eq: { id: set.id } });

    const ads = await ctx.db.select("ads", { select: "*", eq: { ad_set_id: set.id } });
    for (const ad of ads) {
      const creative = ad.creative_id
        ? await ctx.db.selectOne("creatives", { eq: { id: ad.creative_id } })
        : null;
      if (!creative) continue;
      const { adId } = await meta.createAd(row.access_token, row.account_id, {
        name: creative.headline?.slice(0, 60) || "Ad",
        adSetId: externalSetId,
        pageId,
        message: creative.primary_text || "",
        headline: creative.headline || book?.title || "",
        description: creative.description || "",
        linkUrl: campaign.destination_url,
      });
      await ctx.db.update("ads", { external_id: adId, status: "paused" }, { eq: { id: ad.id } });
      await ctx.db.update("creatives", { status: "in_campaign" }, { eq: { id: creative.id } });
    }
  }

  // external_campaign_id is server-written (see 002_rls.sql): it records
  // what Meta confirmed, so `authenticated` has no grant on that column.
  const updated = await dbAsService().update(
    "campaigns",
    { external_campaign_id: externalCampaignId, status: "scheduled", status_detail: null },
    { eq: { id: campaign.id, user_id: ctx.user.id } }
  );

  await audit.record(ctx.user.id, "campaign.pushed_to_meta", {
    entity: "campaign", entityId: campaign.id,
  });

  return json({
    campaign: updated,
    note: "Everything was created paused on Meta. Nothing spends until you launch it.",
  });
}

/** Start or pause spending. This is the only route that moves money. */
async function setStatus(ctx, body) {
  const row = await connection(ctx.user.id);
  const status = v.oneOf(body.status, "Status", ["active", "paused"], { required: true });
  const campaign = await ctx.db.selectOne("campaigns", {
    eq: { id: v.uuid(body.campaign_id, "Campaign") },
  });
  if (!campaign) throw Errors.notFound("campaign");
  if (!campaign.external_campaign_id) {
    throw Errors.invalid("Push this campaign to Meta before launching it.");
  }
  if (status === "active" && body.confirm !== true) {
    // An explicit confirmation flag, because this is the click that
    // starts spending the author's money.
    throw Errors.invalid("Confirm the launch to start spending.");
  }

  await meta.setCampaignStatus(row.access_token, campaign.external_campaign_id, status);
  // Written with the service role, and only after Meta accepted the
  // change: launched_at is the timestamp the money started moving, so a
  // client must not be able to invent it.
  const updated = await dbAsService().update(
    "campaigns",
    {
      status: status === "active" ? "active" : "paused",
      launched_at: status === "active" && !campaign.launched_at ? new Date().toISOString() : campaign.launched_at,
    },
    { eq: { id: campaign.id, user_id: ctx.user.id } }
  );

  await ctx.db.insert("notifications", {
    user_id: ctx.user.id,
    type: status === "active" ? "campaign_launched" : "campaign_paused",
    title: status === "active" ? "Campaign launched" : "Campaign paused",
    message: `${campaign.name} is now ${status === "active" ? "live on Meta" : "paused"}.`,
    link: `#/campaigns/${campaign.id}`,
  }, { returning: false });

  await audit.record(ctx.user.id, `campaign.${status}`, { entity: "campaign", entityId: campaign.id });
  return json({ campaign: updated });
}

/** Pull the last N days of insights into performance_metrics. */
async function sync(ctx, body) {
  const row = await connection(ctx.user.id);
  const campaign = await ctx.db.selectOne("campaigns", {
    eq: { id: v.uuid(body.campaign_id, "Campaign") },
  });
  if (!campaign) throw Errors.notFound("campaign");
  if (!campaign.external_campaign_id) throw Errors.invalid("This campaign isn't on Meta yet.");

  const days = v.int(body.days ?? 30, "Days", { min: 1, max: 90 });
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const insights = await meta.campaignInsights(row.access_token, campaign.external_campaign_id, { since, until });

  const adSets = await ctx.db.select("ad_sets", { select: "id", eq: { campaign_id: campaign.id } });
  const ads = adSets.length
    ? await ctx.db.select("ads", {
        select: "id,external_id", in: { ad_set_id: adSets.map((s) => s.id) }, limit: 200,
      })
    : [];
  const byExternal = Object.fromEntries(ads.filter((a) => a.external_id).map((a) => [a.external_id, a.id]));

  const rows = insights
    .filter((i) => byExternal[i.external_ad_id])
    .map((i) => ({
      campaign_id: campaign.id,
      ad_id: byExternal[i.external_ad_id],
      metric_date: i.metric_date,
      source: "meta",
      impressions: i.impressions,
      reach: i.reach,
      clicks: i.clicks,
      spend_cents: i.spend_cents,
      conversions: i.conversions,
      revenue_cents: i.revenue_cents,
    }));

  // Metrics are written with the service role: `authenticated` has
  // SELECT only on performance_metrics, so a client can never fabricate
  // its own campaign results.
  if (rows.length) {
    await dbAsService().upsert("performance_metrics", rows, {
      onConflict: "campaign_id,ad_id,metric_date,source",
      returning: false,
    });
  }

  await dbAsService().update(
    "integrations",
    { last_synced_at: new Date().toISOString() },
    { eq: { user_id: ctx.user.id, provider: "meta" } }
  );

  return json({ synced: rows.length, since, until });
}

// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const [action] = pathSegments(req, PREFIX);

  // The OAuth callback arrives from Meta without a session.
  if (action === "callback" && req.method === "GET") return callback(req);

  const ctx = await authenticate(req);
  memoryLimit(`meta:${ctx.user.id}`, 60, 60_000);

  if (req.method === "GET" && action === "authorize-url") return authorizeUrl(ctx);
  if (req.method === "GET" && action === "accounts") return listAccounts(ctx);

  if (req.method === "POST") {
    const body = await readJson(req);
    if (action === "select-account") return selectAccount(ctx, body);
    if (action === "push") return pushCampaign(ctx, body);
    if (action === "status") return setStatus(ctx, body);
    if (action === "sync") return sync(ctx, body);
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp-meta/*" };
