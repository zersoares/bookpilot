// The demo workspace (spec §35).
//
// Implements the same request surface as api.js against an in-memory
// copy of the sample dataset, so the entire product is explorable with
// no account, no database and no API keys — and every mutation (add a
// book, generate a creative, build a campaign) really does change the
// state you then see.
//
// It is not a mock of a connected product: nothing here reaches the
// network, and every screen it feeds carries a DEMO DATA badge. Demo
// campaigns are never described as live, and demo figures are never
// described as sales.

import {
  DEMO_BOOK, DEMO_ANALYSIS, DEMO_PERSONAS, DEMO_ANGLES, DEMO_CREATIVES,
  DEMO_CAMPAIGN, DEMO_AD_SETS, DEMO_ADS, DEMO_PERFORMANCE, DEMO_NOTIFICATIONS,
  DEMO_RECOMMENDATIONS, DEMO_PROFILE, DEMO_IDS,
} from "./demo.js";
import { deriveMetrics, confidenceLevel, budgetRecommendation } from "../core/metrics.js";
import {
  freshBuilderState, handleBuilder, exportBookFromState, DemoError as BuilderError,
} from "./demo-builder.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

// Declared up here because the initial state is built as the module loads.
const DEMO_SITE_ID = "d0000000-0000-4000-8000-000000000701";
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;

// Latency, so buttons show their loading states and the demo feels like
// the real thing rather than an instant re-render.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLANS = [
  { id: "free", name: "Free", price_cents: 0, currency: "EUR", book_limit: 1, creative_limit: 3,
    monthly_credits: 25, sort_order: 0,
    features: ["1 book", "Book analysis + 5 AI generations", "3 creatives", "Basic analytics", "Demo campaign"] },
  { id: "author", name: "Author", price_cents: 1900, currency: "EUR", book_limit: 3, creative_limit: 30,
    monthly_credits: 100, sort_order: 1,
    features: ["Up to 3 books", "100 AI credits per month", "30 creatives", "Campaign builder", "Analytics", "AI Advisor"] },
  { id: "author_pro", name: "Author Pro", price_cents: 4900, currency: "EUR", book_limit: null,
    creative_limit: null, monthly_credits: 500, sort_order: 2,
    features: ["Unlimited books", "500 AI credits per month", "Advanced creatives", "Video scripts",
      "Meta integration", "Advanced analytics", "Optimisation recommendations", "Attribution tools"] },
  { id: "publisher", name: "Publisher", price_cents: 14900, currency: "EUR", book_limit: null,
    creative_limit: null, monthly_credits: 2000, sort_order: 3,
    features: ["Multiple authors", "Unlimited books", "Team members", "Advanced analytics",
      "Campaign management", "Priority processing", "Publisher dashboard"] },
];

const CREDIT_COSTS = {
  book_analysis: 10, reader_personas: 10, marketing_angles: 5, ad_copy: 1,
  creative_concept: 1, creative_image: 5, creative_image_advanced: 8, video_concept: 5,
  video_generation: 20, creative_scoring: 1, advisor_message: 2,
  performance_analysis: 10, budget_recommendation: 2,
  // Book Builder
  book_positioning: 5, book_architecture: 15, book_bible: 8, chapter_write: 12,
  chapter_revise: 4, front_matter: 4, back_matter: 4, editorial_review: 6,
  research_brief: 8, visual_direction: 6, visual_render: 2, book_image: 5,
  cover_concepts: 10, cover_check: 3, quality_report: 10,
  marketing_campaign: 20, repurpose_book: 8,
};

function freshState() {
  return {
    profile: clone(DEMO_PROFILE),
    books: [clone(DEMO_BOOK)],
    analysis: { [DEMO_IDS.BOOK_ID]: clone(DEMO_ANALYSIS) },
    personas: clone(DEMO_PERSONAS),
    angles: clone(DEMO_ANGLES),
    creatives: clone(DEMO_CREATIVES),
    campaigns: [clone(DEMO_CAMPAIGN)],
    adSets: clone(DEMO_AD_SETS),
    ads: clone(DEMO_ADS),
    performance: clone(DEMO_PERFORMANCE),
    notifications: clone(DEMO_NOTIFICATIONS),
    recommendations: clone(DEMO_RECOMMENDATIONS),
    trackingSites: [{
      id: "d0000000-0000-4000-8000-000000000701",
      name: "Author website (demo)",
      domain: "example.com",
      public_key: "bp_demo000000000000000000000000000",
      is_active: true,
      created_at: "2026-01-10T10:00:00.000Z",
    }],
    trackingEvents: demoTrackingEvents(),
    // The authoring half keeps its own slice, reset by the same button.
    builder: freshBuilderState(),
  };
}

let state = freshState();

export function resetDemo() {
  state = freshState();
}

const uid = () =>
  `d0000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

class DemoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function spend(operation) {
  const cost = CREDIT_COSTS[operation] ?? 1;
  if (state.profile.ai_credits < cost) {
    throw new DemoError(
      "insufficient_credits",
      `This needs ${cost} AI credits and the demo account has ${state.profile.ai_credits} left. Reset the demo from Settings to start again.`,
      402
    );
  }
  state.profile.ai_credits -= cost;
  return cost;
}

// --- Read helpers -----------------------------------------------------

function campaignRows(campaignId) {
  return state.performance.filter((r) => r.campaign_id === campaignId);
}

function perCreative(campaignId) {
  const rows = campaignRows(campaignId);
  return state.ads
    .map((ad) => {
      const adRows = rows.filter((r) => r.ad_id === ad.id);
      const metrics = deriveMetrics(adRows);
      return {
        ad_id: ad.id,
        creative_id: ad.creative_id,
        creative: state.creatives.find((c) => c.id === ad.creative_id) || null,
        metrics,
        confidence: confidenceLevel(metrics),
      };
    })
    .filter((row) => row.metrics.hasData);
}

// --- The canned AI responses -----------------------------------------
//
// Written by hand rather than produced by a model, and phrased exactly
// as the live prompts are told to phrase things: no invented reviews,
// no promises, and an explicit confidence level.

function demoAdvisorAnswer(question) {
  const rows = perCreative(DEMO_IDS.CAMPAIGN_ID).sort(
    (a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0)
  );
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const totals = deriveMetrics(campaignRows(DEMO_IDS.CAMPAIGN_ID));

  const asked = String(question || "").toLowerCase();
  if (asked.includes("budget") || asked.includes("scale") || asked.includes("increase")) {
    return {
      answer:
        `Over 20 days this campaign has spent €${(totals.spendCents / 100).toFixed(2)} and returned ` +
        `€${(totals.revenueCents / 100).toFixed(2)} — a ROAS of ${totals.roas.toFixed(2)}×, which is ` +
        "healthy for a €8.99 book. That justifies a gradual increase, not a doubling: raising a Meta " +
        "budget sharply restarts the learning phase and usually costs more than it buys. A step to " +
        "€12–€13/day, held for a week, would tell you whether the return holds at higher volume.",
      actions: [
        { label: "Review budget", kind: "review_budget", detail: "Open the budget recommendation for this campaign." },
        { label: "Explain", kind: "explain", detail: "Why gradual increases beat doubling on Meta." },
      ],
    };
  }
  if (asked.includes("pause") || asked.includes("worst") || asked.includes("stop")) {
    return {
      answer:
        `“${worst.creative?.headline}” has taken ${worst.metrics.clicks} clicks and €` +
        `${(worst.metrics.spendCents / 100).toFixed(2)} without a recorded sale. That is not yet proof ` +
        "that it cannot work — 44 clicks is thin evidence — but it is enough to stop funding it while " +
        "better performers are budget-constrained. Its audience is also the narrowest of the four, " +
        "which the pre-launch score flagged.",
      actions: [
        { label: "Optimise campaign", kind: "optimize_campaign", detail: "Apply the pause recommendation." },
        { label: "Explain", kind: "explain", detail: "What counts as enough evidence to pause." },
      ],
    };
  }
  return {
    answer:
      `This campaign has enough data to identify an early winner. “${best.creative?.headline}” has ` +
      `${best.metrics.conversions} sales from ${best.metrics.clicks} clicks — a cost per sale of €` +
      `${(best.metrics.cpa / 100).toFixed(2)} against the campaign average of €${(totals.cpa / 100).toFixed(2)}. ` +
      `Confidence is ${confidenceLevel(best.metrics)}: enough to reallocate budget, not enough to bet ` +
      "the whole campaign on. The weakest creative has spent without converting at all.",
    actions: [
      { label: "Create variations", kind: "create_variations", detail: "Three reels from the winning hook." },
      { label: "Optimise campaign", kind: "optimize_campaign", detail: "Apply the open recommendations." },
      { label: "Explain", kind: "explain", detail: "How the confidence level was reached." },
    ],
  };
}

function demoCampaignAnalysis() {
  const rows = perCreative(DEMO_IDS.CAMPAIGN_ID).sort(
    (a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0)
  );
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const totals = deriveMetrics(campaignRows(DEMO_IDS.CAMPAIGN_ID));
  return {
    summary:
      `Twenty days in, the campaign is returning ${totals.roas.toFixed(2)}× on €` +
      `${(totals.spendCents / 100).toFixed(2)} of spend, at €${(totals.cpa / 100).toFixed(2)} per sale. ` +
      "The spread between the best and worst creative is wide enough to act on, and the emotional " +
      "angle is clearly ahead of the practical one.",
    confidence: "medium",
    insights: [
      { kind: "winner", title: `“${best.creative?.headline}” is the strongest performer`,
        detail: "Lowest cost per sale in the campaign, over enough clicks to be worth acting on.",
        metric: `${best.metrics.conversions} sales from ${best.metrics.clicks} clicks` },
      { kind: "weak", title: `“${worst.creative?.headline}” has spent without converting`,
        detail: "A narrow audience and a career-specific promise against a broader book.",
        metric: `${worst.metrics.clicks} clicks, 0 sales` },
      { kind: "opportunity", title: "Emotional angles are outperforming practical ones",
        detail: "The two emotional creatives sit above the campaign average; the practical one sits below it.",
        metric: "Emotional average ROAS 5.1× vs practical 2.7×" },
    ],
    recommendations: [
      { kind: "increase", title: "Shift budget towards the winning creative",
        reason: "It converts at less than half the campaign's average cost per sale.",
        metrics: `€${(best.metrics.cpa / 100).toFixed(2)} vs €${(totals.cpa / 100).toFixed(2)} per sale`,
        confidence: "medium", action: "Move roughly 20% of the daily budget." },
      { kind: "pause", title: "Pause the creative with no sales",
        reason: "It is drawing spend from creatives that are converting.",
        metrics: `${worst.metrics.clicks} clicks, 0 sales`, confidence: "medium",
        action: "Pause it and revisit the returning-professional audience separately." },
      { kind: "test", title: "Build three variations of the winning hook",
        reason: "Creative fatigue typically appears in weeks three to four at this budget.",
        metrics: "20 days live, one dominant creative", confidence: "high",
        action: "Generate three reel variations from the same angle." },
    ],
  };
}

// --- Website tracking (demo) ------------------------------------------
//
// The real status comes from the server (see bookpilot-lib/tracking.js).
// The demo keeps raw events and derives the same response shape, and a
// test asserts the two agree, so the screen is exercised honestly.

function demoTrackingEvents() {
  const utm = { source: "meta", medium: "paid", campaign: DEMO_CAMPAIGN.id };
  // A visit from a newsletter link: recorded, but with no BookPilot
  // campaign behind it, so it shows why attribution can be missing.
  const newsletter = { campaign_id: null, utm: { source: "newsletter", medium: "email", campaign: "september-issue" } };
  // Fixed ids: `uid` is declared further down the file and this runs as
  // the module loads.
  let n = 0;
  const row = (offset, event_type, value_cents = 0, extra = {}) => ({
    id: `d0000000-0000-4000-8000-0000000008${String(++n).padStart(2, "0")}`, site_id: DEMO_SITE_ID, event_type, value_cents, currency: "EUR",
    campaign_id: DEMO_CAMPAIGN.id, utm, occurred_at: ago(offset), ...extra,
  });
  return [
    row(1.2 * HOUR, "page_view"),
    row(1.4 * HOUR, "page_view"),
    row(3 * HOUR, "checkout"),
    row(3.1 * HOUR, "purchase", 899),
    row(9 * HOUR, "page_view", 0, newsletter),
    row(26 * HOUR, "page_view"),
    row(30 * HOUR, "add_to_cart"),
    row(51 * HOUR, "purchase", 899),
  ];
}

function demoTrackingStatus(state, site) {
  const isTest = (e) => e.utm?.source === "bookpilot" && e.utm?.medium === "test";
  const events = state.trackingEvents
    .filter((e) => e.site_id === site.id)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

  const counts = { page_view: 0, click: 0, add_to_cart: 0, checkout: 0, purchase: 0 };
  let revenue = 0, last24h = 0, lastReal = null;
  for (const e of events) {
    if (isTest(e)) continue;
    counts[e.event_type] += 1;
    if (e.event_type === "purchase") revenue += e.value_cents;
    if (Date.now() - Date.parse(e.occurred_at) <= 24 * HOUR) last24h += 1;
    lastReal = lastReal || e.occurred_at;
  }
  const summary = {
    counts, revenue_cents: revenue, last_24h: last24h,
    last_event_at: events[0]?.occurred_at || null,
    last_real_event_at: lastReal, capped: false,
  };
  const state_ = lastReal && Date.now() - Date.parse(lastReal) <= 7 * 24 * HOUR ? "receiving"
    : events.length ? (lastReal ? "quiet" : "tested") : "waiting";
  const params = new URLSearchParams({ utm_source: "bookpilot", utm_medium: "test", utm_campaign: "installation-check" });
  return {
    site: { id: site.id, domain: site.domain, is_active: true },
    health: { state: state_ },
    summary,
    test_url: `https://${site.domain}/?${params}`,
    recent: events.slice(0, 25).map((e) => ({
      id: e.id, occurred_at: e.occurred_at, event_type: e.event_type, value_cents: e.value_cents,
      currency: e.currency, attributed: Boolean(e.campaign_id), label: e.utm?.campaign || e.utm?.source || null,
      is_test: isTest(e),
    })),
  };
}

// --- Request routing --------------------------------------------------

async function handle(method, path, body) {
  // "/api/bp/books/123/strategy" -> ["", "api", "bp", "books", "123", "strategy"]
  const [, , section, resource, id, sub] = path.split("?")[0].split("/");
  const query = new URLSearchParams(path.split("?")[1] || "");

  // ---- Core -----------------------------------------------------------
  if (section === "bp") {
    if (resource === "config") {
      return {
        capabilities: { database: false, ai: false, billing: false, meta: false,
          imageGeneration: false, videoGeneration: false },
        plans: PLANS, creditCosts: CREDIT_COSTS, flags: { demo_mode: true }, auth: null,
      };
    }
    if (resource === "me") {
      if (sub === "export") {
        return { exported_at: new Date().toISOString(), format: "BookPilot AI demo export",
          profile: state.profile, books: state.books, creatives: state.creatives,
          campaigns: state.campaigns, tracking_events: [], notifications: state.notifications };
      }
      if (method === "PATCH") {
        Object.assign(state.profile, body);
        return { profile: state.profile };
      }
      return {
        profile: state.profile,
        plan: PLANS.find((p) => p.id === state.profile.plan_id),
        counts: {
          books: state.books.length,
          campaigns: state.campaigns.length,
          activeCampaigns: state.campaigns.filter((c) => c.status === "active").length,
          creatives: state.creatives.length,
          unreadNotifications: state.notifications.filter((n) => !n.read).length,
        },
      };
    }

    if (resource === "books") {
      if (method === "GET" && !id) return { books: state.books };
      if (method === "POST") {
        const book = {
          ...body, id: uid(), user_id: "demo", status: "draft", is_demo: true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        state.books.unshift(book);
        return { book };
      }
      const book = state.books.find((b) => b.id === id);
      if (!book) throw new DemoError("not_found", "We couldn't find that book.", 404);
      if (sub === "strategy") {
        return {
          analysis: state.analysis[id] || null,
          personas: state.personas.filter((p) => p.book_id === id),
          angles: state.angles.filter((a) => a.book_id === id),
        };
      }
      if (method === "PATCH") {
        Object.assign(book, body, { updated_at: new Date().toISOString() });
        return { book };
      }
      if (method === "DELETE") {
        state.books = state.books.filter((b) => b.id !== id);
        return { deleted: true };
      }
      return { book };
    }

    if (resource === "creatives") {
      if (method === "GET" && !id) {
        let list = state.creatives;
        const bookId = query.get("book_id");
        if (bookId) list = list.filter((c) => c.book_id === bookId);
        const platform = query.get("platform");
        if (platform) list = list.filter((c) => c.platform === platform);
        const format = query.get("format");
        if (format) list = list.filter((c) => c.format === format);
        return { creatives: list };
      }
      if (method === "POST") {
        const creative = { ...body, id: uid(), user_id: "demo", is_demo: true, status: "draft",
          score: null, body: body.body || {}, created_at: new Date().toISOString() };
        state.creatives.unshift(creative);
        return { creative };
      }
      const creative = state.creatives.find((c) => c.id === id);
      if (!creative) throw new DemoError("not_found", "We couldn't find that creative.", 404);
      if (method === "PATCH") { Object.assign(creative, body); return { creative }; }
      if (method === "DELETE") {
        state.creatives = state.creatives.filter((c) => c.id !== id);
        return { deleted: true };
      }
      return { creative };
    }

    if (resource === "campaigns") {
      if (method === "GET" && !id) return { campaigns: state.campaigns };
      if (method === "POST") {
        const campaign = {
          ...body, id: uid(), user_id: "demo", status: "draft", is_demo: true,
          currency: body.currency || "EUR", created_at: new Date().toISOString(),
        };
        state.campaigns.unshift(campaign);
        return { campaign };
      }
      const campaign = state.campaigns.find((c) => c.id === id);
      if (!campaign) throw new DemoError("not_found", "We couldn't find that campaign.", 404);
      if (sub === "performance") {
        const rows = campaignRows(id);
        return {
          campaign,
          totals: deriveMetrics(rows),
          websiteAttributed: deriveMetrics([]),
          daily: rows,
          perCreative: perCreative(id),
        };
      }
      if (method === "PATCH") { Object.assign(campaign, body); return { campaign }; }
      if (method === "DELETE") {
        state.campaigns = state.campaigns.filter((c) => c.id !== id);
        return { deleted: true };
      }
      return {
        campaign,
        adSets: state.adSets.filter((s) => s.campaign_id === id),
        ads: state.ads,
      };
    }

    if (resource === "analytics") {
      const rows = state.performance;
      return {
        days: Number(query.get("days")) || 30,
        totals: deriveMetrics(rows),
        campaigns: state.campaigns.map((c) => ({
          campaign: c,
          metrics: deriveMetrics(rows.filter((r) => r.campaign_id === c.id)),
        })),
        creatives: perCreative(DEMO_IDS.CAMPAIGN_ID).map((row) => ({
          creative: row.creative, metrics: row.metrics, confidence: row.confidence,
        })),
        amazon: null,
      };
    }

    if (resource === "notifications") {
      if (method === "GET") return { notifications: state.notifications };
      if (method === "POST") { state.notifications.forEach((n) => { n.read = true; }); return { ok: true }; }
      if (method === "PATCH") {
        const item = state.notifications.find((n) => n.id === id);
        if (item) item.read = true;
        return { notification: item };
      }
      if (method === "DELETE") {
        state.notifications = state.notifications.filter((n) => n.id !== id);
        return { deleted: true };
      }
    }

    if (resource === "recommendations") {
      if (method === "GET") {
        return { recommendations: state.recommendations.filter((r) => r.status === "open") };
      }
      if (method === "PATCH") {
        const item = state.recommendations.find((r) => r.id === id);
        if (item) item.status = body.status;
        return { recommendation: item };
      }
    }

    if (resource === "integrations") {
      if (method === "DELETE") return { disconnected: true };
      return {
        integrations: [],
        capabilities: { meta: false, billing: false, ai: false, database: false },
      };
    }

    if (resource === "tracking-sites") {
      if (method === "GET" && id && sub === "status") {
        const site = state.trackingSites.find((s) => s.id === id);
        if (!site) throw new DemoError("not_found", "We couldn't find that tracking site.", 404);
        return demoTrackingStatus(state, site);
      }
      // Demo only: there is no real website to visit, so let the screen
      // show what a received test visit looks like.
      if (method === "POST" && id && sub === "simulate-test") {
        state.trackingEvents.push({
          id: uid(), site_id: id, event_type: "page_view", value_cents: 0, currency: "EUR",
          campaign_id: null, utm: { source: "bookpilot", medium: "test", campaign: "installation-check" },
          occurred_at: new Date().toISOString(),
        });
        return { ok: true };
      }
      if (method === "GET") return { sites: state.trackingSites };
      if (method === "POST") {
        const site = { ...body, id: uid(), public_key: `bp_demo${Math.random().toString(16).slice(2, 12)}`,
          is_active: true, created_at: new Date().toISOString() };
        state.trackingSites.push(site);
        return { site };
      }
      if (method === "DELETE") {
        state.trackingSites = state.trackingSites.filter((s) => s.id !== id);
        return { deleted: true };
      }
    }
  }

  // ---- AI -------------------------------------------------------------
  if (section === "bp-ai") {
    await wait(700);
    switch (resource) {
      case "analyze": {
        const credits = spend("book_analysis");
        const analysis = { ...clone(DEMO_ANALYSIS), book_id: body.book_id, id: uid() };
        state.analysis[body.book_id] = analysis;
        const book = state.books.find((b) => b.id === body.book_id);
        if (book && book.status === "draft") book.status = "analyzed";
        return { analysis, creditsUsed: credits, demo: true };
      }
      case "personas": {
        const credits = spend("reader_personas");
        const personas = clone(DEMO_PERSONAS).map((p) => ({ ...p, id: uid(), book_id: body.book_id }));
        state.personas = state.personas.filter((p) => p.book_id !== body.book_id).concat(personas);
        return { personas, creditsUsed: credits, demo: true };
      }
      case "angles": {
        const credits = spend("marketing_angles");
        const personas = state.personas.filter((p) => p.book_id === body.book_id);
        const angles = clone(DEMO_ANGLES).map((a, index) => ({
          ...a, id: uid(), book_id: body.book_id,
          persona_id: personas[index % Math.max(personas.length, 1)]?.id || null,
        }));
        state.angles = state.angles.filter((a) => a.book_id !== body.book_id).concat(angles);
        return { angles, creditsUsed: credits, demo: true };
      }
      case "copy": {
        const credits = spend("ad_copy");
        const angle = state.angles.find((a) => a.id === body.angle_id);
        return {
          creditsUsed: credits, demo: true,
          variations: [
            { approach: "Reframe first, ask second", primary_text: angle?.hook || DEMO_ANGLES[0].hook,
              headline: angle?.name || "Starting over isn't failure",
              description: "Twelve chapters. Twelve decisions.", cta: "Read chapter one" },
            { approach: "Lead with the structure",
              primary_text: "Money, housing, work, who to tell — in that order, and here's why.",
              headline: "The order of operations", description: "A sequence, not a pep talk.",
              cta: "See the chapter list" },
            { approach: "Answer the objection",
              primary_text: "This is not another book about believing in yourself.",
              headline: "For readers who've read the encouraging ones",
              description: "Practical, chapter by chapter.", cta: "Look inside" },
          ],
        };
      }
      case "creatives": {
        const credits = spend(body.format === "reel" || body.format === "video_script" ? "video_concept" : "creative_concept");
        const source = DEMO_CREATIVES.filter((c) => c.format === body.format);
        const base = source.length ? source : DEMO_CREATIVES;
        const creatives = base.slice(0, body.count || 2).map((c) => ({
          ...clone(c), id: uid(), book_id: body.book_id, angle_id: body.angle_id || c.angle_id,
          platform: body.platform, format: body.format, status: "draft",
          created_at: new Date().toISOString(),
        }));
        state.creatives.unshift(...creatives);
        return { creatives, creditsUsed: credits, demo: true };
      }
      case "video-script": {
        const credits = spend("video_concept");
        const creative = {
          id: uid(), user_id: "demo", book_id: body.book_id, angle_id: body.angle_id || null,
          platform: body.platform || "instagram", format: "video_script",
          headline: "Starting over isn't failure — 30s",
          primary_text: "One decision a week. Twelve weeks. A year that looks nothing like this one.",
          description: "What if starting over isn't failure?",
          cta: "Read chapter one", visual_prompt: "Phone on a tripod, kitchen table, morning light. No crew needed.",
          body: {
            duration: 30,
            hook: "What if starting over isn't failure — but the beginning of your strongest chapter?",
            beats: [
              { timing: "0-3s", voiceover: "What if starting over isn't failure?", on_screen: "Starting over isn't failure", visual: "Hands closing a laptop" },
              { timing: "3-10s", voiceover: "Everyone prepares you for the day it happens. Nobody prepares you for the Tuesday after.", on_screen: "Nobody prepares you for the Tuesday", visual: "Empty kitchen table, one mug" },
              { timing: "10-20s", voiceover: "Twelve chapters. Twelve decisions. One you can make this week.", on_screen: "12 chapters · 12 decisions", visual: "Book opened to the contents page" },
              { timing: "20-30s", voiceover: "Start with the first one.", on_screen: "Read chapter one", visual: "Cover held in frame" },
            ],
          },
          score: null, status: "draft", is_demo: true, created_at: new Date().toISOString(),
        };
        state.creatives.unshift(creative);
        return { creative, creditsUsed: credits, demo: true };
      }
      case "score": {
        const credits = spend("creative_scoring");
        const creative = state.creatives.find((c) => c.id === body.creative_id);
        if (!creative) throw new DemoError("not_found", "We couldn't find that creative.", 404);
        if (!creative.score) {
          // A plausible but conservative score for a creative the demo
          // dataset doesn't already carry a review for.
          creative.score = 74;
          creative.score_detail = {
            kind: "predicted_quality",
            dimensions: { hook_strength: 76, clarity: 80, emotional_impact: 70, relevance: 78,
              cta_strength: 68, audience_fit: 75, visual_concept: 72, differentiation: 70 },
            strengths: ["Clear promise, matched to a specific reader."],
            improvements: ["The call to action could name what the reader gets."],
            scored_at: new Date().toISOString(),
          };
        }
        return { creative, creditsUsed: credits, demo: true };
      }
      case "analyze-campaign": {
        const credits = spend("performance_analysis");
        return { analysis: demoCampaignAnalysis(), creditsUsed: credits, demo: true };
      }
      case "budget": {
        const credits = spend("budget_recommendation");
        const campaign = state.campaigns.find((c) => c.id === body.campaign_id);
        const model = budgetRecommendation({
          currentDailyBudgetCents: campaign?.daily_budget_cents || 1000,
          metrics: deriveMetrics(campaignRows(body.campaign_id)),
        });
        if (!model) return { recommendation: null, reason: "Not enough data yet.", creditsUsed: 0, demo: true };
        return {
          creditsUsed: credits, demo: true,
          recommendation: {
            ...model,
            narrative: {
              conservative: "€9–€11/day", balanced: "€12–€13/day", aggressive: "€14–€15/day",
              reasoning:
                "Return on ad spend is comfortably above break-even, so a gradual increase is " +
                "defensible. Steps of 20–25% let Meta's delivery re-optimise without restarting " +
                "the learning phase.",
              caveat:
                "These are estimates from 20 days of data on one campaign. A larger budget " +
                "reaches a colder audience, so expect the cost per sale to rise before it settles.",
            },
          },
        };
      }
      case "advisor": {
        const credits = spend("advisor_message");
        return { ...demoAdvisorAnswer(body.question), creditsUsed: credits, demo: true };
      }
      case "patterns":
        return {
          enough_history: false, patterns: [], creditsUsed: 0, demo: true,
          note: "The demo workspace has one campaign. Patterns need at least three before they mean anything.",
        };
      default:
        throw new DemoError("not_found", "That isn't available in the demo.", 404);
    }
  }

  // ---- Billing --------------------------------------------------------
  if (section === "bp-billing") {
    if (resource === "summary" || !resource) {
      return {
        subscription: { plan_id: state.profile.plan_id, status: "demo" },
        plans: PLANS, credits: state.profile.ai_credits, planId: state.profile.plan_id,
        recentUsage: [], billingAvailable: false,
      };
    }
    throw new DemoError("demo_mode", "Checkout is disabled in the demo workspace.", 501);
  }

  // ---- Meta and admin -------------------------------------------------
  if (section === "bp-meta") {
    throw new DemoError(
      "demo_mode",
      "The demo workspace isn't connected to a Meta ad account — create a free account to connect yours.",
      501
    );
  }
  if (section === "bp-admin") {
    throw new DemoError("forbidden", "The admin dashboard isn't part of the demo.", 403);
  }

  // ---- Book Builder ---------------------------------------------------
  if (section === "bb" || section === "bb-ai") {
    if (section === "bb-ai") await wait(650);
    const segments = path.split("?")[0].split("/").filter(Boolean).slice(1);
    try {
      return handleBuilder(method, segments, body || {}, state.builder, {
        profile: state.profile,
        spend,
      });
    } catch (err) {
      // The builder module has its own error class; the adapter's callers
      // only know about this one.
      if (err instanceof BuilderError) throw new DemoError(err.code, err.message, err.status);
      throw err;
    }
  }

  throw new DemoError("not_found", "That isn't available in the demo.", 404);
}

export const demoAdapter = {
  async request(method, path, body) {
    // Small, uniform latency for reads so loading states are exercised.
    if (!path.startsWith("/api/bp-ai")) await wait(120);
    return handle(method, path, body);
  },

  /**
   * Building a book in the demo.
   *
   * Not simulated: this runs the real PDF, EPUB, DOCX and HTML writers
   * in the page. The file that downloads from the demo workspace is
   * produced by exactly the code the server would have run.
   */
  async exportBook(format, projectId) {
    await wait(400);
    try {
      return exportBookFromState(format, projectId, state.builder);
    } catch (err) {
      if (err instanceof BuilderError) throw new DemoError(err.code, err.message, err.status);
      throw err;
    }
  },
};
