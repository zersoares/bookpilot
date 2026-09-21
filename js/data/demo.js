// Demo workspace data (spec §35, §52).
//
// One sample book — "The Modern Woman's Guide to Starting Over" — with
// the full chain of artefacts the product produces: analysis, personas,
// angles, creatives, a campaign, and twenty days of performance.
//
// Two rules govern this file:
//
//   1. Every screen that renders it shows a DEMO DATA badge. Simulated
//      advertising results must never be mistaken for real ones.
//   2. The numbers are internally consistent — the daily rows really do
//      add up to the headline figures, and every rate on screen is
//      derived from them by the same code that serves live campaigns.
//      A demo that lies about its own arithmetic teaches the wrong
//      thing about the product.
//
// The campaign, the creatives' performance and every number in this file are
// invented for the demo; none of it has sold anything. The cover is the real
// cover of the author's own published book, so the boxes show a real picture
// of the thing being advertised rather than a stand-in.

const BOOK_ID = "d0000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "d0000000-0000-4000-8000-000000000002";
const AD_SET_ID = "d0000000-0000-4000-8000-000000000003";

const cid = (n) => `d0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const pid = (n) => `d0000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const aid = (n) => `d0000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const adId = (n) => `d0000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;

export const DEMO_BOOK = {
  id: BOOK_ID,
  user_id: "demo",
  title: "The Modern Woman's Guide to Starting Over",
  subtitle: "A practical plan for the year after everything changed",
  author_name: "Demo Author",
  description:
    "A field guide for women rebuilding after a divorce, a redundancy, a move or a loss — " +
    "written for the part nobody prepares you for: the ordinary Tuesday when you have to " +
    "decide what happens next. Twelve chapters, each ending with a decision you can actually " +
    "make this week: money, work, housing, friendships, and the internal story that has to " +
    "change before any of it sticks.",
  genre: "Self-Help",
  subgenre: "Life transitions",
  price_cents: 899,
  currency: "EUR",
  sales_url: "https://example.com/starting-over",
  cover_url: "/assets/covers/modern-womans-guide.jpg",
  sample_text: null,
  author_bio: "Demo Author writes about work, money and second chapters.",
  reviews_text: null,
  target_countries: ["DE", "AT", "NL"],
  status: "promoting",
  created_at: "2026-01-08T09:12:00.000Z",
  updated_at: "2026-02-02T11:40:00.000Z",
  is_demo: true,
};

export const DEMO_ANALYSIS = {
  id: "d0000000-0000-4000-8000-000000000009",
  book_id: BOOK_ID,
  positioning:
    "A practical, unsentimental companion in a category dominated by encouragement. Most books " +
    "about starting over sell hope; this one sells a sequence. It sits between the memoir shelf " +
    "and the productivity shelf, and its buyer wants the second one without the first one's " +
    "corporate tone.",
  core_promise:
    "You will know what to do in the next seven days, and why that order and not another.",
  reader_problem:
    "The decisions arrive all at once — money, housing, work, who to tell — at exactly the " +
    "moment the reader has the least capacity to sequence them.",
  transformation:
    "From reacting to whatever is loudest, to working through a defensible order with a " +
    "reason behind each step.",
  themes: [
    "Rebuilding after loss",
    "Financial independence",
    "Identity after a role ends",
    "Practical sequencing over motivation",
    "Reclaiming agency",
  ],
  purchase_motivations: [
    "Wants a plan, not encouragement",
    "Wants to feel competent rather than rescued",
    "Recognises herself in the title",
    "Price is low enough to be an impulse purchase",
    "Recommended by someone who has been through it",
  ],
  objections: [
    "Assumes it will be motivational fluff",
    "Has read three books like this and acted on none",
    "Doesn't want to be seen buying a book about divorce",
    "Suspects the advice is written for a wealthier reader",
  ],
  opportunities: [
    "The word 'practical' is the differentiator — lead with it",
    "The seven-day framing is concrete enough to be an ad on its own",
    "Quiet, private-feeling creatives will outperform triumphant ones",
    "Test a chapter-list carousel: the structure is the proof",
  ],
  reasoning:
    "The description does something unusual for its category: it commits to specifics — twelve " +
    "chapters, a decision per chapter, named domains. That specificity is the asset. The " +
    "audience is not short of encouragement; it is short of sequence. Ads should therefore " +
    "sound like a competent friend with a list, and avoid the triumphant tone the category " +
    "defaults to.",
  model: "demo",
  created_at: "2026-01-08T09:20:00.000Z",
};

export const DEMO_PERSONAS = [
  {
    id: pid(1),
    book_id: BOOK_ID,
    name: "The Woman Rebuilding Her Life",
    age_range: "35-52",
    description:
      "Two years into a change she did not choose. Functioning, employed, and quietly " +
      "exhausted by the number of decisions still waiting.",
    demographics: "Urban and suburban, mid-career, often managing a household alone.",
    interests: ["Personal development", "Psychology", "Career change", "Personal finance", "Wellness"],
    pain_points: ["Feeling stuck", "Decision fatigue", "Uncertainty about the next 12 months"],
    desires: ["A clear order of operations", "Financial footing", "To feel capable again"],
    objections: ["Expects motivational filler", "Has bought books like this before"],
    triggers: ["Recognition", "Relief", "Competence"],
    motivations: ["Wants a plan she can start on Monday", "Wants to stop asking other people what to do"],
    messaging: "Starting over doesn't mean starting from nothing.",
    sort_order: 0,
  },
  {
    id: pid(2),
    book_id: BOOK_ID,
    name: "The Quiet Planner",
    age_range: "29-42",
    description:
      "Nothing has gone wrong yet. She is preparing for a change she can see coming and " +
      "would rather arrive with a plan than a crisis.",
    demographics: "Professional, plans holidays a year out, reads before acting.",
    interests: ["Personal finance", "Productivity", "Career development", "Non-fiction"],
    pain_points: ["Anticipating upheaval", "No framework for a life decision this size"],
    desires: ["To be prepared", "To keep her options open"],
    objections: ["Might feel the book is for someone further along than she is"],
    triggers: ["Foresight", "Control", "Preparedness"],
    motivations: ["Buys books to reduce future uncertainty"],
    messaging: "The plan you make before you need it is the one that works.",
    sort_order: 1,
  },
  {
    id: pid(3),
    book_id: BOOK_ID,
    name: "The Returning Professional",
    age_range: "38-55",
    description:
      "Coming back to work after years away. Competent, out of date on the mechanics, and " +
      "tired of being told to believe in herself.",
    demographics: "Re-entering the workforce, often after caring responsibilities.",
    interests: ["Career development", "Leadership", "Business books", "Learning"],
    pain_points: ["A CV gap she can't explain away", "Sector moved on", "Confidence dented"],
    desires: ["A credible route back", "Language for the gap"],
    objections: ["Wants career specifics, not general life advice"],
    triggers: ["Recognition", "Practicality"],
    motivations: ["Buying a route back into paid work"],
    messaging: "You didn't lose the skill. You lost the map.",
    sort_order: 2,
  },
  {
    id: pid(4),
    book_id: BOOK_ID,
    name: "The Gift Buyer",
    age_range: "30-60",
    description:
      "Buying for a sister or a friend going through it. Wants something useful that doesn't " +
      "read as a diagnosis.",
    demographics: "Buys books as gifts several times a year.",
    interests: ["Books and reading", "Gifts", "Wellness"],
    pain_points: ["Wants to help without overstepping"],
    desires: ["Something practical and kind"],
    objections: ["Worries the title is too on-the-nose as a gift"],
    triggers: ["Care", "Usefulness"],
    motivations: ["Wants to send something better than a message"],
    messaging: "For the friend who says she's fine and keeps rearranging the same three problems.",
    sort_order: 3,
  },
];

export const DEMO_ANGLES = [
  { id: aid(1), name: "Starting Over Is Not Failure", category: "emotional", persona_id: pid(1),
    explanation: "Reframes the reader's situation before asking for anything. Removes the shame that stops the click.",
    hook: "What if starting over isn't failure — but the beginning of your strongest chapter?",
    message: "The end of one plan is not the end of your competence.", cta: "Read the first chapter",
    format_hint: "Instagram Reel" },
  { id: aid(2), name: "The Seven-Day Version", category: "practical", persona_id: pid(1),
    explanation: "Leads with the book's most concrete promise: a defensible order of operations.",
    hook: "Twelve chapters. Twelve decisions. One you can make this week.",
    message: "A sequence, not a pep talk.", cta: "See the chapter list", format_hint: "Carousel" },
  { id: aid(3), name: "Nobody Prepares You For The Tuesday", category: "storytelling", persona_id: pid(1),
    explanation: "Specific, unglamorous detail beats abstract empathy in this category.",
    hook: "Everyone prepares you for the day it happens. Nobody prepares you for the Tuesday after.",
    message: "This book is about the ordinary week that follows.", cta: "Read a sample", format_hint: "Instagram Story" },
  { id: aid(4), name: "The Plan Before You Need It", category: "curiosity", persona_id: pid(2),
    explanation: "Speaks to the reader who isn't in crisis yet — a larger audience than the one that is.",
    hook: "The best time to write the plan is before you need it.",
    message: "Preparation is not pessimism.", cta: "Look inside", format_hint: "Facebook ad" },
  { id: aid(5), name: "You Didn't Lose The Skill", category: "identity", persona_id: pid(3),
    explanation: "Names the returning professional's actual fear instead of the generic one.",
    hook: "You didn't lose the skill. You lost the map.",
    message: "A credible route back to paid work.", cta: "Read chapter four", format_hint: "Feed ad" },
  { id: aid(6), name: "The Order Of Operations", category: "educational", persona_id: pid(1),
    explanation: "Teaching one useful idea in the ad earns the click for the rest.",
    hook: "Money first, then housing, then work. Here's why that order and not the other one.",
    message: "The sequence is the whole method.", cta: "Get the framework", format_hint: "Carousel" },
  { id: aid(7), name: "Not Another Book About Believing In Yourself", category: "contrarian", persona_id: pid(1),
    explanation: "Directly answers the objection that stops this reader buying.",
    hook: "This is not another book about believing in yourself.",
    message: "Confidence is an outcome of competence, not a prerequisite.", cta: "See what's inside",
    format_hint: "Instagram Reel" },
  { id: aid(8), name: "The Question Behind The Question", category: "problem_solution", persona_id: pid(1),
    explanation: "Turns a diffuse feeling into a specific, answerable problem.",
    hook: "It isn't that you don't know what to do. It's that everything is due at once.",
    message: "Sequencing is the skill nobody taught you.", cta: "Start reading", format_hint: "Feed ad" },
  { id: aid(9), name: "For The Friend Who Says She's Fine", category: "emotional", persona_id: pid(4),
    explanation: "Opens the gift-buying audience without making the recipient a project.",
    hook: "For the friend who says she's fine and keeps rearranging the same three problems.",
    message: "Practical and kind, in that order.", cta: "Send it to her", format_hint: "Instagram Story" },
  { id: aid(10), name: "One Decision A Week", category: "transformation", persona_id: pid(1),
    explanation: "Makes the change feel small enough to start and large enough to matter.",
    hook: "One decision a week. Twelve weeks. A year that looks nothing like this one.",
    message: "Small, ordered decisions compound.", cta: "Begin week one", format_hint: "Instagram Reel" },
  { id: aid(11), name: "What The First Chapter Asks Of You", category: "curiosity", persona_id: pid(2),
    explanation: "Curiosity anchored to something real, so the click isn't a bait-and-switch.",
    hook: "Chapter one asks one question. Most people get it wrong on the first try.",
    message: "Start where the book starts.", cta: "Read chapter one", format_hint: "Story" },
  { id: aid(12), name: "The Ordinary Competence Angle", category: "inspirational", persona_id: pid(3),
    explanation: "Quiet aspiration rather than triumph; matches how this reader wants to be seen.",
    hook: "Not a comeback story. A competent Tuesday, repeated.",
    message: "Rebuilding is a practice, not an event.", cta: "Read a sample", format_hint: "Feed ad" },
].map((angle) => ({ ...angle, book_id: BOOK_ID, score: null, created_at: "2026-01-09T10:00:00.000Z" }));

// AI-generated concept images (SDXL, run locally in ComfyUI), one per demo
// creative, written from that creative's own visual_prompt. They show the
// scene and the light; they are not finished ad artwork, and the card says so.
const DEMO_CREATIVE_IMAGES = {
  [cid(1)]: { url: "/assets/creatives/demo-1.webp",
    alt: "A sunlit kitchen table with an open laptop, a stoneware mug and a plant by the window." },
  [cid(2)]: { url: "/assets/creatives/demo-2.webp",
    alt: "Blank cream cards fanned out on a terracotta-toned surface beside small bowls and dried grasses." },
  [cid(3)]: { url: "/assets/creatives/demo-3.webp",
    alt: "An open lined notebook and a small sand-coloured book on rumpled linen." },
  [cid(4)]: { url: "/assets/creatives/demo-4.webp",
    alt: "A kitchen table in soft morning light with an open diary, a pen, a mug and a notebook." },
  [cid(5)]: { url: "/assets/creatives/demo-5.webp",
    alt: "A tidy desk seen from above with an open laptop, a notebook and a printed page." },
};

export const DEMO_CREATIVES = [
  {
    id: cid(1), angle_id: aid(1), persona_id: pid(1), platform: "instagram", format: "reel",
    headline: "Starting over isn't failure",
    primary_text:
      "What if starting over isn't failure — but the beginning of your strongest chapter? " +
      "Twelve chapters, twelve decisions, one you can make this week.",
    description: "Starting over doesn't mean starting from nothing.",
    cta: "Read the first chapter",
    visual_prompt:
      "Handheld vertical shot, early morning kitchen, natural window light, a woman's hands " +
      "closing a laptop and picking up a pen. Warm neutral palette, no faces. On-screen text " +
      "appears one line at a time in a clean serif. Final frame: the book cover on the table, " +
      "held for two seconds.",
    score: 87,
    score_detail: {
      kind: "predicted_quality",
      dimensions: { hook_strength: 90, clarity: 88, emotional_impact: 91, relevance: 89,
        cta_strength: 74, audience_fit: 90, visual_concept: 85, differentiation: 82 },
      strengths: [
        "The hook reframes shame before asking for anything, which is the barrier in this category.",
        "Visual restraint matches how this reader wants to be seen — no triumph, no crying.",
      ],
      improvements: ["\"Read the first chapter\" would convert harder as \"Read chapter one free\"."],
    },
  },
  {
    id: cid(2), angle_id: aid(2), persona_id: pid(1), platform: "instagram", format: "carousel",
    headline: "Twelve chapters. Twelve decisions.",
    primary_text:
      "Money. Housing. Work. Who to tell. They all arrive at once — and that's the actual " +
      "problem. This is the order, and why.",
    description: "A sequence, not a pep talk.",
    cta: "See the chapter list",
    visual_prompt:
      "Six slides, editorial magazine layout. Cream ground, one chapter title per slide in large " +
      "serif with a single line of body copy beneath. Slide six: the cover with the subtitle.",
    body: {
      slides: [
        { label: "Slide 1", visual: "Cream ground, large serif", text: "Everything is due at once." },
        { label: "Slide 2", visual: "Chapter card", text: "1. Money, before anything else." },
        { label: "Slide 3", visual: "Chapter card", text: "2. Where you sleep in ninety days." },
        { label: "Slide 4", visual: "Chapter card", text: "4. The version of your CV that's true." },
        { label: "Slide 5", visual: "Chapter card", text: "7. Who actually needs to be told." },
        { label: "Slide 6", visual: "Cover on cream", text: "One decision a week. Start with the first." },
      ],
    },
    score: 79,
    score_detail: {
      kind: "predicted_quality",
      dimensions: { hook_strength: 74, clarity: 90, emotional_impact: 66, relevance: 86,
        cta_strength: 80, audience_fit: 84, visual_concept: 78, differentiation: 81 },
      strengths: ["The chapter list is the proof — showing structure beats describing it."],
      improvements: [
        "Slide one is a statement, not a hook. Turning it into a question would earn the swipe.",
      ],
    },
  },
  {
    id: cid(3), angle_id: aid(7), persona_id: pid(1), platform: "facebook", format: "static",
    headline: "Not another book about believing in yourself",
    primary_text:
      "Confidence isn't the thing you need first. A defensible order of operations is. " +
      "Twelve chapters, each ending in a decision you can make this week.",
    description: "For the reader who has already read the encouraging ones.",
    cta: "See what's inside",
    visual_prompt:
      "Flat editorial composition. The book laid on a linen surface beside a handwritten list " +
      "with three items ticked. Muted daylight, deep shadow at the left edge. No stock-photo " +
      "smiling.",
    score: 72,
    score_detail: {
      kind: "predicted_quality",
      dimensions: { hook_strength: 80, clarity: 78, emotional_impact: 62, relevance: 79,
        cta_strength: 66, audience_fit: 74, visual_concept: 70, differentiation: 88 },
      strengths: ["Answers the objection directly, which is rare in this category."],
      improvements: [
        "The negative framing risks reading as a swipe at books the reader liked.",
        "\"See what's inside\" is vague — name what she'll see.",
      ],
    },
  },
  {
    id: cid(4), angle_id: aid(3), persona_id: pid(1), platform: "instagram", format: "story",
    headline: "Nobody prepares you for the Tuesday",
    primary_text:
      "Everyone prepares you for the day it happens. Nobody prepares you for the Tuesday after.",
    description: "The book about the ordinary week that follows.",
    cta: "Read a sample",
    visual_prompt:
      "Single vertical frame. An unremarkable weekday kitchen table at 7am — one mug, a phone " +
      "face down, a diary open on a blank page. Text set low in the frame, small.",
    score: 84,
    score_detail: {
      kind: "predicted_quality",
      dimensions: { hook_strength: 88, clarity: 82, emotional_impact: 89, relevance: 86,
        cta_strength: 70, audience_fit: 88, visual_concept: 86, differentiation: 84 },
      strengths: [
        "The specific detail — a Tuesday — does more work than any abstract statement of empathy.",
      ],
      improvements: ["A story needs a tap target the eye lands on; the CTA sits too low."],
    },
  },
  {
    id: cid(5), angle_id: aid(5), persona_id: pid(3), platform: "facebook", format: "static",
    headline: "You didn't lose the skill. You lost the map.",
    primary_text:
      "Coming back to work after years away isn't a confidence problem. It's a navigation " +
      "problem. Chapter four is the map.",
    description: "For readers returning to work.",
    cta: "Read chapter four",
    visual_prompt:
      "A desk from directly above: laptop, notebook, a printed CV with one line circled. " +
      "Cool daylight, high contrast, no people.",
    score: 68,
    score_detail: {
      kind: "predicted_quality",
      dimensions: { hook_strength: 78, clarity: 74, emotional_impact: 64, relevance: 62,
        cta_strength: 72, audience_fit: 60, visual_concept: 66, differentiation: 70 },
      strengths: ["Strong, specific hook for a returning professional."],
      improvements: [
        "This audience is a fraction of the book's buyers — expect a smaller pool and higher CPM.",
        "The promise is career-specific while the book is broader; some clicks will bounce.",
      ],
    },
  },
].map((creative) => ({
  ...creative,
  user_id: "demo",
  book_id: BOOK_ID,
  body: { ...creative.body, ...(DEMO_CREATIVE_IMAGES[creative.id] && { image_alt: DEMO_CREATIVE_IMAGES[creative.id].alt }) },
  media_url: DEMO_CREATIVE_IMAGES[creative.id]?.url ?? null,
  status: "in_campaign",
  is_demo: true,
  created_at: "2026-01-12T09:00:00.000Z",
  updated_at: "2026-01-12T09:00:00.000Z",
}));

export const DEMO_CAMPAIGN = {
  id: CAMPAIGN_ID,
  user_id: "demo",
  book_id: BOOK_ID,
  name: "Starting Over — angle test",
  platform: "meta",
  objective: "conversions",
  daily_budget_cents: 1000,
  currency: "EUR",
  start_date: "2026-01-14",
  end_date: null,
  destination_type: "website",
  destination_url: "https://example.com/starting-over",
  status: "active",
  status_detail: null,
  external_campaign_id: null,
  is_demo: true,
  launched_at: "2026-01-14T08:00:00.000Z",
  created_at: "2026-01-13T16:30:00.000Z",
  updated_at: "2026-02-02T06:00:00.000Z",
};

export const DEMO_AD_SETS = [
  {
    id: AD_SET_ID,
    campaign_id: CAMPAIGN_ID,
    persona_id: pid(1),
    name: "The Woman Rebuilding Her Life",
    audience: { persona: "The Woman Rebuilding Her Life", countries: ["DE", "AT", "NL"], age: "35-52" },
    daily_budget_cents: 1000,
    external_id: null,
    status: "active",
  },
];

export const DEMO_ADS = DEMO_CREATIVES.map((creative, index) => ({
  id: adId(index + 1),
  ad_set_id: AD_SET_ID,
  creative_id: creative.id,
  name: creative.headline,
  external_id: null,
  status: "active",
}));

/**
 * Twenty days of delivery, distributed across the five creatives.
 *
 * The per-creative totals below are the only "opinion" in the dataset:
 * creative #1 is the winner, #5 is the one that spent without
 * converting. They add up to a coherent headline set — €110.00 spend,
 * €422.53 revenue, 47 sales, 904 clicks, 32,286 impressions — which the
 * shared metrics code then derives into 2.80% CTR, €0.12 CPC, €2.34
 * CPA, 5.20% conversion rate and 3.84x ROAS.
 *
 * Totals are distributed across days by largest-remainder rounding, so
 * the daily rows sum to exactly those figures rather than approximately.
 * The demo is deterministic: it looks the same on every load, which
 * matters when a screenshot ends up in a support conversation.
 */
function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  // Hand the leftover units to the days with the largest fractions.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

function buildPerformance() {
  // impressions / clicks / conversions / spend in cents, per creative
  const totals = [
    { creative: 0, impressions: 9686, clicks: 300, conversions: 24, spend: 3300 },
    { creative: 1, impressions: 7749, clicks: 220, conversions: 11, spend: 2640 },
    { creative: 2, impressions: 5811, clicks: 150, conversions: 6, spend: 1980 },
    { creative: 3, impressions: 6457, clicks: 190, conversions: 6, spend: 2200 },
    { creative: 4, impressions: 2583, clicks: 44, conversions: 0, spend: 880 },
  ];
  const priceCents = 899;
  const days = 20;
  const startDate = new Date("2026-01-14T00:00:00Z");

  // A gentle ramp: Meta's learning phase means day one never looks like
  // day twenty, and a flat line would teach an author the wrong shape.
  const dayWeights = Array.from({ length: days }, (_, d) => 0.6 + (d / (days - 1)) * 0.8);

  const rows = [];
  for (const t of totals) {
    const impressions = distribute(t.impressions, dayWeights);
    const clicks = distribute(t.clicks, dayWeights);
    const conversions = distribute(t.conversions, dayWeights);
    const spend = distribute(t.spend, dayWeights);
    for (let d = 0; d < days; d += 1) {
      rows.push({
        campaign_id: CAMPAIGN_ID,
        ad_id: DEMO_ADS[t.creative].id,
        metric_date: new Date(startDate.getTime() + d * 86_400_000).toISOString().slice(0, 10),
        source: "demo",
        impressions: impressions[d],
        reach: Math.round(impressions[d] * 0.72),
        clicks: clicks[d],
        spend_cents: spend[d],
        conversions: conversions[d],
        revenue_cents: conversions[d] * priceCents,
        units_sold: conversions[d],
      });
    }
  }
  return rows;
}

export const DEMO_PERFORMANCE = buildPerformance();

export const DEMO_NOTIFICATIONS = [
  {
    id: "d0000000-0000-4000-8000-000000000501",
    type: "winner",
    title: "🔥 Strong performer detected",
    message: "“Starting over isn't failure” is converting well above the other creatives in this campaign.",
    link: "#/campaigns/" + CAMPAIGN_ID,
    read: false,
    created_at: "2026-02-01T07:30:00.000Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000502",
    type: "weak",
    title: "⚠️ Creative needs attention",
    message: "“You didn't lose the skill” has taken clicks without a recorded sale. Worth pausing or reworking.",
    link: "#/creatives",
    read: false,
    created_at: "2026-01-30T07:30:00.000Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000503",
    type: "campaign_launched",
    title: "Campaign launched",
    message: "“Starting Over — angle test” went live with a €10/day budget.",
    link: "#/campaigns/" + CAMPAIGN_ID,
    read: true,
    created_at: "2026-01-14T08:00:00.000Z",
  },
];

export const DEMO_RECOMMENDATIONS = [
  {
    id: "d0000000-0000-4000-8000-000000000601",
    campaign_id: CAMPAIGN_ID,
    creative_id: cid(1),
    kind: "increase",
    title: "Shift budget towards “Starting over isn't failure”",
    reason:
      "It has the campaign's lowest cost per sale over enough clicks to be worth acting on, " +
      "while the weakest creative is drawing spend without converting.",
    metrics: { supporting: "Best creative: 24 sales from 300 clicks (€1.38 per sale). Weakest: 0 sales from 44 clicks." },
    confidence: "medium",
    action: "Move roughly 20% of the daily budget from the weakest creative to this one.",
    status: "open",
    created_at: "2026-02-01T07:30:00.000Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000602",
    campaign_id: CAMPAIGN_ID,
    creative_id: cid(5),
    kind: "pause",
    title: "Pause “You didn't lose the skill”",
    reason:
      "It has spent without a single recorded sale. The audience it targets is a narrow slice " +
      "of the book's buyers, which the score already flagged before launch.",
    metrics: { supporting: "44 clicks, 0 conversions, €8.80 spent over 20 days." },
    confidence: "medium",
    action: "Pause it and reinvest in the returning-professional angle as its own campaign later.",
    status: "open",
    created_at: "2026-01-30T07:30:00.000Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000603",
    campaign_id: CAMPAIGN_ID,
    creative_id: null,
    kind: "test",
    title: "Test three variations of the winning hook",
    reason:
      "One winner is a result; three variations of it is a method. Creative fatigue usually " +
      "shows up in weeks three to four on a budget this size.",
    metrics: { supporting: "Winning hook: “What if starting over isn't failure…”" },
    confidence: "high",
    action: "Generate three reel variations from the same angle and add them to the campaign.",
    status: "open",
    created_at: "2026-02-02T07:30:00.000Z",
  },
];

export const DEMO_PROFILE = {
  id: "demo-user",
  email: "demo@bookpilot.ai",
  full_name: "Demo Author",
  country: "DE",
  currency: "EUR",
  language: "en",
  author_type: "author",
  genres: ["Self-Help", "Personal Development"],
  role: "user",
  plan_id: "author_pro",
  ai_credits: 74,
  onboarding_step: 6,
  primary_goal: "Sell more books",
  daily_budget_cents: 1000,
  marketing_consent: false,
  analytics_consent: false,
};

export const DEMO_IDS = { BOOK_ID, CAMPAIGN_ID, AD_SET_ID };
