// BookPilot AI — core API.
//
//   /api/bp/*
//
// Every route that touches a user's data goes through authenticate(),
// which returns a database client signed with that user's own JWT. The
// RLS policies in bookpilot/sql/002_rls.sql are therefore the boundary:
// even a mistake in a filter below cannot return another account's rows.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService, databaseReachable } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { capabilities, env } from "./bookpilot-lib/env.js";
import { memoryLimit } from "./bookpilot-lib/ratelimit.js";
import * as v from "./bookpilot-lib/validate.js";
import { planFor, assertCanAddBook, creditCosts } from "./bookpilot-lib/credits.js";
import { deriveMetrics, confidenceLevel } from "./bookpilot-lib/metrics.js";
import * as audit from "./bookpilot-lib/audit.js";
import * as tracking from "./bookpilot-lib/tracking.js";
import * as amazon from "./bookpilot-lib/amazon.js";
import * as platformReport from "./bookpilot-lib/platform-report.js";

const PREFIX = "/api/bp";

// ---------------------------------------------------------------------
// Public: what this deployment can actually do
// ---------------------------------------------------------------------

async function handleConfig() {
  const caps = capabilities();
  let plans = [];
  let costs = {};
  let flags = {};
  // null = undecided. Reading the reference data proves the project
  // answers, so the healthy path costs no extra request; any other
  // outcome has to be probed, because a failed query is not the same
  // thing as a project that has gone away.
  let reachable = null;
  if (caps.database && env.supabaseServiceKey) {
    const service = dbAsService();
    try {
      [plans, costs] = await Promise.all([
        service.select("plans", { select: "*", eq: { is_active: true }, order: "sort_order" }),
        creditCosts(),
      ]);
      const flagRows = await service.select("feature_flags", { select: "key,enabled" });
      flags = Object.fromEntries(flagRows.map((f) => [f.key, f.enabled]));
      reachable = true;
    } catch (err) {
      // Reference data is not worth failing the whole page load over, but
      // it is worth logging — and it leaves reachability undecided.
      console.error("[bookpilot] config: reference data unavailable:", err?.message || err);
    }
  }
  if (caps.database && reachable === null) reachable = await databaseReachable();

  // `database` has to mean "the database answers", not "the environment
  // variables are set". The client chooses between the real workspace and
  // the demo one on the strength of this flag, so a paused project that
  // still has its configuration would otherwise send people to a sign-in
  // form that cannot possibly work.
  caps.database = Boolean(caps.database && reachable);
  return json({
    capabilities: caps,
    plans,
    creditCosts: costs,
    flags,
    // The Supabase project URL and anon key are designed to be public —
    // they identify the project, and RLS is what protects the data. They
    // are served from here rather than hard-coded in the page so the same
    // build can point at a staging project.
    auth: caps.database ? { url: env.supabaseUrl, anonKey: env.supabaseAnonKey } : null,
  });
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------

async function handleMe(ctx) {
  const [plan, books, campaigns, creatives, unread] = await Promise.all([
    planFor(ctx.profile),
    ctx.db.select("books", { select: "id", eq: { user_id: ctx.user.id }, limit: 500 }),
    ctx.db.select("campaigns", { select: "id,status", eq: { user_id: ctx.user.id }, limit: 500 }),
    ctx.db.select("creatives", { select: "id", eq: { user_id: ctx.user.id }, limit: 1000 }),
    ctx.db.select("notifications", {
      select: "id", eq: { user_id: ctx.user.id, read: false }, limit: 100,
    }),
  ]);

  return json({
    profile: {
      id: ctx.profile.id,
      email: ctx.profile.email,
      full_name: ctx.profile.full_name,
      country: ctx.profile.country,
      currency: ctx.profile.currency,
      language: ctx.profile.language,
      author_type: ctx.profile.author_type,
      genres: ctx.profile.genres,
      role: ctx.profile.role,
      plan_id: ctx.profile.plan_id,
      ai_credits: ctx.profile.ai_credits,
      onboarding_step: ctx.profile.onboarding_step,
      primary_goal: ctx.profile.primary_goal,
      daily_budget_cents: ctx.profile.daily_budget_cents,
      marketing_consent: ctx.profile.marketing_consent,
      analytics_consent: ctx.profile.analytics_consent,
    },
    plan,
    counts: {
      books: books.length,
      campaigns: campaigns.length,
      activeCampaigns: campaigns.filter((c) => c.status === "active").length,
      creatives: creatives.length,
      unreadNotifications: unread.length,
    },
  });
}

async function handleUpdateMe(ctx, body) {
  // Allow-list. `role`, `plan_id` and `ai_credits` are absent on purpose:
  // those are set by the billing webhook and the credit function only.
  const patch = v.pick(body, {
    full_name: (x) => v.str(x, "Name", { max: 120 }),
    country: (x) => v.str(x, "Country", { max: 60 }),
    currency: (x) => v.currency(x),
    language: (x) => v.str(x, "Language", { max: 10 }),
    author_type: (x) => v.str(x, "Author type", { max: 40 }),
    genres: (x) => v.stringArray(x, "Genres", { maxItems: 20 }),
    primary_goal: (x) => v.str(x, "Goal", { max: 60 }),
    daily_budget_cents: (x) => v.int(x, "Daily budget", { min: 0, max: 100_000_00 }),
    onboarding_step: (x) => v.int(x, "Onboarding step", { min: 0, max: 6 }),
    marketing_consent: (x) => v.bool(x),
    analytics_consent: (x) => v.bool(x),
  });
  if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");

  const updated = await ctx.db.update("profiles", patch, { eq: { id: ctx.user.id } });

  // Consent changes are recorded separately so there is a dated trail of
  // what the user agreed to and when (GDPR Art. 7(1)).
  const consentRows = [];
  if ("marketing_consent" in patch) {
    consentRows.push({ user_id: ctx.user.id, purpose: "marketing", granted: patch.marketing_consent });
  }
  if ("analytics_consent" in patch) {
    consentRows.push({ user_id: ctx.user.id, purpose: "analytics", granted: patch.analytics_consent });
  }
  if (consentRows.length) await ctx.db.insert("consent_records", consentRows, { returning: false });

  return json({ profile: updated });
}

// ---------------------------------------------------------------------
// GDPR: export and deletion (spec §34)
// ---------------------------------------------------------------------

async function handleExport(ctx) {
  const q = (table, options) => ctx.db.select(table, { select: "*", limit: 5000, ...options });
  const [books, creatives, campaigns, notifications, usage, consents, learnings, events] =
    await Promise.all([
      q("books", { eq: { user_id: ctx.user.id } }),
      q("creatives", { eq: { user_id: ctx.user.id } }),
      q("campaigns", { eq: { user_id: ctx.user.id } }),
      q("notifications", { eq: { user_id: ctx.user.id } }),
      q("ai_usage", { eq: { user_id: ctx.user.id } }),
      q("consent_records", { eq: { user_id: ctx.user.id } }),
      q("campaign_learnings", { eq: { user_id: ctx.user.id } }),
      q("tracking_events", { eq: { user_id: ctx.user.id } }),
    ]);

  const bookIds = books.map((b) => b.id);
  const [analysis, personas, angles] = bookIds.length
    ? await Promise.all([
        q("book_analysis", { in: { book_id: bookIds } }),
        q("reader_personas", { in: { book_id: bookIds } }),
        q("marketing_angles", { in: { book_id: bookIds } }),
      ])
    : [[], [], []];

  await audit.record(ctx.user.id, "gdpr.export");

  return json({
    exported_at: new Date().toISOString(),
    format: "BookPilot AI account export v1",
    profile: ctx.profile,
    books,
    book_analysis: analysis,
    reader_personas: personas,
    marketing_angles: angles,
    creatives,
    campaigns,
    tracking_events: events,
    campaign_learnings: learnings,
    ai_usage: usage,
    consent_records: consents,
    notifications,
  });
}

async function handleDeleteAccount(ctx, body) {
  if (body.confirm !== "DELETE") {
    throw Errors.invalid('Type DELETE to confirm that you want to erase your account.');
  }
  await ctx.db.insert("gdpr_requests", {
    user_id: ctx.user.id, kind: "deletion", status: "processing",
  }, { returning: false });

  const service = dbAsService();
  await service.rpc("bp_delete_account", { p_user: ctx.user.id });

  // Removing the auth.users row is what actually revokes the sign-in.
  try {
    await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users/${ctx.user.id}`, {
      method: "DELETE",
      headers: {
        apikey: env.supabaseServiceKey,
        Authorization: `Bearer ${env.supabaseServiceKey}`,
      },
    });
  } catch (err) {
    console.error("[bookpilot] auth user deletion failed:", err);
  }

  await audit.record(null, "account.deleted", { entity: "profile" });
  return json({ deleted: true });
}

// ---------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------

function bookFields(body, { partial = false } = {}) {
  const required = !partial;
  const fields = {
    title: (x) => v.str(x, "Title", { max: 300, min: 1, required }),
    subtitle: (x) => v.str(x, "Subtitle", { max: 300 }),
    author_name: (x) => v.str(x, "Author", { max: 200 }),
    description: (x) => v.str(x, "Description", { max: 8000 }),
    genre: (x) => v.oneOf(x, "Genre", v.GENRES),
    subgenre: (x) => v.str(x, "Subgenre", { max: 120 }),
    price_cents: (x) => v.int(x, "Price", { min: 0, max: 100_000_00 }),
    currency: (x) => v.currency(x),
    sales_url: (x) => v.url(x, "Sales URL"),
    cover_url: (x) => v.url(x, "Cover URL"),
    sample_text: (x) => v.str(x, "Sample text", { max: 40_000 }),
    author_bio: (x) => v.str(x, "Author bio", { max: 4000 }),
    reviews_text: (x) => v.str(x, "Reviews", { max: 8000 }),
    target_countries: (x) => v.stringArray(x, "Target countries", { maxItems: 20, maxLength: 4 }),
    status: (x) => v.oneOf(x, "Status", ["draft", "analyzed", "promoting", "archived"]),
  };
  const picked = v.pick(body, fields);
  if (!partial && !picked.title) throw Errors.invalid("A book needs a title.");
  return picked;
}

async function handleBooks(ctx, method, segments, body) {
  const id = segments[1];

  if (method === "GET" && !id) {
    const books = await ctx.db.select("books", {
      select: "*", eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 200,
    });
    return json({ books });
  }

  if (method === "POST" && !id) {
    await assertCanAddBook(ctx.db, ctx.profile);
    const book = await ctx.db.insert("books", {
      ...bookFields(body),
      user_id: ctx.user.id,
      currency: body.currency || ctx.profile.currency,
    });
    await audit.record(ctx.user.id, "book.created", { entity: "book", entityId: book.id });
    return json({ book }, 201);
  }

  v.uuid(id, "Book id");

  if (method === "GET" && segments[2] === "strategy") {
    const [analysis, personas, angles] = await Promise.all([
      ctx.db.selectOne("book_analysis", { eq: { book_id: id }, order: "created_at.desc" }),
      ctx.db.select("reader_personas", { eq: { book_id: id }, order: "sort_order", limit: 20 }),
      ctx.db.select("marketing_angles", { eq: { book_id: id }, order: "created_at", limit: 40 }),
    ]);
    return json({ analysis, personas, angles });
  }

  if (method === "GET") {
    const book = await ctx.db.selectOne("books", { eq: { id } });
    if (!book) throw Errors.notFound("book");
    return json({ book });
  }

  if (method === "PATCH") {
    const patch = bookFields(body, { partial: true });
    if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
    const book = await ctx.db.update("books", patch, { eq: { id } });
    if (!book) throw Errors.notFound("book");
    await audit.record(ctx.user.id, "book.updated", { entity: "book", entityId: id });
    return json({ book });
  }

  if (method === "DELETE") {
    await ctx.db.remove("books", { eq: { id } });
    await audit.record(ctx.user.id, "book.deleted", { entity: "book", entityId: id });
    return json({ deleted: true });
  }

  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------

async function handleCreatives(ctx, method, segments, body, url) {
  const id = segments[1];

  if (method === "GET" && !id) {
    const eq = { user_id: ctx.user.id };
    const bookId = url.searchParams.get("book_id");
    if (bookId) eq.book_id = v.uuid(bookId, "Book id");
    const platform = url.searchParams.get("platform");
    if (platform) eq.platform = v.oneOf(platform, "Platform", v.PLATFORMS);
    const format = url.searchParams.get("format");
    if (format) eq.format = v.oneOf(format, "Format", v.CREATIVE_FORMATS);

    const creatives = await ctx.db.select("creatives", {
      select: "*", eq, order: "created_at.desc", limit: 300,
    });
    return json({ creatives });
  }

  if (method === "POST" && !id) {
    const fields = v.pick(body, {
      book_id: (x) => v.uuid(x, "Book"),
      angle_id: (x) => v.uuid(x, "Angle", { required: false }),
      persona_id: (x) => v.uuid(x, "Persona", { required: false }),
      parent_id: (x) => v.uuid(x, "Parent creative", { required: false }),
      platform: (x) => v.oneOf(x, "Platform", v.PLATFORMS),
      format: (x) => v.oneOf(x, "Format", v.CREATIVE_FORMATS),
      headline: (x) => v.str(x, "Headline", { max: 300 }),
      primary_text: (x) => v.str(x, "Primary text", { max: 4000 }),
      description: (x) => v.str(x, "Description", { max: 1000 }),
      cta: (x) => v.str(x, "Call to action", { max: 120 }),
      visual_prompt: (x) => v.str(x, "Visual concept", { max: 6000 }),
      media_url: (x) => v.url(x, "Media URL"),
      status: (x) => v.oneOf(x, "Status", ["draft", "ready", "in_campaign", "archived"]),
    });
    if (!fields.book_id) throw Errors.invalid("Choose a book for this creative.");
    if (body.body && typeof body.body === "object") fields.body = body.body;

    await ctx.db.selectOne("books", { eq: { id: fields.book_id } }).then((b) => {
      if (!b) throw Errors.notFound("book");
    });

    const creative = await ctx.db.insert("creatives", { ...fields, user_id: ctx.user.id });
    return json({ creative }, 201);
  }

  v.uuid(id, "Creative id");

  if (method === "GET") {
    const creative = await ctx.db.selectOne("creatives", { eq: { id } });
    if (!creative) throw Errors.notFound("creative");
    return json({ creative });
  }

  if (method === "PATCH") {
    const patch = v.pick(body, {
      headline: (x) => v.str(x, "Headline", { max: 300 }),
      primary_text: (x) => v.str(x, "Primary text", { max: 4000 }),
      description: (x) => v.str(x, "Description", { max: 1000 }),
      cta: (x) => v.str(x, "Call to action", { max: 120 }),
      visual_prompt: (x) => v.str(x, "Visual concept", { max: 6000 }),
      media_url: (x) => v.url(x, "Media URL"),
      status: (x) => v.oneOf(x, "Status", ["draft", "ready", "in_campaign", "archived"]),
      angle_id: (x) => v.uuid(x, "Angle", { required: false }),
      persona_id: (x) => v.uuid(x, "Persona", { required: false }),
    });
    if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
    const creative = await ctx.db.update("creatives", patch, { eq: { id } });
    if (!creative) throw Errors.notFound("creative");
    return json({ creative });
  }

  if (method === "DELETE") {
    await ctx.db.remove("creatives", { eq: { id } });
    return json({ deleted: true });
  }

  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------

async function handleCampaigns(ctx, method, segments, body) {
  const id = segments[1];
  const action = segments[2];

  if (method === "GET" && !id) {
    const campaigns = await ctx.db.select("campaigns", {
      select: "*", eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 200,
    });
    return json({ campaigns });
  }

  if (method === "POST" && !id) {
    const fields = v.pick(body, {
      book_id: (x) => v.uuid(x, "Book"),
      name: (x) => v.str(x, "Campaign name", { max: 200, required: true }),
      platform: (x) => v.oneOf(x, "Platform", v.PLATFORMS),
      objective: (x) => v.oneOf(x, "Objective", ["conversions", "traffic", "awareness", "engagement"]),
      daily_budget_cents: (x) => v.int(x, "Daily budget", { min: 100, max: 1_000_000 }),
      currency: (x) => v.currency(x),
      start_date: (x) => v.isoDate(x, "Start date"),
      end_date: (x) => v.isoDate(x, "End date"),
      destination_type: (x) => v.oneOf(x, "Destination", ["website", "landing_page", "amazon", "kobo", "other"]),
      destination_url: (x) => v.url(x, "Destination URL"),
    });
    if (!fields.book_id) throw Errors.invalid("Choose a book for this campaign.");
    if (!fields.name) throw Errors.invalid("Give the campaign a name.");

    const campaign = await ctx.db.insert("campaigns", {
      ...fields,
      user_id: ctx.user.id,
      status: "draft",
      currency: fields.currency || ctx.profile.currency,
    });

    // Ad sets: one per selected persona; ads: one per selected creative.
    const personaIds = (Array.isArray(body.persona_ids) ? body.persona_ids : [])
      .slice(0, 5).map((p) => v.uuid(p, "Persona"));
    const creativeIds = (Array.isArray(body.creative_ids) ? body.creative_ids : [])
      .slice(0, 20).map((c) => v.uuid(c, "Creative"));

    if (personaIds.length) {
      const personas = await ctx.db.select("reader_personas", {
        select: "id,name", in: { id: personaIds },
      });
      const perSetBudget = Math.floor((fields.daily_budget_cents || 0) / personas.length);
      const adSets = await ctx.db.insert(
        "ad_sets",
        personas.map((p) => ({
          campaign_id: campaign.id,
          persona_id: p.id,
          name: p.name,
          daily_budget_cents: perSetBudget,
          audience: { persona: p.name },
        }))
      );
      if (creativeIds.length && adSets?.length) {
        const ads = [];
        for (const set of adSets) {
          for (const creativeId of creativeIds) {
            ads.push({ ad_set_id: set.id, creative_id: creativeId, name: `Ad ${ads.length + 1}` });
          }
        }
        await ctx.db.insert("ads", ads, { returning: false });
      }
    }

    await audit.record(ctx.user.id, "campaign.created", { entity: "campaign", entityId: campaign.id });
    return json({ campaign }, 201);
  }

  v.uuid(id, "Campaign id");

  if (method === "GET" && action === "performance") {
    return handleCampaignPerformance(ctx, id);
  }

  if (method === "GET") {
    const [campaign, adSets] = await Promise.all([
      ctx.db.selectOne("campaigns", { eq: { id } }),
      ctx.db.select("ad_sets", { select: "*", eq: { campaign_id: id }, limit: 20 }),
    ]);
    if (!campaign) throw Errors.notFound("campaign");
    const setIds = adSets.map((s) => s.id);
    const ads = setIds.length
      ? await ctx.db.select("ads", { select: "*", in: { ad_set_id: setIds }, limit: 200 })
      : [];
    return json({ campaign, adSets, ads });
  }

  if (method === "PATCH") {
    const patch = v.pick(body, {
      name: (x) => v.str(x, "Campaign name", { max: 200 }),
      daily_budget_cents: (x) => v.int(x, "Daily budget", { min: 100, max: 1_000_000 }),
      start_date: (x) => v.isoDate(x, "Start date"),
      end_date: (x) => v.isoDate(x, "End date"),
      destination_url: (x) => v.url(x, "Destination URL"),
      // Status changes that mean money moves (launching, resuming) go
      // through the Meta endpoint, which needs an explicit confirmation.
      status: (x) => v.oneOf(x, "Status", ["draft", "paused", "completed", "scheduled"]),
    });
    if (!Object.keys(patch).length) throw Errors.invalid("Nothing to update.");
    const campaign = await ctx.db.update("campaigns", patch, { eq: { id } });
    if (!campaign) throw Errors.notFound("campaign");
    await audit.record(ctx.user.id, "campaign.updated", {
      entity: "campaign", entityId: id, detail: { fields: Object.keys(patch) },
    });
    return json({ campaign });
  }

  if (method === "DELETE") {
    await ctx.db.remove("campaigns", { eq: { id } });
    await audit.record(ctx.user.id, "campaign.deleted", { entity: "campaign", entityId: id });
    return json({ deleted: true });
  }

  throw Errors.notFound("endpoint");
}

async function handleCampaignPerformance(ctx, campaignId) {
  const [campaign, rows, adSets] = await Promise.all([
    ctx.db.selectOne("campaigns", { eq: { id: campaignId } }),
    ctx.db.select("performance_metrics", {
      select: "*", eq: { campaign_id: campaignId }, order: "metric_date", limit: 2000,
    }),
    ctx.db.select("ad_sets", { select: "id,name", eq: { campaign_id: campaignId }, limit: 20 }),
  ]);
  if (!campaign) throw Errors.notFound("campaign");

  const setIds = adSets.map((s) => s.id);
  const ads = setIds.length
    ? await ctx.db.select("ads", { select: "id,creative_id,ad_set_id", in: { ad_set_id: setIds }, limit: 200 })
    : [];

  // Website-attributed and Amazon-attributed numbers are kept apart and
  // labelled; they are never summed into one "sales" figure (spec §18).
  const platformRows = rows.filter((r) => r.source === "meta" || r.source === "demo");
  const websiteRows = rows.filter((r) => r.source === "website");

  const byAd = new Map();
  for (const row of platformRows) {
    if (!row.ad_id) continue;
    if (!byAd.has(row.ad_id)) byAd.set(row.ad_id, []);
    byAd.get(row.ad_id).push(row);
  }

  const perCreative = ads.map((ad) => {
    const adRows = byAd.get(ad.id) || [];
    const metrics = deriveMetrics(adRows);
    return {
      ad_id: ad.id,
      creative_id: ad.creative_id,
      metrics,
      confidence: confidenceLevel(metrics),
    };
  });

  return json({
    campaign,
    totals: deriveMetrics(platformRows),
    websiteAttributed: deriveMetrics(websiteRows),
    daily: platformRows,
    perCreative,
  });
}

// ---------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------

async function handleAnalytics(ctx, segments, url) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const campaigns = await ctx.db.select("campaigns", {
    select: "id,name,book_id,status,platform,daily_budget_cents,currency,created_at,is_demo",
    eq: { user_id: ctx.user.id },
    limit: 200,
  });
  if (!campaigns.length) {
    // No campaigns does not mean no Amazon data: an author can import
    // Attribution reports before running a single BookPilot campaign.
    return json({
      totals: deriveMetrics([]), campaigns: [], creatives: [], days,
      amazon: await amazonTotals(ctx, since),
    });
  }

  const campaignIds = campaigns.map((c) => c.id);
  const rows = await ctx.db.select("performance_metrics", {
    select: "*",
    in: { campaign_id: campaignIds },
    filters: { metric_date: `gte.${since}` },
    limit: 5000,
  });

  const platformRows = rows.filter((r) => r.source !== "amazon_attribution");
  const perCampaign = campaigns.map((c) => ({
    campaign: c,
    metrics: deriveMetrics(platformRows.filter((r) => r.campaign_id === c.id)),
  }));

  // Creative-level table (spec §20).
  const adRows = platformRows.filter((r) => r.ad_id);
  let creativeTable = [];
  if (adRows.length) {
    const adIds = [...new Set(adRows.map((r) => r.ad_id))];
    const ads = await ctx.db.select("ads", { select: "id,creative_id", in: { id: adIds }, limit: 500 });
    const creativeIds = [...new Set(ads.map((a) => a.creative_id).filter(Boolean))];
    const creatives = creativeIds.length
      ? await ctx.db.select("creatives", {
          select: "id,headline,format,platform,score,book_id", in: { id: creativeIds }, limit: 500,
        })
      : [];
    const adToCreative = Object.fromEntries(ads.map((a) => [a.id, a.creative_id]));
    const grouped = new Map();
    for (const row of adRows) {
      const creativeId = adToCreative[row.ad_id];
      if (!creativeId) continue;
      if (!grouped.has(creativeId)) grouped.set(creativeId, []);
      grouped.get(creativeId).push(row);
    }
    creativeTable = [...grouped.entries()].map(([creativeId, group]) => {
      const metrics = deriveMetrics(group);
      return {
        creative: creatives.find((c) => c.id === creativeId) || { id: creativeId },
        metrics,
        confidence: confidenceLevel(metrics),
      };
    });
  }

  // Paid platforms side by side. Website-tracked rows are not a platform
  // and never appear here.
  const platforms = ["meta", "tiktok", "google", "pinterest"]
    .map((source) => ({ source, metrics: deriveMetrics(platformRows.filter((r) => r.source === source)) }))
    .filter((p) => p.metrics.hasData);

  return json({
    days,
    totals: deriveMetrics(platformRows),
    platforms,
    campaigns: perCampaign,
    creatives: creativeTable,
    // Reported separately, never folded into the totals above.
    amazon: await amazonTotals(ctx, since),
  });
}

/**
 * PostgREST caps a response (1000 rows on Supabase), and a year of daily
 * Amazon data across a few campaigns exceeds that, so page through it.
 * Ordering is fixed so pages neither overlap nor skip.
 */
async function selectAll(db, table, options, cap = 20_000) {
  const out = [];
  for (let offset = 0; offset < cap; offset += 1000) {
    const page = await db.select(table, { ...options, order: "metric_date.asc,id.asc", limit: 1000, offset });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function amazonTotals(ctx, since) {
  const rows = await selectAll(ctx.db, "amazon_attribution_metrics", {
    select: "metric_date,clicks,detail_page_views,add_to_carts,purchases,units_sold,kindle_pages_read,product_sales_cents,kindle_royalties_cents,currency,imported_at,external_campaign",
    eq: { user_id: ctx.user.id },
    filters: { metric_date: `gte.${since}` },
  });
  return amazon.totalsOf(rows);
}

// ---------------------------------------------------------------------
// Notifications, recommendations, integrations, tracking sites
// ---------------------------------------------------------------------

async function handleNotifications(ctx, method, segments) {
  if (method === "GET") {
    const notifications = await ctx.db.select("notifications", {
      select: "*", eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 100,
    });
    return json({ notifications });
  }
  if (method === "POST" && segments[1] === "read-all") {
    await ctx.db.update("notifications", { read: true }, {
      eq: { user_id: ctx.user.id, read: false },
    });
    return json({ ok: true });
  }
  if (method === "PATCH" && segments[1]) {
    v.uuid(segments[1], "Notification id");
    const notification = await ctx.db.update("notifications", { read: true }, { eq: { id: segments[1] } });
    return json({ notification });
  }
  if (method === "DELETE" && segments[1]) {
    v.uuid(segments[1], "Notification id");
    await ctx.db.remove("notifications", { eq: { id: segments[1] } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

async function handleRecommendations(ctx, method, segments, body) {
  if (method === "GET") {
    const recommendations = await ctx.db.select("recommendations", {
      select: "*", eq: { user_id: ctx.user.id, status: "open" },
      order: "created_at.desc", limit: 50,
    });
    return json({ recommendations });
  }
  if (method === "PATCH" && segments[1]) {
    v.uuid(segments[1], "Recommendation id");
    const status = v.oneOf(body.status, "Status", ["applied", "dismissed"], { required: true });
    const recommendation = await ctx.db.update("recommendations", { status }, { eq: { id: segments[1] } });
    return json({ recommendation });
  }
  throw Errors.notFound("endpoint");
}

async function handleIntegrations(ctx, method, segments) {
  if (method === "GET") {
    // Reads the view, which exposes connection state but no tokens.
    const integrations = await ctx.db.select("integration_status", { select: "*" });
    return json({ integrations, capabilities: capabilities() });
  }
  if (method === "DELETE" && segments[1]) {
    const provider = v.oneOf(segments[1], "Provider", ["meta", "amazon_attribution", "tiktok", "google", "pinterest"], {
      required: true,
    });
    // The client has no grant on `integrations`, so the disconnect is
    // performed server-side after the user's identity is established.
    await dbAsService().update(
      "integrations",
      { status: "disconnected", access_token: null, refresh_token: null, expires_at: null },
      { eq: { user_id: ctx.user.id, provider } }
    );
    await audit.record(ctx.user.id, "integration.disconnected", { entity: provider });
    return json({ disconnected: true });
  }
  throw Errors.notFound("endpoint");
}

async function trackingStatus(ctx, siteId) {
  v.uuid(siteId, "Site id");
  // The user-scoped client: row-level security means another account's
  // site id simply is not found.
  const site = await ctx.db.selectOne("tracking_sites", { select: "*", eq: { id: siteId } });
  if (!site) throw Errors.notFound("tracking site");

  const cap = 500;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events = await ctx.db.select("tracking_events", {
    select: "id,event_type,value_cents,currency,utm,campaign_id,occurred_at",
    eq: { site_id: siteId },
    filters: { occurred_at: `gte.${since}` },
    order: "occurred_at.desc",
    limit: cap,
  });
  // The 7-day window can miss an older "last event"; one more row tells
  // the screen a site is quiet rather than never used.
  const latest = events.length ? events[0] : await ctx.db.selectOne("tracking_events", {
    select: "id,event_type,value_cents,currency,utm,campaign_id,occurred_at",
    eq: { site_id: siteId },
    order: "occurred_at.desc",
  });

  const scope = latest && !events.length ? [latest] : events;
  const summary = tracking.summarise(scope, { capped: events.length >= cap });
  return json({
    site: { id: site.id, domain: site.domain, is_active: site.is_active },
    health: tracking.health({ summary, site }),
    summary,
    test_url: tracking.testUrl(site.domain),
    recent: scope.slice(0, 25).map(tracking.shapeEvent),
  });
}

async function handleAmazonImport(ctx, method, body) {
  if (method === "GET") {
    const rows = await selectAll(ctx.db, "amazon_attribution_metrics", {
      select: "metric_date,external_campaign,currency,imported_at", eq: { user_id: ctx.user.id },
    });
    return json({ summary: amazon.summarise(rows) });
  }

  if (method === "POST") {
    const currency = v.currency(body.currency);
    const parsed = amazon.normaliseRows(body.rows);

    // Optional links from an Amazon campaign name to one of the author's
    // BookPilot campaigns. Ownership is checked through the user-scoped
    // client, so another account's campaign id is simply not found.
    const links = new Map();
    for (const link of Array.isArray(body.links) ? body.links.slice(0, 200) : []) {
      const name = v.str(link?.campaign, "Campaign", { max: 200 });
      if (name && link.campaign_id) links.set(name, v.uuid(link.campaign_id, "Campaign id"));
    }
    const owned = new Map();
    if (links.size) {
      const found = await ctx.db.select("campaigns", {
        select: "id,book_id", in: { id: [...new Set(links.values())] }, limit: 200,
      });
      for (const c of found) owned.set(c.id, c);
      for (const id of links.values()) {
        if (!owned.has(id)) throw Errors.invalid("One of the BookPilot campaigns you linked wasn't found.");
      }
    }

    const dbRows = parsed.rows.map((row) => {
      const campaignId = links.get(row.campaign) || null;
      return amazon.toDbRow(row, {
        userId: ctx.user.id, currency, campaignId, bookId: campaignId ? owned.get(campaignId).book_id : null,
      });
    });

    // Re-importing a report replaces the same campaign and day rather
    // than adding to it: Amazon restates recent days, and an author will
    // re-download an overlapping range.
    const service = dbAsService();
    for (let i = 0; i < dbRows.length; i += 500) {
      await service.upsert("amazon_attribution_metrics", dbRows.slice(i, i + 500), {
        onConflict: "user_id,external_campaign,metric_date", returning: false,
      });
    }
    await audit.record(ctx.user.id, "amazon.imported", {
      entity: "amazon_attribution", detail: { days: parsed.rows.length, from: parsed.from, to: parsed.to },
    });
    return json({
      imported: dbRows.length, campaigns: parsed.campaigns.length, from: parsed.from, to: parsed.to,
    }, 201);
  }

  if (method === "DELETE") {
    await dbAsService().remove("amazon_attribution_metrics", { eq: { user_id: ctx.user.id } });
    await audit.record(ctx.user.id, "amazon.import_removed", { entity: "amazon_attribution" });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

/**
 * The author's campaigns on a platform BookPilot does not run (TikTok,
 * Google Ads): they exist so links and imported figures have a home.
 */
async function externalCampaigns(ctx, platform) {
  return ctx.db.select("campaigns", {
    select: "id,name,book_id,currency,destination_url,created_at",
    eq: { user_id: ctx.user.id, platform, external_only: true },
    order: "created_at.desc", limit: 200,
  });
}

async function handlePlatformCampaigns(ctx, method, platformId, body) {
  const platform = platformReport.platformOf(platformId);
  if (method === "GET") return json({ campaigns: await externalCampaigns(ctx, platform.id) });
  if (method !== "POST") throw Errors.notFound("endpoint");

  const name = v.str(body.name, "Campaign name", { max: 200, required: true });
  const bookId = v.uuid(body.book_id, "Book");
  const book = await ctx.db.selectOne("books", { select: "id", eq: { id: bookId } });
  if (!book) throw Errors.invalid("We couldn't find that book.");

  const campaign = await ctx.db.insert("campaigns", {
    user_id: ctx.user.id,
    book_id: bookId,
    name,
    platform: platform.id,
    objective: "conversions",
    daily_budget_cents: 0,
    currency: body.currency ? v.currency(body.currency) : ctx.profile.currency,
    destination_url: v.url(body.destination_url, "Destination URL"),
    // Run by the author on the platform itself. "active" is their say-so;
    // BookPilot cannot see, launch or pause it.
    status: "active",
    external_only: true,
  });
  await audit.record(ctx.user.id, "campaign.created", { entity: "campaign", entityId: campaign.id, detail: { platform: platform.id } });
  return json({ campaign }, 201);
}

async function handlePlatformImport(ctx, method, platformId, body) {
  const platform = platformReport.platformOf(platformId);

  if (method === "GET") {
    const campaigns = await externalCampaigns(ctx, platform.id);
    const ids = campaigns.map((c) => c.id);
    const rows = ids.length
      ? await selectAll(ctx.db, "performance_metrics", {
          select: "campaign_id,metric_date,synced_at", in: { campaign_id: ids }, eq: { source: platform.source },
        })
      : [];
    return json({ summary: platformReport.summarise(rows, new Map(campaigns.map((c) => [c.id, c.name]))), campaigns });
  }

  if (method === "POST") {
    const currency = v.currency(body.currency);
    const parsed = platformReport.normaliseRows(body.rows, platform.id);
    const targets = platformReport.resolveTargets(parsed.campaigns, body.targets);

    // Resolve every target before writing anything, so a bad one cannot
    // leave an import half done.
    const existing = new Map((await externalCampaigns(ctx, platform.id)).map((c) => [c.id, c]));
    const plan = new Map();
    for (const [name, target] of targets) {
      if (target.campaignId) {
        const c = existing.get(v.uuid(target.campaignId, "Campaign"));
        if (!c) throw Errors.invalid(`"${name.slice(0, 60)}" was linked to a campaign that isn't one of your ${platform.name} campaigns.`);
        if (c.currency !== currency) {
          throw Errors.invalid(`"${c.name}" is in ${c.currency} but this report is in ${currency}. Pick the matching currency, or a different campaign.`);
        }
        plan.set(name, { id: c.id });
      } else {
        const bookId = v.uuid(target.bookId, "Book");
        const book = await ctx.db.selectOne("books", { select: "id", eq: { id: bookId } });
        if (!book) throw Errors.invalid("We couldn't find the book you chose.");
        plan.set(name, { create: { book_id: bookId } });
      }
    }

    let created = 0;
    for (const [name, p] of plan) {
      if (!p.create) continue;
      const campaign = await ctx.db.insert("campaigns", {
        user_id: ctx.user.id, book_id: p.create.book_id, name, platform: platform.id, objective: "conversions",
        daily_budget_cents: 0, currency, status: "active", external_only: true,
      });
      p.id = campaign.id;
      created += 1;
    }

    // Re-importing replaces a campaign-day rather than adding to it.
    const dbRows = parsed.rows.map((r) => platformReport.toPerformanceRow(r, plan.get(r.campaign).id, platform.id));
    const service = dbAsService();
    for (let i = 0; i < dbRows.length; i += 500) {
      await service.upsert("performance_metrics", dbRows.slice(i, i + 500), {
        onConflict: "campaign_id,ad_id,metric_date,source", returning: false,
      });
    }
    await audit.record(ctx.user.id, `${platform.id}.imported`, {
      entity: platform.id, detail: { days: parsed.rows.length, campaigns: plan.size, created, from: parsed.from, to: parsed.to },
    });
    return json({ imported: dbRows.length, campaigns: plan.size, created, from: parsed.from, to: parsed.to }, 201);
  }

  if (method === "DELETE") {
    const ids = (await externalCampaigns(ctx, platform.id)).map((c) => c.id);
    if (ids.length) {
      await dbAsService().remove("performance_metrics", { in: { campaign_id: ids }, eq: { source: platform.source } });
    }
    await audit.record(ctx.user.id, `${platform.id}.import_removed`, { entity: platform.id });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

async function handleTrackingSites(ctx, method, segments, body) {
  if (method === "GET" && segments[1] && segments[2] === "status") {
    return trackingStatus(ctx, segments[1]);
  }
  if (method === "GET") {
    const sites = await ctx.db.select("tracking_sites", {
      select: "*", eq: { user_id: ctx.user.id }, limit: 50,
    });
    return json({ sites });
  }
  if (method === "POST") {
    const name = v.str(body.name, "Site name", { max: 120, required: true });
    const domain = v.str(body.domain, "Domain", { max: 200, required: true })
      .replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const publicKey = `bp_${crypto.randomUUID().replace(/-/g, "")}`;
    const site = await ctx.db.insert("tracking_sites", {
      user_id: ctx.user.id, name, domain, public_key: publicKey,
    });
    return json({ site }, 201);
  }
  if (method === "DELETE" && segments[1]) {
    v.uuid(segments[1], "Site id");
    await ctx.db.remove("tracking_sites", { eq: { id: segments[1] } });
    return json({ deleted: true });
  }
  throw Errors.notFound("endpoint");
}

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

export default withGuards(async (req) => {
  const segments = pathSegments(req, PREFIX);
  const url = new URL(req.url);
  const resource = segments[0];

  if (!resource) throw Errors.notFound("endpoint");

  // Public endpoint: no session needed to render the pricing table.
  if (resource === "config" && req.method === "GET") return handleConfig();

  const ctx = await authenticate(req);

  // Per-account request ceiling. Generous enough that normal use never
  // sees it; low enough that a runaway script does.
  memoryLimit(`api:${ctx.user.id}`, 300, 60_000);

  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readJson(req) : {};

  switch (resource) {
    case "me":
      if (req.method === "GET" && !segments[1]) return handleMe(ctx);
      if (req.method === "PATCH" && !segments[1]) return handleUpdateMe(ctx, body);
      if (req.method === "GET" && segments[1] === "export") return handleExport(ctx);
      if (req.method === "POST" && segments[1] === "delete") return handleDeleteAccount(ctx, body);
      break;
    case "books":
      return handleBooks(ctx, req.method, segments, body);
    case "creatives":
      return handleCreatives(ctx, req.method, segments, body, url);
    case "campaigns":
      return handleCampaigns(ctx, req.method, segments, body);
    case "analytics":
      if (req.method === "GET") return handleAnalytics(ctx, segments, url);
      break;
    case "notifications":
      return handleNotifications(ctx, req.method, segments);
    case "recommendations":
      return handleRecommendations(ctx, req.method, segments, body);
    case "integrations":
      return handleIntegrations(ctx, req.method, segments);
    case "tracking-sites":
      return handleTrackingSites(ctx, req.method, segments, body);
    case "amazon-import":
      return handleAmazonImport(ctx, req.method, body);
    case "platform-campaigns":
      return handlePlatformCampaigns(ctx, req.method, segments[1], body);
    case "platform-import":
      return handlePlatformImport(ctx, req.method, segments[1], body);
    default:
      break;
  }

  throw Errors.notFound("endpoint");
});

export const config = { path: "/api/bp/*" };
