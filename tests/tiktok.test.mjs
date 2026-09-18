// TikTok Ads: reading an Ads Manager report, building tracked links, and
// the rules the server applies to what the browser sends.
//
// TikTok's exports vary and carry rate columns (CTR, CPC, ROAS, cost per
// result) beside the counts. Reading a rate as a count, or a summary row as
// a day, puts wrong numbers in front of an author deciding where to spend.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readReport, buildRows, guessMapping, UNNAMED_CAMPAIGN } from "../js/core/tiktok-report.js";
import { buildTrackedLink } from "../js/core/tracked-link.js";
import { normaliseRows, resolveTargets, toPerformanceRow, summarise, MAX_ROWS, UNNAMED } from "../netlify/functions/bookpilot-lib/tiktok.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";
import { DEMO_BOOK } from "../js/data/demo.js";

const SAMPLE = [
  "Date,Campaign name,Ad group name,Cost (EUR),Impressions,Clicks (destination),Clicks (all),CTR,CPC,Complete payment,Complete payment value,Cost per complete payment,Complete payment ROAS",
  "2026-09-01,Spring TikTok,Group A,12.50,4000,80,95,2.0%,0.16,2,17.98,6.25,1.44",
  "2026-09-01,Spring TikTok,Group B,7.50,2500,40,50,1.6%,0.19,0,0.00,,0",
  "2026-09-02,Spring TikTok,Group A,20.00,6000,120,140,2.0%,0.17,3,26.97,6.67,1.35",
  "Total,,,40.00,12500,240,285,,,5,44.95,,",
].join("\n");

const CAMPAIGN = "d1000000-0000-4000-8000-0000000000aa";
const CREATIVE = "d1000000-0000-4000-8000-0000000000bb";

// --- Reading a report -----------------------------------------------------

test("columns: counts, not rates; destination clicks over all clicks; a currency suffix is still Cost", () => {
  const headers = SAMPLE.split("\n")[0].split(",");
  const m = guessMapping(headers);
  assert.equal(headers[m.spend], "Cost (EUR)");
  assert.equal(headers[m.clicks], "Clicks (destination)", "the clicks that reached the page");
  assert.equal(headers[m.conversions], "Complete payment", "not its cost or its ROAS");
  assert.equal(headers[m.revenue], "Complete payment value");
  assert.equal(headers[m.impressions], "Impressions");
  assert.equal(headers[m.date], "Date");
  assert.equal(headers[m.campaign], "Campaign name");
});

test("a full report: ad groups merge per campaign-day, the totals row is left out", () => {
  const report = readReport(SAMPLE);
  assert.equal(report.ok, true);
  const built = buildRows(report.data, report.mapping);

  assert.equal(built.rows.length, 2);
  const day1 = built.rows.find((r) => r.date === "2026-09-01");
  assert.deepEqual(day1, {
    campaign: "Spring TikTok", date: "2026-09-01", impressions: 6500, clicks: 120,
    spend_cents: 2000, conversions: 2, revenue_cents: 1798,
  });
  // The Total row repeats every figure; counting it would double them.
  assert.equal(built.totals.spend_cents, 4000);
  assert.equal(built.totals.impressions, 12500);
  assert.equal(built.totals.conversions, 5);
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no valid date/);
  assert.equal(built.from, "2026-09-01");
  assert.equal(built.to, "2026-09-02");
});

test("a report with no date column is refused, not placed on an invented day", () => {
  const report = readReport("Campaign name,Cost,Impressions\nA,10,1000");
  assert.equal(report.mapping.date, -1);
  const built = buildRows(report.data, report.mapping);
  assert.equal(built.needsDate, true);
  assert.equal(built.rows.length, 0);
});

test("European number formats and semicolon delimiters", () => {
  const report = readReport("Date;Campaign name;Cost;Impressions;Clicks\n03.09.2026;A;12,50;1.200;30");
  const built = buildRows(report.data, report.mapping);
  assert.equal(built.rows[0].date, "2026-09-03");
  assert.equal(built.rows[0].spend_cents, 1250);
  assert.equal(built.rows[0].impressions, 1200);
});

test("an unreadable figure skips the row and says why; a missing campaign column gets a placeholder", () => {
  const bad = readReport("Date,Campaign name,Cost,Clicks\n2026-09-01,A,ten,5\n2026-09-02,A,4,5");
  const built = buildRows(bad.data, bad.mapping);
  assert.equal(built.rows.length, 1);
  assert.match(built.skipped[0].reason, /not a valid amount/);

  const nameless = readReport("Date,Cost\n2026-09-01,4");
  assert.deepEqual(buildRows(nameless.data, nameless.mapping).campaigns, [UNNAMED_CAMPAIGN]);
  assert.equal(UNNAMED_CAMPAIGN, UNNAMED, "browser and server agree on the placeholder");
});

test("a file with no recognisable headings is refused", () => {
  assert.equal(readReport("foo,bar\n1,2").ok, false);
});

// --- Tracked links --------------------------------------------------------

test("a tracked link carries the campaign and creative ids and keeps the rest of the URL", () => {
  const link = new URL(buildTrackedLink({
    url: "https://example.com/book?ref=abc#buy", platform: "tiktok", campaignId: CAMPAIGN, creativeId: CREATIVE,
  }));
  assert.equal(link.origin + link.pathname, "https://example.com/book");
  assert.equal(link.hash, "#buy");
  assert.equal(link.searchParams.get("ref"), "abc");
  assert.equal(link.searchParams.get("utm_source"), "tiktok");
  assert.equal(link.searchParams.get("utm_medium"), "paid_social");
  assert.equal(link.searchParams.get("utm_campaign"), CAMPAIGN);
  assert.equal(link.searchParams.get("utm_content"), CREATIVE);
});

test("existing utm parameters are replaced, so a link never names two campaigns", () => {
  const link = new URL(buildTrackedLink({
    url: "https://example.com/?utm_campaign=old&UTM_Content=old&utm_term=x&keep=1", campaignId: CAMPAIGN,
  }));
  assert.deepEqual(link.searchParams.getAll("utm_campaign"), [CAMPAIGN]);
  assert.equal(link.searchParams.get("utm_content"), null, "a stale creative id must not survive");
  assert.equal(link.searchParams.get("utm_term"), null);
  assert.equal(link.searchParams.get("keep"), "1");
});

test("tracked links refuse what cannot work", () => {
  assert.throws(() => buildTrackedLink({ url: "not a url", campaignId: CAMPAIGN }), /full address/);
  assert.throws(() => buildTrackedLink({ url: "javascript:alert(1)", campaignId: CAMPAIGN }), /https/);
  assert.throws(() => buildTrackedLink({ url: "ftp://example.com", campaignId: CAMPAIGN }), /https/);
  assert.throws(() => buildTrackedLink({ url: "https://example.com", campaignId: "spring" }), /Choose a campaign/);
  assert.throws(() => buildTrackedLink({ url: "https://example.com", campaignId: CAMPAIGN, creativeId: "x" }), /creative/);
});

// --- Server rules ---------------------------------------------------------

const TODAY = "2026-09-18";
const good = (over = {}) => ({ campaign: "A", date: "2026-09-01", impressions: 100, clicks: 5, conversions: 1, spend_cents: 500, revenue_cents: 899, ...over });

test("server: valid rows pass, duplicates merge, order is by date", () => {
  const out = normaliseRows([good({ date: "2026-09-02" }), good(), good({ clicks: 10 })], TODAY);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].clicks, 15);
  assert.equal(out.from, "2026-09-01");
  assert.equal(out.to, "2026-09-02");
});

test("server: refuses what a real import could never produce", () => {
  const bad = (row, pattern) => assert.throws(() => normaliseRows([row], TODAY), pattern);
  bad(good({ date: "2026-02-31" }), /not a date/);
  bad(good({ date: "01/09/2026" }), /not a date/);
  bad(good({ date: "2016-01-01" }), /outside the range/);
  bad(good({ date: "2027-01-01" }), /outside the range/);
  bad(good({ clicks: -1 }), /count/);
  bad(good({ impressions: 1.5 }), /count/);
  bad(good({ spend_cents: -5 }), /amount/);
  bad(good({ revenue_cents: "lots" }), /amount/);
  assert.throws(() => normaliseRows([], TODAY), /no rows/);
  assert.throws(() => normaliseRows([null], TODAY), /not a row/);
  assert.throws(() => normaliseRows(Array.from({ length: MAX_ROWS + 1 }, (_, i) => good({ campaign: `c${i}` })), TODAY), /date ranges/);
});

test("server: every campaign in a report needs somewhere to go", () => {
  const t = resolveTargets(["A", "B"], [{ campaign: "A", campaign_id: CAMPAIGN }, { campaign: "B", book_id: DEMO_BOOK.id }]);
  assert.deepEqual(t.get("A"), { campaignId: CAMPAIGN });
  assert.deepEqual(t.get("B"), { bookId: DEMO_BOOK.id });
  assert.throws(() => resolveTargets(["A", "C"], [{ campaign: "A", campaign_id: CAMPAIGN }]), /Choose where "C" goes/);
  assert.throws(() => resolveTargets(["A"], "nope"), /Choose where/);
});

test("server: a stored row is campaign-and-day level from TikTok, with no ad id and no reach", () => {
  const row = toPerformanceRow(normaliseRows([good()], TODAY).rows[0], CAMPAIGN);
  assert.equal(row.source, "tiktok");
  assert.equal(row.ad_id, null);
  assert.equal(row.reach, 0);
  assert.equal(row.campaign_id, CAMPAIGN);
  assert.equal(row.spend_cents, 500);
});

test("server: the summary names campaigns and dates", () => {
  const s = summarise([
    { campaign_id: "c1", metric_date: "2026-09-02", synced_at: "2026-09-10T10:00:00Z" },
    { campaign_id: "c1", metric_date: "2026-09-01", synced_at: "2026-09-11T10:00:00Z" },
  ], new Map([["c1", "Spring"]]));
  assert.deepEqual([s.rows, s.days, s.campaigns, s.from, s.to], [2, 2, ["Spring"], "2026-09-01", "2026-09-02"]);
  assert.equal(s.last_imported_at, "2026-09-11T10:00:00Z");
  assert.equal(summarise([]).rows, 0);
});

// --- Demo workspace -------------------------------------------------------

test("demo: create a tracking campaign, import into new and existing campaigns, replace, remove", async () => {
  resetDemo();
  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);

  // No TikTok campaigns yet, and Analytics has no TikTok platform row.
  assert.equal((await demoAdapter.request("GET", "/api/bp/tiktok-import")).campaigns.length, 0);
  const before = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(before.platforms.some((p) => p.source === "tiktok"), false);

  // A row with no target is refused.
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/tiktok-import", { rows: built.rows, currency: "EUR", targets: [] }), (e) => e.status === 400);

  const first = await demoAdapter.request("POST", "/api/bp/tiktok-import", {
    rows: built.rows, currency: "EUR", targets: [{ campaign: "Spring TikTok", book_id: DEMO_BOOK.id }],
  });
  assert.equal(first.imported, 2);
  assert.equal(first.created, 1);

  const after = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  const tt = after.platforms.find((p) => p.source === "tiktok");
  assert.equal(tt.metrics.spendCents, 4000);
  assert.equal(tt.metrics.conversions, 5);
  assert.ok(after.platforms.some((p) => p.source === "meta"), "Meta stays visible beside it");

  // A TikTok campaign is created as run-elsewhere, never as launchable.
  const { campaigns } = await demoAdapter.request("GET", "/api/bp/tiktok-import");
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].external_only, true);
  assert.equal(campaigns[0].platform, "tiktok");

  // Importing again into the existing campaign replaces the days, never adds.
  await demoAdapter.request("POST", "/api/bp/tiktok-import", {
    rows: built.rows, currency: "EUR", targets: [{ campaign: "Spring TikTok", campaign_id: campaigns[0].id }],
  });
  const again = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(again.platforms.find((p) => p.source === "tiktok").metrics.spendCents, 4000);
  assert.equal((await demoAdapter.request("GET", "/api/bp/tiktok-import")).summary.rows, 2);

  // A currency mismatch is refused rather than mixed.
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/tiktok-import", {
    rows: built.rows, currency: "USD", targets: [{ campaign: "Spring TikTok", campaign_id: campaigns[0].id }],
  }), (e) => /EUR/.test(e.message));

  await demoAdapter.request("DELETE", "/api/bp/tiktok-import");
  const removed = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(removed.platforms.some((p) => p.source === "tiktok"), false);
});

test("demo: a tracking campaign can be created for a link before any report exists", async () => {
  resetDemo();
  const { campaign } = await demoAdapter.request("POST", "/api/bp/tiktok-campaigns", {
    name: "Launch — TikTok", book_id: DEMO_BOOK.id, currency: "EUR",
  });
  assert.equal(campaign.external_only, true);
  assert.equal((await demoAdapter.request("GET", "/api/bp/tiktok-campaigns")).campaigns.length, 1);
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/tiktok-campaigns", { name: "x", book_id: "nope" }), (e) => e.status === 400);
});
