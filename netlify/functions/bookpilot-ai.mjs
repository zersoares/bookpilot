// BookPilot AI — generation endpoints.
//
//   /api/bp-ai/*
//
// Shape of every handler here: authenticate → rate-limit → charge
// credits → call the model → persist → return. If the model call fails
// after the charge, the credits are refunded; an author never pays for
// a generation they didn't receive.

import { withGuards, json, readJson, pathSegments } from "./bookpilot-lib/http.js";
import { authenticate } from "./bookpilot-lib/auth.js";
import { dbAsService } from "./bookpilot-lib/db.js";
import { Errors } from "./bookpilot-lib/errors.js";
import { memoryLimit, aiHourlyLimit } from "./bookpilot-lib/ratelimit.js";
import { charge, refund } from "./bookpilot-lib/credits.js";
import { generate } from "./bookpilot-lib/ai.js";
import { deriveMetrics, confidenceLevel, budgetRecommendation } from "./bookpilot-lib/metrics.js";
import * as v from "./bookpilot-lib/validate.js";
import * as audit from "./bookpilot-lib/audit.js";

const PREFIX = "/api/bp-ai";
const AI_CALLS_PER_HOUR = 60;

function money(cents, currency = "EUR") {
  if (cents === null || cents === undefined) return "not set";
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * Charge, run, and refund on failure. Every generation route uses this
 * so the accounting can't drift between handlers.
 */
async function billed(ctx, operation, bookId, run) {
  const { credits } = await charge(ctx.user.id, operation, {
    bookId,
    available: ctx.profile.ai_credits,
  });
  try {
    const result = await run();
    await audit.record(ctx.user.id, `ai.${operation}`, {
      entity: "book", entityId: bookId, detail: { credits },
    });
    return { result, credits };
  } catch (err) {
    // bp_refund_credits writes `refund:<reason>` into ai_usage.operation,
    // so carrying the diagnostic here is what makes a production AI failure
    // readable from the database instead of only from Netlify's log UI.
    // ai.js guarantees the string is short and free of the request echo.
    const reason = err?.diagnostic ? `${operation}|${err.diagnostic}` : operation;
    await refund(ctx.user.id, credits, reason);
    throw err;
  }
}

async function loadBook(ctx, bookId) {
  const book = await ctx.db.selectOne("books", { eq: { id: v.uuid(bookId, "Book") } });
  if (!book) throw Errors.notFound("book");
  return book;
}

// ---------------------------------------------------------------------
// Book analysis (spec §9)
// ---------------------------------------------------------------------

async function analyzeBook(ctx, body) {
  const book = await loadBook(ctx, body.book_id);

  const { result, credits } = await billed(ctx, "book_analysis", book.id, () =>
    generate("book_analysis", {
      title: book.title,
      subtitle: book.subtitle,
      author_name: book.author_name,
      genre: book.genre,
      subgenre: book.subgenre,
      price: money(book.price_cents, book.currency),
      description: book.description,
      sample_text: book.sample_text,
      author_bio: book.author_bio,
      reviews_text: book.reviews_text,
    })
  );

  const d = result.data;
  const analysis = await ctx.db.insert("book_analysis", {
    book_id: book.id,
    positioning: d.positioning,
    core_promise: d.core_promise,
    reader_problem: d.reader_problem,
    transformation: d.transformation,
    themes: d.themes || [],
    purchase_motivations: d.purchase_motivations || [],
    objections: d.objections || [],
    opportunities: d.opportunities || [],
    reasoning: d.reasoning,
    model: result.model,
  });

  if (book.status === "draft") {
    await ctx.db.update("books", { status: "analyzed" }, { eq: { id: book.id } });
  }

  return json({ analysis, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Reader personas (spec §10)
// ---------------------------------------------------------------------

async function generatePersonas(ctx, body) {
  const book = await loadBook(ctx, body.book_id);
  const count = v.int(body.count ?? 4, "Count", { min: 3, max: 5 });
  const analysis = await ctx.db.selectOne("book_analysis", {
    eq: { book_id: book.id }, order: "created_at.desc",
  });

  const { result, credits } = await billed(ctx, "reader_personas", book.id, () =>
    generate("reader_personas", {
      count,
      title: book.title,
      genre: book.genre,
      subgenre: book.subgenre,
      description: book.description,
      positioning: analysis?.positioning,
      core_promise: analysis?.core_promise,
      reader_problem: analysis?.reader_problem,
    })
  );

  const rows = (result.data.personas || []).slice(0, 5).map((p, index) => ({
    book_id: book.id,
    name: String(p.name || `Persona ${index + 1}`).slice(0, 200),
    age_range: p.age_range,
    description: p.description,
    demographics: p.demographics,
    interests: p.interests || [],
    pain_points: p.pain_points || [],
    desires: p.desires || [],
    objections: p.objections || [],
    triggers: p.triggers || [],
    motivations: p.motivations || [],
    messaging: p.messaging,
    sort_order: index,
  }));
  if (!rows.length) throw Errors.aiUnavailable();

  // Regenerating replaces the previous set rather than stacking a second
  // one underneath it.
  await ctx.db.remove("reader_personas", { eq: { book_id: book.id } });
  const personas = await ctx.db.insert("reader_personas", rows);

  return json({ personas, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Marketing angles (spec §11)
// ---------------------------------------------------------------------

async function generateAngles(ctx, body) {
  const book = await loadBook(ctx, body.book_id);
  const count = v.int(body.count ?? 10, "Count", { min: 10, max: 14 });
  const [analysis, personas] = await Promise.all([
    ctx.db.selectOne("book_analysis", { eq: { book_id: book.id }, order: "created_at.desc" }),
    ctx.db.select("reader_personas", { select: "id,name,description,pain_points,desires", eq: { book_id: book.id } }),
  ]);
  if (!personas.length) {
    throw Errors.invalid("Generate reader personas first — angles are written for a specific reader.");
  }

  const { result, credits } = await billed(ctx, "marketing_angles", book.id, () =>
    generate("marketing_angles", {
      count,
      title: book.title,
      genre: book.genre,
      core_promise: analysis?.core_promise,
      reader_problem: analysis?.reader_problem,
      transformation: analysis?.transformation,
      personas: personas.map((p) => ({
        name: p.name, description: p.description, pain_points: p.pain_points, desires: p.desires,
      })),
    })
  );

  const byName = new Map(personas.map((p) => [p.name.toLowerCase(), p.id]));
  const rows = (result.data.angles || []).slice(0, 14).map((a) => ({
    book_id: book.id,
    persona_id: byName.get(String(a.persona_name || "").toLowerCase()) || null,
    name: String(a.name || "Untitled angle").slice(0, 200),
    category: v.ANGLE_CATEGORIES.includes(a.category) ? a.category : "emotional",
    explanation: a.explanation,
    hook: a.hook,
    message: a.message,
    cta: a.cta,
    format_hint: a.format_hint,
  }));
  if (!rows.length) throw Errors.aiUnavailable();

  await ctx.db.remove("marketing_angles", { eq: { book_id: book.id } });
  const angles = await ctx.db.insert("marketing_angles", rows);

  return json({ angles, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Ad copy (spec §12)
// ---------------------------------------------------------------------

async function generateCopy(ctx, body) {
  const book = await loadBook(ctx, body.book_id);
  const platform = v.oneOf(body.platform, "Platform", v.PLATFORMS, { required: true });
  const count = v.int(body.count ?? 3, "Count", { min: 1, max: 6 });
  const angle = body.angle_id
    ? await ctx.db.selectOne("marketing_angles", { eq: { id: v.uuid(body.angle_id, "Angle") } })
    : null;
  const persona = angle?.persona_id
    ? await ctx.db.selectOne("reader_personas", { eq: { id: angle.persona_id } })
    : null;
  const analysis = await ctx.db.selectOne("book_analysis", {
    eq: { book_id: book.id }, order: "created_at.desc",
  });

  const { result, credits } = await billed(ctx, "ad_copy", book.id, () =>
    generate("ad_copy", {
      title: book.title,
      genre: book.genre,
      price: money(book.price_cents, book.currency),
      core_promise: analysis?.core_promise,
      angle_name: angle?.name,
      angle_category: angle?.category,
      angle_hook: angle?.hook,
      angle_message: angle?.message,
      persona: persona ? { name: persona.name, description: persona.description } : null,
      platform,
      count,
    })
  );

  return json({ variations: result.data.variations || [], creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Creative concepts (spec §13) — saved as creatives, then scored
// ---------------------------------------------------------------------

async function generateCreatives(ctx, body) {
  const book = await loadBook(ctx, body.book_id);
  const platform = v.oneOf(body.platform, "Platform", v.PLATFORMS, { required: true });
  const format = v.oneOf(body.format, "Format", v.CREATIVE_FORMATS, { required: true });
  const count = v.int(body.count ?? 2, "Count", { min: 1, max: 4 });
  const angle = body.angle_id
    ? await ctx.db.selectOne("marketing_angles", { eq: { id: v.uuid(body.angle_id, "Angle") } })
    : null;
  const persona = angle?.persona_id
    ? await ctx.db.selectOne("reader_personas", { eq: { id: angle.persona_id } })
    : null;

  const operation = format === "video_script" || format === "reel" ? "video_concept" : "creative_concept";

  const { result, credits } = await billed(ctx, operation, book.id, () =>
    generate("creative_concept", {
      count,
      title: book.title,
      genre: book.genre,
      angle_name: angle?.name,
      angle_hook: angle?.hook,
      persona: persona ? { name: persona.name, description: persona.description } : null,
      platform,
      format,
    })
  );

  const rows = (result.data.concepts || []).slice(0, 4).map((c) => ({
    user_id: ctx.user.id,
    book_id: book.id,
    angle_id: angle?.id || null,
    persona_id: persona?.id || null,
    platform,
    format,
    headline: c.headline,
    primary_text: c.primary_text,
    description: c.on_screen_text,
    cta: c.cta,
    visual_prompt: c.visual_prompt,
    body: { title: c.title, slides: c.slides || [], on_screen_text: c.on_screen_text },
    status: "draft",
  }));
  if (!rows.length) throw Errors.aiUnavailable();

  const creatives = await ctx.db.insert("creatives", rows);
  return json({ creatives, creditsUsed: credits });
}

async function generateVideoScript(ctx, body) {
  const book = await loadBook(ctx, body.book_id);
  const platform = v.oneOf(body.platform ?? "instagram", "Platform", v.PLATFORMS);
  const duration = v.int(body.duration ?? 30, "Duration", { min: 15, max: 90 });
  const angle = body.angle_id
    ? await ctx.db.selectOne("marketing_angles", { eq: { id: v.uuid(body.angle_id, "Angle") } })
    : null;
  const persona = angle?.persona_id
    ? await ctx.db.selectOne("reader_personas", { eq: { id: angle.persona_id } })
    : null;
  const analysis = await ctx.db.selectOne("book_analysis", {
    eq: { book_id: book.id }, order: "created_at.desc",
  });

  const { result, credits } = await billed(ctx, "video_concept", book.id, () =>
    generate("video_script", {
      duration,
      platform,
      title: book.title,
      genre: book.genre,
      core_promise: analysis?.core_promise,
      angle_name: angle?.name,
      angle_hook: angle?.hook,
      persona: persona?.name,
    })
  );

  const script = result.data;
  const creative = await ctx.db.insert("creatives", {
    user_id: ctx.user.id,
    book_id: book.id,
    angle_id: angle?.id || null,
    persona_id: persona?.id || null,
    platform,
    format: "video_script",
    headline: script.title,
    primary_text: script.caption,
    description: script.hook,
    cta: script.cta,
    visual_prompt: script.shot_notes,
    body: { beats: script.beats || [], hook: script.hook, duration },
    status: "draft",
  });

  return json({ creative, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Creative scoring (spec §14)
// ---------------------------------------------------------------------

async function scoreCreative(ctx, body) {
  const id = v.uuid(body.creative_id, "Creative");
  const creative = await ctx.db.selectOne("creatives", { eq: { id } });
  if (!creative) throw Errors.notFound("creative");
  const [book, angle, persona] = await Promise.all([
    ctx.db.selectOne("books", { eq: { id: creative.book_id } }),
    creative.angle_id ? ctx.db.selectOne("marketing_angles", { eq: { id: creative.angle_id } }) : null,
    creative.persona_id ? ctx.db.selectOne("reader_personas", { eq: { id: creative.persona_id } }) : null,
  ]);

  const { result, credits } = await billed(ctx, "creative_scoring", creative.book_id, () =>
    generate("creative_scoring", {
      title: book?.title,
      genre: book?.genre,
      persona: persona?.name,
      angle_name: angle?.name,
      platform: creative.platform,
      format: creative.format,
      headline: creative.headline,
      primary_text: creative.primary_text,
      cta: creative.cta,
      visual_prompt: creative.visual_prompt,
    })
  );

  const d = result.data;
  const score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
  const updated = await ctx.db.update(
    "creatives",
    {
      score,
      score_detail: {
        dimensions: d.dimensions || {},
        strengths: d.strengths || [],
        improvements: d.improvements || [],
        // Named so the UI can print the caveat next to the number: this
        // is predicted quality, not a prediction of sales (spec §46).
        kind: "predicted_quality",
        scored_at: new Date().toISOString(),
      },
    },
    { eq: { id } }
  );

  return json({ creative: updated, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Campaign analysis, budget, advisor (spec §21-§24)
// ---------------------------------------------------------------------

async function campaignContext(ctx, campaignId) {
  const campaign = await ctx.db.selectOne("campaigns", { eq: { id: v.uuid(campaignId, "Campaign") } });
  if (!campaign) throw Errors.notFound("campaign");

  const [book, adSets, rows] = await Promise.all([
    ctx.db.selectOne("books", { eq: { id: campaign.book_id } }),
    ctx.db.select("ad_sets", { select: "id,name", eq: { campaign_id: campaign.id } }),
    ctx.db.select("performance_metrics", {
      select: "*", eq: { campaign_id: campaign.id }, limit: 2000,
    }),
  ]);

  const setIds = adSets.map((s) => s.id);
  const ads = setIds.length
    ? await ctx.db.select("ads", { select: "id,creative_id", in: { ad_set_id: setIds }, limit: 200 })
    : [];
  const creativeIds = [...new Set(ads.map((a) => a.creative_id).filter(Boolean))];
  const creatives = creativeIds.length
    ? await ctx.db.select("creatives", {
        select: "id,headline,format,platform,angle_id", in: { id: creativeIds }, limit: 200,
      })
    : [];

  const adToCreative = Object.fromEntries(ads.map((a) => [a.id, a.creative_id]));
  const grouped = new Map();
  for (const row of rows) {
    const creativeId = adToCreative[row.ad_id];
    if (!creativeId) continue;
    if (!grouped.has(creativeId)) grouped.set(creativeId, []);
    grouped.get(creativeId).push(row);
  }

  const perCreative = [...grouped.entries()].map(([creativeId, group]) => {
    const metrics = deriveMetrics(group);
    const creative = creatives.find((c) => c.id === creativeId);
    return { creativeId, headline: creative?.headline, format: creative?.format, metrics };
  });

  const daysRunning = campaign.launched_at
    ? Math.max(1, Math.round((Date.now() - new Date(campaign.launched_at)) / 86_400_000))
    : 0;

  return { campaign, book, totals: deriveMetrics(rows), perCreative, daysRunning };
}

function describeMetrics(m, currency = "EUR") {
  if (!m.hasData) return "No delivery data yet.";
  const fmt = (value, suffix = "") => (value === null ? "N/A" : `${value.toFixed(2)}${suffix}`);
  return [
    `impressions ${m.impressions}`,
    `clicks ${m.clicks}`,
    `spend ${money(m.spendCents, currency)}`,
    `CTR ${fmt(m.ctr, "%")}`,
    `CPC ${m.cpc === null ? "N/A" : money(Math.round(m.cpc), currency)}`,
    `conversions ${m.conversions}`,
    `CPA ${m.cpa === null ? "N/A" : money(Math.round(m.cpa), currency)}`,
    `revenue ${money(m.revenueCents, currency)}`,
    `ROAS ${fmt(m.roas, "x")}`,
    `evidence: ${confidenceLevel(m)}`,
  ].join(", ");
}

async function analyzeCampaign(ctx, body) {
  const c = await campaignContext(ctx, body.campaign_id);
  if (!c.totals.hasData) {
    // Nothing to analyse — say so rather than spending a credit on the
    // model inventing a narrative from zeros (spec §39).
    return json({
      analysis: {
        summary: "This campaign hasn't recorded any delivery yet, so there is nothing to analyse. Meta usually needs 24-48 hours and some spend before the first numbers arrive.",
        confidence: "insufficient",
        insights: [],
        recommendations: [],
      },
      creditsUsed: 0,
    });
  }

  const learnings = await ctx.db.select("campaign_learnings", {
    select: "genre,angle_category,format,spend_cents,clicks,conversions,revenue_cents",
    eq: { user_id: ctx.user.id }, order: "recorded_at.desc", limit: 30,
  });

  const { result, credits } = await billed(ctx, "performance_analysis", c.campaign.book_id, () =>
    generate("performance_analysis", {
      title: c.book?.title,
      genre: c.book?.genre,
      campaign_name: c.campaign.name,
      status: c.campaign.status,
      days_running: c.daysRunning,
      daily_budget: money(c.campaign.daily_budget_cents, c.campaign.currency),
      destination_type: c.campaign.destination_type,
      totals: describeMetrics(c.totals, c.campaign.currency),
      creative_rows: c.perCreative
        .map((r) => `- ${r.headline || r.creativeId}: ${describeMetrics(r.metrics, c.campaign.currency)}`)
        .join("\n"),
      learnings,
    })
  );

  // Persist the recommendations so the optimisation view and the
  // notification centre can act on them.
  const recs = (result.data.recommendations || []).slice(0, 6).map((r) => ({
    user_id: ctx.user.id,
    campaign_id: c.campaign.id,
    kind: ["pause", "increase", "test", "refresh", "audience", "landing_page"].includes(r.kind)
      ? r.kind : "test",
    title: String(r.title || "").slice(0, 200),
    reason: r.reason,
    metrics: { supporting: r.metrics },
    confidence: ["low", "medium", "high"].includes(r.confidence) ? r.confidence : "medium",
    action: r.action,
  }));
  if (recs.length) await ctx.db.insert("recommendations", recs, { returning: false });

  return json({ analysis: result.data, creditsUsed: credits });
}

async function recommendBudget(ctx, body) {
  const c = await campaignContext(ctx, body.campaign_id);

  // The deterministic model runs first and is handed to the AI to
  // sanity-check, so the numbers on screen always come from the
  // campaign's own arithmetic rather than a model's impression of it.
  const model = budgetRecommendation({
    currentDailyBudgetCents: c.campaign.daily_budget_cents,
    metrics: c.totals,
  });
  if (!model) {
    return json({
      recommendation: null,
      reason: "Not enough data yet. A budget recommendation needs at least a few days of delivery and some conversions to be worth anything.",
      creditsUsed: 0,
    });
  }

  const { result, credits } = await billed(ctx, "budget_recommendation", c.campaign.book_id, () =>
    generate("budget_recommendation", {
      daily_budget: money(c.campaign.daily_budget_cents, c.campaign.currency),
      days_running: c.daysRunning,
      totals: describeMetrics(c.totals, c.campaign.currency),
      price: money(c.book?.price_cents, c.book?.currency),
      goal: ctx.profile.primary_goal,
      model_suggestion: `conservative ${money(model.conservative, c.campaign.currency)}, balanced ${money(model.balanced, c.campaign.currency)}, aggressive ${money(model.aggressive, c.campaign.currency)} (confidence: ${model.confidence})`,
    })
  );

  return json({ recommendation: { ...model, narrative: result.data }, creditsUsed: credits });
}

async function askAdvisor(ctx, body) {
  const question = v.str(body.question, "Question", { max: 1000, required: true });

  // Assemble the advisor's view of the account. It answers from this and
  // nothing else.
  const campaigns = await ctx.db.select("campaigns", {
    select: "id,name,status,daily_budget_cents,currency,book_id,launched_at",
    eq: { user_id: ctx.user.id }, order: "created_at.desc", limit: 10,
  });

  const contexts = [];
  for (const campaign of campaigns.filter((c) => c.status === "active" || c.status === "paused").slice(0, 3)) {
    const c = await campaignContext(ctx, campaign.id);
    contexts.push(
      `Campaign "${c.campaign.name}" (${c.campaign.status}, ${c.daysRunning} days, budget ${money(c.campaign.daily_budget_cents, c.campaign.currency)}):\n` +
        `  totals: ${describeMetrics(c.totals, c.campaign.currency)}\n` +
        c.perCreative
          .map((r) => `  creative "${r.headline || r.creativeId}": ${describeMetrics(r.metrics, c.campaign.currency)}`)
          .join("\n")
    );
  }

  const books = await ctx.db.select("books", {
    select: "title,genre,status", eq: { user_id: ctx.user.id }, limit: 10,
  });

  const context = [
    `Books: ${books.map((b) => `${b.title} (${b.genre || "genre not set"}, ${b.status})`).join("; ") || "none yet"}`,
    `Credits remaining: ${ctx.profile.ai_credits}`,
    contexts.length ? contexts.join("\n\n") : "No campaigns with delivery data yet.",
  ].join("\n\n");

  const { result, credits } = await billed(ctx, "advisor_message", null, () =>
    generate("advisor", { question, context })
  );

  return json({ ...result.data, creditsUsed: credits });
}

async function findPatterns(ctx) {
  const learnings = await ctx.db.select("campaign_learnings", {
    select: "*", eq: { user_id: ctx.user.id }, order: "recorded_at.desc", limit: 50,
  });
  if (learnings.length < 3) {
    return json({
      patterns: [],
      enough_history: false,
      note: "Patterns need at least three finished campaigns before they mean anything.",
      creditsUsed: 0,
    });
  }

  const { result, credits } = await billed(ctx, "performance_analysis", null, () =>
    generate("campaign_learning", {
      history: learnings.map((l) => {
        const m = deriveMetrics([l]);
        return `${l.genre || "unknown genre"} / ${l.angle_category || "unknown angle"} / ${l.format || "unknown format"}: ${describeMetrics(m)}`;
      }).join("\n"),
    })
  );

  return json({ ...result.data, creditsUsed: credits });
}

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

const ROUTES = {
  analyze: analyzeBook,
  personas: generatePersonas,
  angles: generateAngles,
  copy: generateCopy,
  creatives: generateCreatives,
  "video-script": generateVideoScript,
  score: scoreCreative,
  "analyze-campaign": analyzeCampaign,
  budget: recommendBudget,
  advisor: askAdvisor,
  patterns: findPatterns,
};

export default withGuards(async (req) => {
  if (req.method !== "POST") throw Errors.notFound("endpoint");

  const [operation] = pathSegments(req, PREFIX);
  const handler = ROUTES[operation];
  if (!handler) throw Errors.notFound("endpoint");

  const ctx = await authenticate(req);

  // Two ceilings: a burst limit per warm instance, and an hourly limit
  // counted in the database so it survives cold starts.
  memoryLimit(`ai:${ctx.user.id}`, 20, 60_000);
  await aiHourlyLimit(dbAsService(), ctx.user.id, AI_CALLS_PER_HOUR);

  const body = await readJson(req);
  return handler(ctx, body);
});

export const config = { path: "/api/bp-ai/*" };
