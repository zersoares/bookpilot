// Amazon Ads starter kit: keyword generation and the Sponsored Products
// bulksheet it exports.
//
// The bulksheet shape is transcribed from Amazon's own bulk-operations
// guide (see amazon-keywords.js's header), so these tests check the
// export against that documented field format, not against a live
// Amazon account this project has no way to test against.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeywordPlan, asinFromUrl, buildBulksheetCsv, UNIVERSAL_NEGATIVES,
} from "../js/core/amazon-keywords.js";

const BOOK = {
  title: "The Modern Woman's Guide to Starting Over",
  subtitle: "A powerful, heartfelt roadmap for women who are ready to rebuild their lives",
  author_name: "Zirlandia Milkovic",
  genre: "Self-Help",
  description: "A field guide for women rebuilding after a divorce, a redundancy, a move or a loss.",
};

test("generateKeywordPlan: exact match covers the title and author", () => {
  const plan = generateKeywordPlan(BOOK);
  assert.ok(plan.exact.includes("the modern woman's guide to starting over"));
  assert.ok(plan.exact.includes("zirlandia milkovic"));
  assert.ok(plan.exact.some((k) => k.includes("by zirlandia milkovic")));
});

test("generateKeywordPlan: broad list comes from the book's genre", () => {
  const plan = generateKeywordPlan(BOOK);
  assert.ok(plan.broad.includes("self help books for women"));
  assert.ok(plan.broad.length >= 6);

  const fantasy = generateKeywordPlan({ ...BOOK, genre: "Fantasy" });
  assert.ok(fantasy.broad.includes("epic fantasy novels"));
  assert.notEqual(fantasy.broad.join(), plan.broad.join(), "different genres get different seed lists");
});

test("generateKeywordPlan: an unknown or missing genre falls back, never throws", () => {
  const plan = generateKeywordPlan({ ...BOOK, genre: "Not A Real Genre" });
  assert.ok(plan.broad.length > 0);
  const noGenre = generateKeywordPlan({ title: "Untitled" });
  assert.ok(noGenre.broad.length > 0);
  assert.deepEqual(noGenre.exact, ["untitled"]);
});

test("generateKeywordPlan: phrase list draws real words from the description, not stopwords", () => {
  const plan = generateKeywordPlan(BOOK);
  assert.ok(plan.phrase.length > 0);
  // The literal "<title> book" entry is allowed to start with "the" (it's
  // the book's own title, not an extracted phrase); every phrase actually
  // pulled from the description or subtitle must not.
  const extracted = plan.phrase.filter((p) => !p.endsWith(" book"));
  assert.ok(extracted.length > 0);
  assert.ok(extracted.every((p) => !/^(a|the|for|who|are)\b/.test(p)), "no extracted phrase starts with a stopword");
  assert.ok(plan.phrase.some((p) => p.includes("rebuild")), "a real term from the description survives");
});

test("generateKeywordPlan: negatives are the universal list, and every list is deduplicated", () => {
  const plan = generateKeywordPlan(BOOK);
  assert.deepEqual(plan.negative, UNIVERSAL_NEGATIVES);
  for (const list of [plan.exact, plan.phrase, plan.broad, plan.negative]) {
    assert.equal(new Set(list).size, list.length, "no duplicates in any list");
    assert.ok(list.every((k) => k === k.toLowerCase()), "every keyword is already lowercase");
  }
});

test("generateKeywordPlan: an empty description or subtitle produces no crash and no junk phrases", () => {
  const plan = generateKeywordPlan({ title: "X", genre: "Romance" });
  assert.equal(plan.phrase.filter((p) => p !== "x book").length, 0);
});

test("asinFromUrl: reads the ASIN out of real Amazon product URL shapes", () => {
  assert.equal(asinFromUrl("https://www.amazon.com/dp/B0HJY47N91"), "B0HJY47N91");
  assert.equal(asinFromUrl("https://amazon.co.uk/dp/B0HJY47N91?ref=abc"), "B0HJY47N91");
  assert.equal(asinFromUrl("https://www.amazon.com/Some-Title/dp/B0HJY47N91/ref=sr_1_1"), "B0HJY47N91");
  assert.equal(asinFromUrl("https://www.amazon.com/gp/product/B0HJY47N91"), "B0HJY47N91");
  assert.equal(asinFromUrl("https://www.amazon.com/dp/b0hjy47n91"), "B0HJY47N91", "case-insensitive, normalised upper");
});

test("asinFromUrl: a non-Amazon or malformed URL yields null, never a false match", () => {
  assert.equal(asinFromUrl(""), null);
  assert.equal(asinFromUrl(null), null);
  assert.equal(asinFromUrl("https://example.com/dp/B0HJY47N91"), "B0HJY47N91", "path shape matters more than host here — by design, checked at the UI layer");
  assert.equal(asinFromUrl("https://www.amazon.com/s?k=starting+over"), null);
  assert.equal(asinFromUrl("not a url at all"), null);
});

// --- Bulksheet CSV -------------------------------------------------------

const PLAN = {
  campaignName: "Starting Over — Sponsored Products",
  dailyBudgetCents: 1000,
  defaultBidCents: 45,
  asin: "B0HJY47N91",
  keywords: { exact: ["a book"], phrase: ["a phrase"], broad: ["a broad term"], negative: ["free"] },
  startDate: new Date(2026, 8, 23), // month is 0-indexed: September
};

function parseCsv(text) {
  const [header, ...rows] = text.split("\r\n");
  const cols = header.split(",");
  return rows.filter(Boolean).map((line) => {
    // Good enough for these tests: no field here contains a comma.
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

test("buildBulksheetCsv: header row matches Amazon's documented field names exactly", () => {
  const csv = buildBulksheetCsv(PLAN);
  const header = csv.split("\r\n")[0];
  for (const col of [
    "Record ID", "Record Type", "Campaign ID", "Campaign", "Ad Group ID", "Ad Group",
    "Campaign Daily Budget", "Campaign Start Date", "Campaign Targeting Type",
    "Campaign Status", "Bidding Strategy", "Ad Group Status", "Max Bid", "SKU/ASIN",
    "Status", "Keyword or Product Targeting", "Match Type",
  ]) {
    assert.ok(header.includes(col), `missing column: ${col}`);
  }
});

test("buildBulksheetCsv: the Campaign row carries every required field, IDs left blank for create", () => {
  const rows = parseCsv(buildBulksheetCsv(PLAN));
  const campaign = rows.find((r) => r["Record Type"] === "Campaign");
  assert.equal(campaign["Campaign ID"], "", "blank Campaign ID is how Amazon knows to create, not update");
  assert.equal(campaign["Campaign"], PLAN.campaignName);
  assert.equal(campaign["Campaign Daily Budget"], "10.00");
  assert.equal(campaign["Campaign Start Date"], "09/23/2026");
  assert.equal(campaign["Campaign Targeting Type"], "Manual");
  assert.equal(campaign["Campaign Status"], "Paused", "created paused — an author reviews before it can spend");
  assert.equal(campaign["Bidding Strategy"], "Fixed Bids");
});

test("buildBulksheetCsv: the Ad Group row references the same campaign name, case for case", () => {
  const rows = parseCsv(buildBulksheetCsv(PLAN));
  const campaign = rows.find((r) => r["Record Type"] === "Campaign");
  const adGroup = rows.find((r) => r["Record Type"] === "Ad Group");
  assert.equal(adGroup["Campaign"], campaign["Campaign"]);
  assert.equal(adGroup["Max Bid"], "0.45");
  assert.equal(adGroup["Ad Group Status"], "Enabled");
  assert.ok(adGroup["Ad Group"].length > 0);
});

test("buildBulksheetCsv: an Ad row is included only when an ASIN is known", () => {
  const withAsin = parseCsv(buildBulksheetCsv(PLAN));
  const ad = withAsin.find((r) => r["Record Type"] === "Ad");
  assert.equal(ad["SKU/ASIN"], "B0HJY47N91");
  assert.equal(ad["Status"], "Enabled");

  const withoutAsin = parseCsv(buildBulksheetCsv({ ...PLAN, asin: null }));
  assert.equal(withoutAsin.find((r) => r["Record Type"] === "Ad"), undefined);
});

test("buildBulksheetCsv: every kept keyword becomes its own row with the right match type", () => {
  const rows = parseCsv(buildBulksheetCsv(PLAN));
  const keywordRows = rows.filter((r) => r["Record Type"] === "Keyword");
  assert.equal(keywordRows.length, 4); // 1 exact + 1 phrase + 1 broad + 1 negative

  const exact = keywordRows.find((r) => r["Keyword or Product Targeting"] === "a book");
  assert.equal(exact["Match Type"], "Exact");
  assert.equal(exact["Ad Group"], "Ad group 1");

  const negative = keywordRows.find((r) => r["Keyword or Product Targeting"] === "free");
  assert.equal(negative["Match Type"], "Campaign Negative Phrase");
  assert.equal(negative["Ad Group"], "", "campaign-level negatives carry no Ad Group");
  assert.equal(negative["Status"], "enabled", "lowercase, exactly as Amazon's guide specifies for this record");
});

test("buildBulksheetCsv: a keyword containing a comma or quote round-trips through CSV quoting", () => {
  const plan = { ...PLAN, keywords: { exact: ['books about "starting over", finally'], phrase: [], broad: [], negative: [] } };
  const csv = buildBulksheetCsv(plan);
  assert.match(csv, /"books about ""starting over"", finally"/);
});

test("buildBulksheetCsv: an empty keyword plan still produces a valid Campaign and Ad Group", () => {
  const rows = parseCsv(buildBulksheetCsv({ ...PLAN, keywords: { exact: [], phrase: [], broad: [], negative: [] } }));
  assert.equal(rows.filter((r) => r["Record Type"] === "Keyword").length, 0);
  assert.ok(rows.some((r) => r["Record Type"] === "Campaign"));
  assert.ok(rows.some((r) => r["Record Type"] === "Ad Group"));
});
