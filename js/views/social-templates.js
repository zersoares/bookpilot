// Organic social post templates — one per network, each locked to the
// pixel size that network actually crops to. Unlike the paid-ad creative
// templates (creative-templates.js), nothing here goes near a campaign or
// an ad account: a "social post" is written and imaged for the author to
// post themselves, by hand, on their own Instagram/Facebook/LinkedIn/
// TikTok/X/Bluesky account. There is no publish integration for any of
// these — BookPilot has no OAuth app on five of the six — so the feature
// is deliberately "make the caption and the image, then download them."
//
// `platform` values here (linkedin, x, bluesky, plus the shared
// instagram/facebook/tiktok) must stay inside the server's allow-list in
// netlify/functions/bookpilot-lib/validate.js.

const dash = (value, fallback) => (value && String(value).trim()) || fallback;

function firstSentence(text, fallback) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  const stop = clean.search(/[.!?](\s|$)/);
  const sentence = stop === -1 ? clean : clean.slice(0, stop + 1);
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

function priceLabel(book) {
  if (book?.price_cents == null) return "";
  const amount = (book.price_cents / 100).toFixed(2);
  return `${amount} ${book.currency || "EUR"}`;
}

/**
 * The one true source for "what size is this post". Every number here is
 * the network's own current recommendation for an in-feed image post —
 * not a guess, and not the same number reused everywhere out of laziness.
 * `aspect` names the CSS modifier class in app.css that previews it at
 * the right shape (creativePreview's `aspect` option).
 */
export const PLATFORM_SIZES = {
  instagram: { label: "Instagram", kind: "Feed post", width: 1080, height: 1350, aspect: "" }, // 4:5, app.css default
  facebook: { label: "Facebook", kind: "Feed image", width: 1200, height: 630, aspect: "landscape" }, // 1.91:1
  linkedin: { label: "LinkedIn", kind: "Feed image", width: 1200, height: 627, aspect: "landscape" }, // 1.91:1
  tiktok: { label: "TikTok", kind: "Video cover", width: 1080, height: 1920, aspect: "reel" }, // 9:16
  x: { label: "X", kind: "Post image", width: 1600, height: 900, aspect: "wide" }, // 16:9
  bluesky: { label: "Bluesky", kind: "Post image", width: 1600, height: 900, aspect: "wide" }, // 16:9
};

export function sizeLabel(platform) {
  const spec = PLATFORM_SIZES[platform];
  return spec ? `${spec.width}×${spec.height}px · ${spec.kind}` : "";
}

// Bracketed gaps mark the one or two things only the author can supply —
// a real hashtag set for their niche, a real review — same convention as
// creative-templates.js.
export const SOCIAL_TEMPLATES = [
  {
    id: "instagram-cover-reveal",
    name: "Cover reveal",
    platform: "instagram",
    blurb: "The book as the whole post. Works for a launch, a re-release, or just reminding people it exists.",
    build: (book) => ({
      headline: dash(book.title, "[Title]"),
      primary_text: [
        dash(book.subtitle, firstSentence(book.description, "[One line on what it is.]")),
        "",
        priceLabel(book) ? `Out now — ${priceLabel(book)}. Link in bio.` : "Out now. Link in bio.",
      ].join("\n"),
      hashtags: ["#bookstagram", `#${dash(book.genre, "books").toLowerCase().replace(/[^a-z0-9]+/g, "")}`, "[your niche hashtags]"],
      visual_prompt:
        "The physical book on a plain surface in soft directional light, shot slightly above eye level. "
        + "One prop at most. Shallow depth of field, real shadow, nothing floating.",
    }),
  },
  {
    id: "facebook-announcement",
    name: "Launch announcement",
    platform: "facebook",
    blurb: "A link-share post for a Facebook author page or reader group.",
    build: (book) => ({
      headline: `${dash(book.title, "[Title]")} is out now`,
      primary_text: [
        firstSentence(book.description, "[One line on who this book is for.]"),
        "",
        priceLabel(book) ? `Available now — ${priceLabel(book)}. [Link]` : "Available now. [Link]",
      ].join("\n"),
      hashtags: [],
      visual_prompt:
        "Bold title card, cover secondary, calm brand-colour ground. One message only — no feature list.",
    }),
  },
  {
    id: "linkedin-milestone",
    name: "Author milestone",
    platform: "linkedin",
    blurb: "The professional-network version of a launch post — the story behind the book, not a sales pitch.",
    build: (book) => ({
      headline: `I wrote a book: ${dash(book.title, "[Title]")}`,
      primary_text: [
        "[Why you wrote it — the problem you kept seeing, the gap you couldn't find a book for.]",
        "",
        firstSentence(book.description, "[One line on what it covers.]"),
        "",
        priceLabel(book) ? `${dash(book.title, "It")} is out now, ${priceLabel(book)}. [Link in the comments.]`
          : `${dash(book.title, "It")} is out now. [Link in the comments.]`,
      ].join("\n"),
      hashtags: ["#writing", `#${dash(book.genre, "nonfiction").toLowerCase().replace(/[^a-z0-9]+/g, "")}`],
      visual_prompt:
        "Clean, editorial: the cover on a plain light surface beside a closed laptop or notebook, natural window "
        + "light, nothing that reads as an ad.",
    }),
  },
  {
    id: "tiktok-hook-cover",
    name: "Hook video cover",
    platform: "tiktok",
    blurb: "The still frame a talking-to-camera video opens and ends on — the video itself you record yourself.",
    build: (book) => ({
      headline: dash(book.title, "[Title]"),
      primary_text: [
        `A 15–30 second video for ${dash(book.title, "the book")}. Read the hook straight to camera, no music `
        + "under the first line.",
        "",
        `Hook: ${firstSentence(book.description, "[The one sentence that stops the scroll.]")}`,
      ].join("\n"),
      hashtags: ["#booktok", `#${dash(book.genre, "books").toLowerCase().replace(/[^a-z0-9]+/g, "")}`],
      visual_prompt:
        "Handheld vertical, natural light, author speaking directly to camera. The book held up on the final beat.",
    }),
  },
  {
    id: "x-launch-thread",
    name: "Launch thread opener",
    platform: "x",
    blurb: "The first post of a thread. Short — X still rewards a line that ends on a reason to keep reading.",
    build: (book) => ({
      headline: `${dash(book.title, "[Title]")} is out.`,
      primary_text: [
        firstSentence(book.description, "[One sharp sentence — the hook, not the blurb.]"),
        "",
        "A thread on what's in it 🧵",
      ].join("\n"),
      hashtags: [],
      visual_prompt:
        "The cover on a plain desk, shot straight-on, high contrast, crops well as a small timeline thumbnail.",
    }),
  },
  {
    id: "bluesky-reader-update",
    name: "Reader update",
    platform: "bluesky",
    blurb: "Casual, conversational — this is a community, not a storefront.",
    build: (book) => ({
      headline: dash(book.title, "[Title]"),
      primary_text: [
        `${dash(book.title, "My book")} is out now. ${firstSentence(book.description, "[One honest line on what it is.]")}`,
        "",
        "[Link, and maybe why you're glad it exists now.]",
      ].join("\n"),
      hashtags: [],
      visual_prompt:
        "Warm, unpolished-looking: the book on a bookshelf or desk, shot like a photo a person actually took, not a studio set.",
    }),
  },
];

export const sampleImagePath = (templateId) => `/assets/social/sample-${templateId}.webp`;

/** Is this URL one of the social template samples? */
export const isSampleImage = (url) => /\/assets\/social\/sample-([a-z-]+)\.webp(\?|#|$)/.test(String(url || ""));

/**
 * Build the POST body for `API.createCreative` from a social template + book.
 * `format` is always "static": these are single images, and the row's
 * `format` column only needs to distinguish shapes the detail view renders
 * differently (carousel slides, script beats) — a social post has neither.
 */
export function socialPostFromTemplate(template, book, { origin = globalThis.location?.origin } = {}) {
  const built = template.build(book || {});
  const caption = [built.primary_text, built.hashtags?.length ? built.hashtags.join(" ") : ""]
    .filter(Boolean)
    .join("\n\n");
  return {
    book_id: book.id,
    platform: template.platform,
    format: "static",
    status: "draft",
    headline: built.headline,
    primary_text: caption,
    visual_prompt: built.visual_prompt,
    body: { hashtags: built.hashtags || [], social_post: true, size: PLATFORM_SIZES[template.platform] },
    ...(origin ? { media_url: new URL(sampleImagePath(template.id), origin).href } : {}),
  };
}
