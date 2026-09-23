// Amazon Ads starter kit: a keyword plan and a Sponsored Products
// bulksheet, generated from a book's own metadata.
//
// This is not real keyword research — nobody outside Amazon has search
// volume for Amazon's internal search bar, and no ad platform hands that
// out to a third party for free. What this generates instead is a
// reasonable starting list (the book's own title and author, plus
// category-shaped phrases a reader in that genre plausibly searches) for
// the author to prune and refine, the same starting point a human VA
// doing this manually would type up by hand. The value isn't the list;
// it's not staring at a blank spreadsheet on ad platform day one.
//
// The bulksheet columns and field rules below are transcribed from
// Amazon's own "Bulk operations for sponsored ads" user guide (the
// section "Creating Sponsored Products campaigns") — not guessed. Even
// so, Amazon's exact template can vary by marketplace and changes over
// time (a column was added as recently as mid-2026), so the export
// carries that caveat rather than claiming to be gospel.
//
// Pure functions, no DOM, no network — testable and reusable by both the
// editor view and (if it's ever needed) a server-side export.

/**
 * Per-genre seed phrases: the shape of what a reader in that category
 * types into Amazon's search bar, not this book's own words. Kept short
 * — eight phrases an author can extend, not a pretend-exhaustive list.
 */
const GENRE_SEEDS = {
  "Romance": [
    "romance books", "romance novels", "contemporary romance books",
    "romance books for women", "steamy romance books", "clean romance books",
    "enemies to lovers romance", "small town romance books",
  ],
  "Thriller": [
    "thriller books", "psychological thriller books", "crime thriller novels",
    "suspense books", "thriller books for adults", "page turner thriller",
    "domestic thriller books", "mystery thriller books",
  ],
  "Mystery": [
    "mystery books", "cozy mystery books", "detective novels",
    "murder mystery books", "whodunit books", "mystery series books",
    "mystery books for adults", "crime mystery novels",
  ],
  "Fantasy": [
    "fantasy books", "epic fantasy novels", "fantasy books for adults",
    "sword and sorcery books", "magic fantasy books", "fantasy series books",
    "dragon fantasy books", "fantasy adventure novels",
  ],
  "Science Fiction": [
    "science fiction books", "sci fi novels", "space opera books",
    "dystopian science fiction", "hard science fiction books",
    "sci fi books for adults", "science fiction series", "future world novels",
  ],
  "Historical Fiction": [
    "historical fiction books", "historical fiction novels",
    "world war 2 historical fiction", "historical romance books",
    "historical fiction for adults", "period drama novels",
    "biographical historical fiction", "historical fiction series",
  ],
  "Literary Fiction": [
    "literary fiction books", "book club books", "contemporary fiction novels",
    "literary fiction for adults", "character driven novels",
    "award winning fiction books", "modern literary fiction",
    "thought provoking books",
  ],
  "Self-Help": [
    "self help books", "self help books for women", "self improvement books",
    "personal growth books", "motivational books", "books about starting over",
    "life change books", "books on rebuilding your life",
  ],
  "Personal Development": [
    "personal development books", "self improvement books",
    "books on building confidence", "goal setting books",
    "habit building books", "mindset books", "books for personal growth",
    "productivity books",
  ],
  "Business": [
    "business books", "entrepreneurship books", "small business books",
    "leadership books for business", "startup books", "marketing books",
    "business strategy books", "books for entrepreneurs",
  ],
  "Leadership": [
    "leadership books", "management books", "books on leading teams",
    "executive leadership books", "leadership development books",
    "books for new managers", "leadership skills books", "team building books",
  ],
  "Psychology": [
    "psychology books", "books about the mind", "popular psychology books",
    "psychology books for beginners", "behavioral psychology books",
    "books on human behavior", "emotional intelligence books",
    "psychology self help books",
  ],
  "Health & Wellness": [
    "health and wellness books", "wellness books for women",
    "self care books", "healthy lifestyle books", "mental health books",
    "books on stress management", "mindfulness books", "holistic health books",
  ],
  "AI & Technology": [
    "artificial intelligence books", "ai books for beginners",
    "technology books", "books about ai", "machine learning books",
    "future of technology books", "ai for business books",
    "books on emerging technology",
  ],
  "Cybersecurity": [
    "cybersecurity books", "cyber security for beginners",
    "hacking books", "information security books", "cybersecurity awareness books",
    "books on data privacy", "network security books", "cyber crime books",
  ],
  "Memoir": [
    "memoir books", "memoirs about overcoming adversity", "true story books",
    "inspiring memoirs", "memoirs by women", "personal memoir books",
    "memoirs about healing", "life story books",
  ],
  "Biography": [
    "biography books", "biographies of inspiring people", "true life stories",
    "biography books for adults", "autobiography books",
    "inspirational biography books", "biography bestsellers",
    "life stories books",
  ],
  "Children's Books": [
    "childrens books", "picture books for kids", "bedtime story books",
    "books for toddlers", "early reader books", "kids books ages 4-8",
    "illustrated childrens books", "books for young readers",
  ],
  "Young Adult": [
    "young adult books", "ya novels", "teen fiction books",
    "ya fantasy books", "coming of age books", "ya romance books",
    "books for teenagers", "ya book series",
  ],
  "Other": [
    "nonfiction books", "books for adults", "bestselling books",
    "new release books", "books worth reading", "must read books",
  ],
};

/** Universal negatives: intent that never converts an ebook/paperback sale. */
export const UNIVERSAL_NEGATIVES = [
  "free", "free download", "pdf", "pdf download", "audiobook free",
  "summary", "cliff notes", "sparknotes", "movie",
];

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with",
  "your", "you", "is", "are", "at", "by", "from", "this", "that", "it",
  "as", "be", "will", "not", "into", "about", "who", "what", "when",
]);

/**
 * A handful of 2-3 word phrases pulled from the book's own description —
 * a light touch, not real NLP: consecutive non-stopword runs, deduped,
 * longest-first. This is what makes the list specific to the book rather
 * than only the genre.
 */
function phrasesFromText(text, { max = 6 } = {}) {
  const tokens = words(text);
  const runs = [];
  let current = [];
  for (const w of tokens) {
    if (STOPWORDS.has(w) || w.length < 3) {
      if (current.length >= 2) runs.push(current);
      current = [];
      continue;
    }
    current.push(w);
  }
  if (current.length >= 2) runs.push(current);

  const phrases = new Set();
  for (const run of runs) {
    for (let size = Math.min(3, run.length); size >= 2; size--) {
      for (let i = 0; i + size <= run.length; i++) {
        phrases.add(run.slice(i, i + size).join(" "));
      }
    }
  }
  return [...phrases].sort((a, b) => b.length - a.length).slice(0, max);
}

/**
 * The keyword plan for a book: broad category phrases, phrase-match
 * title/description terms, exact-match title and author, and negatives.
 * Every list is deduplicated and capped, and every keyword is already
 * lowercase — Amazon match types are not case sensitive, and a mixed-case
 * list reads as sloppier than it is.
 */
export function generateKeywordPlan(book) {
  const title = (book.title || "").trim();
  const author = (book.author_name || "").trim();
  const genreSeeds = GENRE_SEEDS[book.genre] || GENRE_SEEDS.Other;
  const descriptionPhrases = phrasesFromText(book.description, { max: 6 });
  const subtitlePhrases = phrasesFromText(book.subtitle, { max: 3 });

  const exact = uniq([
    title.toLowerCase(),
    author ? `${title} by ${author}`.toLowerCase() : null,
    author ? author.toLowerCase() : null,
  ]);

  const phrase = uniq([
    ...subtitlePhrases,
    ...descriptionPhrases,
    title ? `${title.toLowerCase()} book` : null,
  ]);

  const broad = uniq(genreSeeds);

  const negative = uniq(UNIVERSAL_NEGATIVES);

  return { exact, phrase, broad, negative };
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const v = (item || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** The 10-character ASIN out of an amazon.com/.co.uk/… product URL, or null. */
export function asinFromUrl(url) {
  const m = String(url || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

const CSV_COLUMNS = [
  "Record ID", "Record Type", "Campaign ID", "Campaign", "Ad Group ID", "Ad Group",
  "Keyword ID", "Ad ID", "Campaign Daily Budget", "Portfolio ID", "Campaign Start Date",
  "Campaign End Date", "Campaign Targeting Type", "Campaign Status", "Bidding Strategy",
  "Ad Group Status", "Max Bid", "SKU/ASIN", "Status", "Keyword or Product Targeting", "Match Type",
];

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(fields) {
  return CSV_COLUMNS.map((col) => csvCell(fields[col] ?? "")).join(",");
}

const usDate = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

/**
 * A Sponsored Products bulksheet for one brand-new manual campaign: the
 * Campaign row, one Ad Group, an Ad (if an ASIN is known), every kept
 * keyword (positive at ad-group level, negative at campaign level so
 * they apply across any ad group added later), in the field shapes
 * Amazon's bulk-operations guide documents for creating each record type
 * from nothing (every ID column blank — Amazon assigns those on upload).
 *
 * @param {object} plan     { campaignName, dailyBudgetCents, defaultBidCents, currency, asin,
 *                            keywords: { exact: string[], phrase: string[], broad: string[], negative: string[] },
 *                            startDate?: Date }
 */
export function buildBulksheetCsv(plan) {
  const {
    campaignName, dailyBudgetCents, defaultBidCents, asin,
    keywords, startDate = new Date(),
  } = plan;
  const adGroupName = "Ad group 1";
  const money = (cents) => (cents / 100).toFixed(2);

  const lines = [CSV_COLUMNS.join(",")];

  lines.push(row({
    "Record Type": "Campaign",
    "Campaign": campaignName,
    "Campaign Daily Budget": money(dailyBudgetCents),
    "Campaign Start Date": usDate(startDate),
    "Campaign Targeting Type": "Manual",
    "Campaign Status": "Paused",
    "Bidding Strategy": "Fixed Bids",
  }));

  lines.push(row({
    "Record Type": "Ad Group",
    "Campaign": campaignName,
    "Ad Group": adGroupName,
    "Max Bid": money(defaultBidCents),
    "Ad Group Status": "Enabled",
  }));

  if (asin) {
    lines.push(row({
      "Record Type": "Ad",
      "Campaign": campaignName,
      "Ad Group": adGroupName,
      "SKU/ASIN": asin,
      "Status": "Enabled",
    }));
  }

  const positive = [
    ...keywords.exact.map((k) => [k, "Exact"]),
    ...keywords.phrase.map((k) => [k, "Phrase"]),
    ...keywords.broad.map((k) => [k, "Broad"]),
  ];
  for (const [keyword, matchType] of positive) {
    lines.push(row({
      "Record Type": "Keyword",
      "Campaign": campaignName,
      "Ad Group": adGroupName,
      "Keyword or Product Targeting": keyword,
      "Match Type": matchType,
      "Status": "Enabled",
    }));
  }

  // Campaign-level negatives: they hold even once a second ad group is
  // added later, which an ad-group-level negative would not.
  for (const keyword of keywords.negative) {
    lines.push(row({
      "Record Type": "Keyword",
      "Campaign": campaignName,
      "Keyword or Product Targeting": keyword,
      "Match Type": "Campaign Negative Phrase",
      "Status": "enabled",
    }));
  }

  return lines.join("\r\n");
}
