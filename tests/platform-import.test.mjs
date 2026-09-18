// Ad-platform imports (TikTok Ads, Google Ads, Pinterest Ads): reading a platform report,
// building tracked links, and the rules the server applies to what the
// browser sends.
//
// These exports vary and carry rate columns (CTR, CPC, ROAS, cost per
// result) beside the counts, and end in totals rows. Reading a rate as a
// count, or a summary row as a day, puts wrong numbers in front of an
// author deciding where to spend.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reportFor } from "../js/core/ad-report.js";
import { buildTrackedLink } from "../js/core/tracked-link.js";
import { normaliseRows, resolveTargets, toPerformanceRow, summarise, platformOf, PLATFORMS, MAX_ROWS } from "../netlify/functions/bookpilot-lib/platform-report.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";
import { DEMO_BOOK } from "../js/data/demo.js";

const tt = reportFor("tiktok");
const { readReport, buildRows, guessMapping } = tt;
const UNNAMED_CAMPAIGN = tt.unnamed;

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
  assert.equal(UNNAMED_CAMPAIGN, PLATFORMS.tiktok.unnamed, "browser and server agree on the placeholder");
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
  const out = normaliseRows([good({ date: "2026-09-02" }), good(), good({ clicks: 10 })], "tiktok", TODAY);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].clicks, 15);
  assert.equal(out.from, "2026-09-01");
  assert.equal(out.to, "2026-09-02");
});

test("server: refuses what a real import could never produce", () => {
  const bad = (row, pattern) => assert.throws(() => normaliseRows([row], "tiktok", TODAY), pattern);
  bad(good({ date: "2026-02-31" }), /not a date/);
  bad(good({ date: "01/09/2026" }), /not a date/);
  bad(good({ date: "2016-01-01" }), /outside the range/);
  bad(good({ date: "2027-01-01" }), /outside the range/);
  bad(good({ clicks: -1 }), /count/);
  bad(good({ impressions: 1.5 }), /count/);
  bad(good({ spend_cents: -5 }), /amount/);
  bad(good({ revenue_cents: "lots" }), /amount/);
  assert.throws(() => normaliseRows([], "tiktok", TODAY), /no rows/);
  assert.throws(() => normaliseRows([null], "tiktok", TODAY), /not a row/);
  assert.throws(() => normaliseRows(Array.from({ length: MAX_ROWS + 1 }, (_, i) => good({ campaign: `c${i}` })), "tiktok", TODAY), /date ranges/);
});

test("server: every campaign in a report needs somewhere to go", () => {
  const t = resolveTargets(["A", "B"], [{ campaign: "A", campaign_id: CAMPAIGN }, { campaign: "B", book_id: DEMO_BOOK.id }]);
  assert.deepEqual(t.get("A"), { campaignId: CAMPAIGN });
  assert.deepEqual(t.get("B"), { bookId: DEMO_BOOK.id });
  assert.throws(() => resolveTargets(["A", "C"], [{ campaign: "A", campaign_id: CAMPAIGN }]), /Choose where "C" goes/);
  assert.throws(() => resolveTargets(["A"], "nope"), /Choose where/);
});

test("server: a stored row is campaign-and-day level from TikTok, with no ad id and no reach", () => {
  const row = toPerformanceRow(normaliseRows([good()], "tiktok", TODAY).rows[0], CAMPAIGN, "tiktok");
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
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-import/tiktok")).campaigns.length, 0);
  const before = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(before.platforms.some((p) => p.source === "tiktok"), false);

  // A row with no target is refused.
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/platform-import/tiktok", { rows: built.rows, currency: "EUR", targets: [] }), (e) => e.status === 400);

  const first = await demoAdapter.request("POST", "/api/bp/platform-import/tiktok", {
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
  const { campaigns } = await demoAdapter.request("GET", "/api/bp/platform-import/tiktok");
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].external_only, true);
  assert.equal(campaigns[0].platform, "tiktok");

  // Importing again into the existing campaign replaces the days, never adds.
  await demoAdapter.request("POST", "/api/bp/platform-import/tiktok", {
    rows: built.rows, currency: "EUR", targets: [{ campaign: "Spring TikTok", campaign_id: campaigns[0].id }],
  });
  const again = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(again.platforms.find((p) => p.source === "tiktok").metrics.spendCents, 4000);
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-import/tiktok")).summary.rows, 2);

  // A currency mismatch is refused rather than mixed.
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/platform-import/tiktok", {
    rows: built.rows, currency: "USD", targets: [{ campaign: "Spring TikTok", campaign_id: campaigns[0].id }],
  }), (e) => /EUR/.test(e.message));

  await demoAdapter.request("DELETE", "/api/bp/platform-import/tiktok");
  const removed = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(removed.platforms.some((p) => p.source === "tiktok"), false);
});

test("demo: a tracking campaign can be created for a link before any report exists", async () => {
  resetDemo();
  const { campaign } = await demoAdapter.request("POST", "/api/bp/platform-campaigns/tiktok", {
    name: "Launch — TikTok", book_id: DEMO_BOOK.id, currency: "EUR",
  });
  assert.equal(campaign.external_only, true);
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-campaigns/tiktok")).campaigns.length, 1);
  await assert.rejects(() => demoAdapter.request("POST", "/api/bp/platform-campaigns/tiktok", { name: "x", book_id: "nope" }), (e) => e.status === 400);
});

// --- Google Ads -----------------------------------------------------------

const google = reportFor("google");

const GOOGLE = [
  "Campaign report",
  "1 September 2026 - 3 September 2026",
  "Day,Campaign,Currency code,Clicks,Impr.,CTR,Avg. CPC,Cost,Conversions,Cost / conv.,Conv. rate,Conv. value",
  "2026-09-01,Book launch — Search,EUR,40,900,4.44%,0.31,12.40,1.5,8.27,3.75%,13.49",
  "2026-09-02,Book launch — Search,EUR,55,1200,4.58%,0.30,16.50,2,8.25,3.64%,17.98",
  "2026-09-02,Backlist — Search,EUR,10,300,3.33%,0.40,4.00,0,--,0.00%,0.00",
  "Total: Account,,,105,2400,4.38%,0.31,32.90,3.5,9.4,3.33%,31.47",
].join("\n");

test("google: figures, not rates; Cost is spend and Cost / conv. is not", () => {
  const report = google.readReport(GOOGLE);
  assert.equal(report.ok, true);
  assert.equal(report.preamble, 2, "the title and date-range lines come first");
  const h = report.headers, m = report.mapping;
  assert.equal(h[m.date], "Day");
  assert.equal(h[m.campaign], "Campaign");
  assert.equal(h[m.impressions], "Impr.");
  assert.equal(h[m.clicks], "Clicks");
  assert.equal(h[m.spend], "Cost", "not Cost / conv. or Avg. CPC");
  assert.equal(h[m.conversions], "Conversions", "not Conv. rate");
  assert.equal(h[m.revenue], "Conv. value");
  assert.equal(h[m.currency], "Currency code");
});

test("the report says which currency it is in, when it does", () => {
  assert.equal(google.readReport(GOOGLE).currency, "EUR");
  // A report that mixes currencies gives no answer rather than a wrong one.
  const mixed = GOOGLE.replace("2026-09-02,Backlist — Search,EUR", "2026-09-02,Backlist — Search,USD");
  assert.equal(google.readReport(mixed).currency, null);
  // TikTok says it in the Cost heading.
  assert.equal(readReport(SAMPLE).currency, "EUR");
  assert.equal(readReport("Date,Campaign name,Cost\n2026-09-01,A,1").currency, null);
});

test("google: days merge, fractional conversions round, the Total row is left out", () => {
  const report = google.readReport(GOOGLE);
  const built = google.buildRows(report.data, report.mapping);
  assert.equal(built.rows.length, 3);
  const day1 = built.rows.find((r) => r.date === "2026-09-01");
  assert.deepEqual(day1, {
    campaign: "Book launch — Search", date: "2026-09-01", impressions: 900, clicks: 40,
    spend_cents: 1240, conversions: 2, revenue_cents: 1349,
  });
  assert.equal(built.totals.spend_cents, 1240 + 1650 + 400, "the Total: Account row is not added on top");
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no valid date/);
});

test("google: a report without the Day segment is refused", () => {
  const report = google.readReport("Campaign,Clicks,Impr.,Cost\nA,10,100,5.00");
  assert.equal(google.buildRows(report.data, report.mapping).needsDate, true);
});

test("google: tab-separated exports read the same", () => {
  const report = google.readReport(GOOGLE.replaceAll(",", "\t"));
  assert.equal(report.ok, true);
  assert.equal(google.buildRows(report.data, report.mapping).rows.length, 3);
});

test("the platforms are read differently but never confused", () => {
  // Google's headings mean nothing to the TikTok reader, and vice versa.
  assert.equal(readReport(GOOGLE).mapping.impressions, -1, "the TikTok reader does not guess Impr.");
  assert.equal(google.readReport(SAMPLE).mapping.clicks, -1, "TikTok's Clicks (destination) / (all) are not Google's Clicks");
  assert.equal(google.readReport(SAMPLE).mapping.impressions, 4, "but a plain Impressions column is Impressions in both");
  assert.throws(() => reportFor("myspace"), /No report format/);
});

test("google: the server accepts its rows and refuses unknown platforms", () => {
  const out = normaliseRows([good({ date: "2011-05-01" })], "google", TODAY);
  assert.equal(out.rows.length, 1);
  assert.equal(toPerformanceRow(out.rows[0], CAMPAIGN, "google").source, "google");
  assert.equal(normaliseRows([good({ campaign: " " })], "google", TODAY).rows[0].campaign, PLATFORMS.google.unnamed);
  assert.throws(() => normaliseRows([good({ date: "2009-01-01" })], "google", TODAY), /outside the range Google Ads/);
  // TikTok started later than Google, so a date valid for one is not for the other.
  assert.throws(() => normaliseRows([good({ date: "2011-05-01" })], "tiktok", TODAY), /outside the range TikTok Ads/);
  assert.throws(() => platformOf("myspace"), (e) => e.status === 404);
  assert.throws(() => normaliseRows([good()], "myspace", TODAY), (e) => e.status === 404);
});

test("google: a Google tracked link uses cpc and travels alongside auto-tagging", () => {
  const link = new URL(buildTrackedLink({ url: "https://example.com/book", platform: "google", campaignId: CAMPAIGN }));
  assert.equal(link.searchParams.get("utm_source"), "google");
  assert.equal(link.searchParams.get("utm_medium"), "cpc");
});

test("demo: TikTok and Google are kept apart, and both appear in the platform table", async () => {
  resetDemo();
  const g = google.readReport(GOOGLE);
  const gBuilt = google.buildRows(g.data, g.mapping);
  const t = readReport(SAMPLE);
  const tBuilt = buildRows(t.data, t.mapping);

  await demoAdapter.request("POST", "/api/bp/platform-import/google", {
    rows: gBuilt.rows, currency: "EUR",
    targets: [{ campaign: "Book launch — Search", book_id: DEMO_BOOK.id }, { campaign: "Backlist — Search", book_id: DEMO_BOOK.id }],
  });
  await demoAdapter.request("POST", "/api/bp/platform-import/tiktok", {
    rows: tBuilt.rows, currency: "EUR", targets: [{ campaign: "Spring TikTok", book_id: DEMO_BOOK.id }],
  });

  const analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  const by = Object.fromEntries(analytics.platforms.map((p) => [p.source, p.metrics]));
  assert.equal(by.google.spendCents, 3290);
  assert.equal(by.tiktok.spendCents, 4000);
  assert.ok(by.meta, "Meta stays visible beside both");

  // Each platform's campaigns and summary are its own.
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-campaigns/google")).campaigns.length, 2);
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-campaigns/tiktok")).campaigns.length, 1);
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-import/google")).summary.rows, 3);

  // Removing one leaves the other untouched.
  await demoAdapter.request("DELETE", "/api/bp/platform-import/google");
  const after = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(after.platforms.some((p) => p.source === "google"), false);
  assert.equal(after.platforms.find((p) => p.source === "tiktok").metrics.spendCents, 4000);

  await assert.rejects(() => demoAdapter.request("GET", "/api/bp/platform-import/myspace"), (e) => e.status === 404);
});

// --- Pinterest Ads --------------------------------------------------------

const pinterest = reportFor("pinterest");

const PINTEREST = [
  "Date,Campaign name,Ad group name,Spend in account currency,Impressions,Pin clicks,Outbound clicks,CTR,eCPC,Total conversions,Checkouts,Checkout value in account currency,Checkout ROAS",
  "2026-09-01,Spring Pins,Group A,10.00,5000,150,60,3.0%,0.07,4,1,8.99,0.90",
  "2026-09-01,Spring Pins,Group B,5.00,2500,70,30,2.8%,0.07,2,0,0.00,0",
  "2026-09-02,Spring Pins,Group A,12.00,6000,180,75,3.0%,0.07,3,2,17.98,1.50",
  "Total,,,27.00,13500,400,165,,,9,3,26.97,",
].join("\n");

test("pinterest: outbound clicks over Pin clicks, checkouts over total conversions, units in the heading ignored", () => {
  const report = pinterest.readReport(PINTEREST);
  assert.equal(report.ok, true);
  const h = report.headers, m = report.mapping;
  assert.equal(h[m.spend], "Spend in account currency");
  assert.equal(h[m.clicks], "Outbound clicks", "the clicks that reached the site, not clicks on the Pin");
  assert.equal(h[m.conversions], "Checkouts", "purchases, not every conversion event");
  assert.equal(h[m.revenue], "Checkout value in account currency");
  assert.equal(h[m.impressions], "Impressions");
  assert.equal(h[m.date], "Date");
  assert.equal(h[m.campaign], "Campaign name");
  // eCPC, CTR and ROAS are rates, never figures.
  for (const key of ["clicks", "spend", "conversions", "revenue"]) {
    assert.doesNotMatch(h[m[key]], /ecpc|ctr|roas/i);
  }
});

test("pinterest: ad groups merge per campaign-day and the Total row is left out", () => {
  const report = pinterest.readReport(PINTEREST);
  const built = pinterest.buildRows(report.data, report.mapping);
  assert.equal(built.rows.length, 2);
  assert.deepEqual(built.rows.find((r) => r.date === "2026-09-01"), {
    campaign: "Spring Pins", date: "2026-09-01", impressions: 7500, clicks: 90,
    spend_cents: 1500, conversions: 1, revenue_cents: 899,
  });
  assert.equal(built.totals.spend_cents, 2700, "the Total row is not added on top");
  assert.equal(built.totals.clicks, 165);
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no valid date/);
});

test("pinterest: with no Checkouts column, Total conversions is used", () => {
  const report = pinterest.readReport("Date,Campaign name,Spend,Impressions,Outbound clicks,Total conversions\n2026-09-01,A,5.00,100,10,3");
  const built = pinterest.buildRows(report.data, report.mapping);
  assert.equal(built.rows[0].conversions, 3);
  assert.equal(built.rows[0].spend_cents, 500);
});

test("pinterest: the server and the tracked link know the platform", () => {
  const out = normaliseRows([good({ date: "2014-03-01" })], "pinterest", TODAY);
  assert.equal(toPerformanceRow(out.rows[0], CAMPAIGN, "pinterest").source, "pinterest");
  assert.equal(normaliseRows([good({ campaign: "" })], "pinterest", TODAY).rows[0].campaign, PLATFORMS.pinterest.unnamed);
  assert.equal(pinterest.unnamed, PLATFORMS.pinterest.unnamed, "browser and server agree on the placeholder");
  assert.throws(() => normaliseRows([good({ date: "2012-01-01" })], "pinterest", TODAY), /outside the range Pinterest Ads/);

  const link = new URL(buildTrackedLink({ url: "https://example.com/book", platform: "pinterest", campaignId: CAMPAIGN }));
  assert.equal(link.searchParams.get("utm_source"), "pinterest");
  assert.equal(link.searchParams.get("utm_medium"), "paid_social");
});

test("demo: Pinterest is a third platform, kept apart from TikTok and Google", async () => {
  resetDemo();
  const pin = pinterest.readReport(PINTEREST);
  const built = pinterest.buildRows(pin.data, pin.mapping);
  const t = readReport(SAMPLE);
  const tBuilt = buildRows(t.data, t.mapping);

  await demoAdapter.request("POST", "/api/bp/platform-import/pinterest", {
    rows: built.rows, currency: "EUR", targets: [{ campaign: "Spring Pins", book_id: DEMO_BOOK.id }],
  });
  await demoAdapter.request("POST", "/api/bp/platform-import/tiktok", {
    rows: tBuilt.rows, currency: "EUR", targets: [{ campaign: "Spring TikTok", book_id: DEMO_BOOK.id }],
  });

  const analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  const by = Object.fromEntries(analytics.platforms.map((p) => [p.source, p.metrics]));
  assert.equal(by.pinterest.spendCents, 2700);
  assert.equal(by.tiktok.spendCents, 4000);
  assert.ok(by.meta);
  assert.equal(by.google, undefined, "no Google import, no Google row");

  const campaigns = (await demoAdapter.request("GET", "/api/bp/platform-campaigns/pinterest")).campaigns;
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].platform, "pinterest");
  assert.equal(campaigns[0].external_only, true);
  assert.equal((await demoAdapter.request("GET", "/api/bp/platform-campaigns/tiktok")).campaigns.length, 1);

  await demoAdapter.request("DELETE", "/api/bp/platform-import/pinterest");
  const after = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(after.platforms.some((p) => p.source === "pinterest"), false);
  assert.equal(after.platforms.find((p) => p.source === "tiktok").metrics.spendCents, 4000);
});
