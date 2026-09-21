// Starter creative templates.
//
// These are ad structures, not AI output: picking one writes a draft
// creative straight into the library, pre-filled from the book, with no
// generation and no credits spent. The point is that a new account has
// something to edit on day one instead of an empty page — and that the
// structures themselves teach the shape of an ad that works.
//
// Every `format` and `platform` here must stay inside the server's
// allow-lists in netlify/functions/bookpilot-lib/validate.js.

const dash = (value, fallback) => (value && String(value).trim()) || fallback;

/** First sentence of the book description, for use as a hook. */
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

// Bracketed gaps are deliberate: they mark the one or two things only the
// author can supply, so the draft reads as unfinished rather than wrong.
export const CREATIVE_TEMPLATES = [
  {
    id: "problem-promise-proof",
    name: "Problem → Promise → Proof",
    blurb: "The workhorse direct-response structure. Name the reader's problem, promise the shift, back it with proof.",
    format: "static",
    platform: "meta",
    cta: "Learn more",
    build: (book) => ({
      headline: `Still stuck on ${dash(book.subgenre || book.genre, "the same problem")}?`,
      primary_text: [
        `${firstSentence(book.description, "You know the problem well enough to be tired of it.")}`,
        "",
        `${dash(book.title, "This book")} takes you from that to a clear next step — without the usual filler.`,
        "",
        "[One line of proof: a review quote, a number, or who it has already helped.]",
      ].join("\n"),
      description: dash(book.subtitle, "A practical read for people who want the shift, not the theory."),
      visual_prompt:
        "Split composition: the frustrating 'before' on the left in muted tones, the calm 'after' on the right in warm light. "
        + "Book cover placed in the after half. No text baked into the image — the copy carries the message.",
    }),
  },
  {
    id: "hook-stakes-call",
    name: "Hook → Stakes → Call",
    blurb: "A 15-second vertical video script: open on tension, raise what it costs to ignore, close on the action.",
    format: "reel",
    platform: "instagram",
    cta: "Shop now",
    build: (book) => ({
      headline: dash(book.title, "Your book"),
      primary_text:
        `A short vertical video for ${dash(book.title, "the book")}. Read it straight to camera, no music bed under the first line.`,
      description: "15 seconds. Hook in the first two.",
      visual_prompt:
        "Handheld vertical, natural light, author speaking directly to camera. Cut to the book in hand on the final beat.",
      // Keys must match the detail view and the export in creatives.js:
      // timing / voiceover / on_screen / visual.
      body: {
        beats: [
          { timing: "0:00–0:02", voiceover: firstSentence(book.description, "[The one sentence that stops the scroll.]"),
            on_screen: "[Hook as text, 5 words max]", visual: "Straight to camera, no cut." },
          { timing: "0:02–0:08", voiceover: "[What it costs to keep doing it the current way.]",
            on_screen: "", visual: "Cut wider, or to a hand-held detail." },
          { timing: "0:08–0:12", voiceover: `That is what ${dash(book.title, "this book")} is for.`,
            on_screen: dash(book.title, ""), visual: "Book enters frame." },
          { timing: "0:12–0:15", voiceover: "[The action — link in bio, out now, read the first chapter free.]",
            on_screen: priceLabel(book) || "Out now", visual: "Hold on the cover." },
        ],
      },
    }),
  },
  {
    id: "quote-card",
    name: "Quote card",
    blurb: "One line from the book, set well. The cheapest ad to make and often the most shared.",
    format: "quote",
    platform: "instagram",
    cta: "Learn more",
    build: (book) => ({
      headline: "[The one line from the book worth quoting]",
      primary_text: [
        "[Paste the line here — a sentence that stands alone without context.]",
        "",
        `— ${dash(book.author_name, "[Author]")}, ${dash(book.title, "[Title]")}`,
      ].join("\n"),
      description: dash(book.subtitle, ""),
      visual_prompt:
        "Typographic only. Generous margins, one serif line set large, off-white ground, small author credit beneath. "
        + "No stock photography, no cover — the sentence is the whole image.",
    }),
  },
  {
    id: "myth-truth-book",
    name: "Myth → Truth → Book",
    blurb: "Three-slide carousel that corrects a belief the reader holds. Earns the swipe by disagreeing.",
    format: "carousel",
    platform: "meta",
    cta: "Learn more",
    build: (book) => ({
      headline: `What most people get wrong about ${dash(book.genre, "this")}`,
      primary_text: `Three slides. Swipe to the correction, then to ${dash(book.title, "the book")}.`,
      description: dash(book.subtitle, ""),
      visual_prompt:
        "Three slides sharing one grid and palette. Slide 1 sets the myth in heavy type; slide 2 answers it; "
        + "slide 3 is the cover with a single line of copy. Consistent margins so the swipe feels like one object.",
      // Keys must match the detail view and the export: label / text / visual.
      body: {
        slides: [
          { label: "Slide 1 · The myth", text: "[The myth, stated as most people would say it]",
            visual: "Heavy type, single colour ground." },
          { label: "Slide 2 · The correction", text: firstSentence(book.description, "[What is actually true, and how you know.]"),
            visual: "Same grid, inverted palette so the swipe registers." },
          { label: "Slide 3 · The book", text: `${dash(book.title, "[Title]")} — ${dash(book.subtitle, "[what the reader gets]")}${priceLabel(book) ? ` · ${priceLabel(book)}` : ""}`,
            visual: "Cover, one line of copy, clear call to action." },
        ],
      },
    }),
  },
  {
    id: "cover-reveal",
    name: "Cover reveal / mockup",
    blurb: "The book as a physical object. Works for launches and for readers who need to see the thing.",
    format: "mockup",
    platform: "instagram",
    cta: "Shop now",
    build: (book) => ({
      headline: dash(book.title, "[Title]"),
      primary_text: [
        dash(book.subtitle, firstSentence(book.description, "[One line on what it is.]")),
        "",
        priceLabel(book) ? `Out now — ${priceLabel(book)}.` : "Out now.",
      ].join("\n"),
      description: `By ${dash(book.author_name, "[Author]")}`,
      visual_prompt:
        "The physical book on a plain surface in soft directional light, shot slightly above eye level. "
        + "One prop at most. Shallow depth of field, real shadow, nothing floating.",
    }),
  },
  {
    id: "reader-review",
    name: "Reader review",
    blurb: "Social proof as the whole ad. Use a real review — never invent one.",
    format: "static",
    platform: "facebook",
    cta: "Learn more",
    build: (book) => ({
      headline: "[The most useful line from a real review]",
      primary_text: [
        "[Paste a genuine reader review here. Attribute it honestly — first name and source is enough.]",
        "",
        `${dash(book.title, "[Title]")} — ${dash(book.subtitle, "[what it does for the reader]")}.`,
      ].join("\n"),
      description: priceLabel(book) ? `Available now, ${priceLabel(book)}.` : "Available now.",
      visual_prompt:
        "Review set as large quoted text on a clean ground, star rating small beneath, cover thumbnail bottom-right. "
        + "Restrained and credible — nothing that reads as an advert for itself.",
    }),
  },
  {
    id: "launch-offer",
    name: "Launch or offer",
    blurb: "A dated reason to buy now. Only use it when the deadline is real.",
    format: "promo",
    platform: "meta",
    cta: "Shop now",
    build: (book) => ({
      headline: priceLabel(book) ? `${dash(book.title, "[Title]")} — ${priceLabel(book)}` : dash(book.title, "[Title]"),
      primary_text: [
        `${dash(book.title, "[Title]")} is out now.`,
        "",
        firstSentence(book.description, "[One line on who it is for.]"),
        "",
        "[The offer and its end date — leave this out rather than inventing urgency.]",
      ].join("\n"),
      description: dash(book.subtitle, ""),
      visual_prompt:
        "Bold price or offer as the dominant element, cover secondary, high-contrast brand colour ground. "
        + "One message only — no feature list.",
    }),
  },
  {
    id: "first-page",
    name: "First page hook",
    blurb: "Let the writing sell the writing. Strongest for fiction and memoir.",
    format: "story",
    platform: "instagram",
    cta: "Learn more",
    build: (book) => ({
      headline: "[The first line of the book]",
      primary_text: [
        "[Paste the opening two or three sentences. Stop mid-scene — the cut is the ad.]",
        "",
        `${dash(book.title, "[Title]")}, ${dash(book.author_name, "[Author]")}.`,
      ].join("\n"),
      description: "Full-screen vertical.",
      visual_prompt:
        "Full-bleed vertical, book text set as if on the page, one line highlighted. Paper texture, warm light from the top left.",
    }),
  },
];

// ---------------------------------------------------------------------
// Sample images
//
// One AI-generated picture per template, made from that template's own art
// direction (no people, no text) so a template can be seen before it is used,
// and a draft made from it does not start as a blank box. They are samples of
// the look, not artwork for anyone's book: the box says "Sample image", and the
// book's own cover is drawn on top by creativePreview().
// ---------------------------------------------------------------------

const SAMPLE_ALT = {
  "problem-promise-proof": "A cluttered grey desk on one side and a tidy, sunlit desk on the other.",
  "hook-stakes-call": "A phone on a small tripod facing an empty armchair in warm morning light.",
  "quote-card": "Off-white handmade paper with a single pencil and plenty of empty space.",
  "myth-truth-book": "Three blank cream cards laid in a row on a warm grey surface.",
  "cover-reveal": "An empty stone surface in soft window light, ready for a book.",
  "reader-review": "A calm cream background with a small plant and a cup of tea.",
  "launch-offer": "A deep indigo studio backdrop with a few small golden confetti pieces.",
  "first-page": "A close-up of an open paperback page in warm light.",
};

export const sampleImagePath = (templateId) => `/assets/creatives/sample-${templateId}.webp`;

/** Is this URL one of the template samples? (Matches the path, whatever the origin.) */
export const isSampleImage = (url) => /\/assets\/creatives\/sample-([a-z-]+)\.webp(\?|#|$)/.test(String(url || ""));

/** Alt text for a sample image URL, or "" for anything else. */
export function sampleAltFor(url) {
  const id = String(url || "").match(/\/assets\/creatives\/sample-([a-z-]+)\.webp/)?.[1];
  return (id && SAMPLE_ALT[id]) || "";
}

/** Every template has a sample and an alt text for it. */
export const SAMPLE_TEMPLATE_IDS = Object.keys(SAMPLE_ALT);

/**
 * Build the POST body for `API.createCreative` from a template + book.
 *
 * The draft starts with the template's sample image so its box is not blank.
 * The server wants a full web address, so the path is made absolute against the
 * page's own origin; outside a browser (tests) there is none and it is left out.
 */
export function creativeFromTemplate(template, book, { origin = globalThis.location?.origin } = {}) {
  const built = template.build(book || {});
  return {
    book_id: book.id,
    platform: template.platform,
    format: template.format,
    cta: template.cta,
    status: "draft",
    ...(origin ? { media_url: new URL(sampleImagePath(template.id), origin).href } : {}),
    ...built,
  };
}
