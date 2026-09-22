// KDP sales & royalties import: reading a report, and validating what the
// browser sends.
//
// Same shape of problem as amazon.test.mjs: KDP's exports vary, and an
// import that quietly misreads a column puts wrong royalty figures in
// front of an author deciding whether an ad campaign paid for itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv, parseNumber, parseDate, buildRows, readReport,
  UNTITLED, UNKNOWN_MARKET,
} from "../js/core/kdp-sales-report.js";
import {
  normaliseRows, summarise, totalsOf, toDbRow, MAX_ROWS,
  UNTITLED as SERVER_UNTITLED, UNKNOWN_MARKET as SERVER_UNKNOWN_MARKET,
} from "../netlify/functions/bookpilot-lib/kdp-sales.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";

const SAMPLE = [
  "KDP eBook Royalty report",
  "Reporting period: 2026-09-01 to 2026-09-03",
  "",
  "Title,Marketplace,Royalty Date,Units Sold,Units Refunded,Net Units Sold,Royalty,Kindle Edition Normalized Pages Read,Kindle Edition Normalized Page Royalties",
  'The Long Walk Home,Amazon.com,2026-09-01,10,1,9,"31,41",1200,4.32',
  'The Long Walk Home,Amazon.co.uk,2026-09-01,4,0,4,"11,20",0,0',
  'The Long Walk Home,Amazon.com,2026-09-02,"1,100",40,1060,"3.219,00",900,3.24',
  "The Long Walk Home,Amazon.com,2026-09-03,0,0,0,0,0,0",
  "Total,,,1114,41,1073,3261.61,2100,7.56",
].join("\r\n");

test("CSV parsing is shared with the rest of the import stack", () => {
  const { rows } = parseCsv("Title,Marketplace\nA,B");
  assert.deepEqual(rows, [["Title", "Marketplace"], ["A", "B"]]);
});

test("the header row is found beneath a preamble", () => {
  const report = readReport(SAMPLE);
  assert.equal(report.ok, true);
  assert.equal(report.preamble, 2); // title and period lines come first; the blank line is dropped
  assert.equal(report.headers[0], "Title");
});

test("a file with no recognisable headings is refused", () => {
  assert.equal(readReport("foo,bar\n1,2").ok, false);
  assert.equal(readReport("").ok, false);
});

test("columns: royalty and KENP royalty are never confused with each other", () => {
  const report = readReport(SAMPLE);
  const m = report.mapping;
  assert.notEqual(m.royalty, m.kenp_royalty);
  assert.notEqual(m.kenp_pages_read, m.kenp_royalty);
  assert.ok(m.marketplace !== -1);
});

test("a full report: rows merge per title+marketplace+day, the totals row is left out", () => {
  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);

  // Four dated rows in the sample (two on 09-01, one on 09-02, one on
  // 09-03); the Total row has no valid date and is skipped.
  assert.equal(built.rows.length, 4);
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no valid date/);

  const day1Com = built.rows.find((r) => r.date === "2026-09-01" && r.marketplace === "Amazon.com");
  assert.equal(day1Com.net_units_sold, 9);
  assert.equal(day1Com.royalty_cents, 3141);

  assert.equal(built.totals.royalty_cents, 3141 + 1120 + 321900);
  assert.equal(built.from, "2026-09-01");
  assert.equal(built.to, "2026-09-03");
  assert.deepEqual([...built.marketplaces].sort(), ["Amazon.co.uk", "Amazon.com"]);
});

test("no title column falls back to a placeholder, no marketplace falls back to Amazon.com", () => {
  const csv = "Royalty Date,Net Units Sold,Royalty\n2026-09-01,4,899";
  const report = readReport(csv);
  const built = buildRows(report.data, report.mapping);
  assert.deepEqual(built.titles, [UNTITLED]);
  assert.deepEqual(built.marketplaces, [UNKNOWN_MARKET]);
  assert.equal(UNTITLED, SERVER_UNTITLED, "browser and server agree on the placeholder");
  assert.equal(UNKNOWN_MARKET, SERVER_UNKNOWN_MARKET);
});

test("net units sold is derived from sold minus refunded when the column is absent", () => {
  const csv = "Royalty Date,Units Sold,Units Refunded,Royalty\n2026-09-01,10,3,700";
  const report = readReport(csv);
  assert.equal(report.mapping.net_units_sold, -1);
  const built = buildRows(report.data, report.mapping);
  assert.equal(built.rows[0].net_units_sold, 7);
});

test("a report without dates needs a date to record it on", () => {
  const csv = "Title,Net Units Sold,Royalty\nA,10,500\nB,5,0";
  const report = readReport(csv);
  assert.equal(report.mapping.date, -1);
  assert.equal(buildRows(report.data, report.mapping).rows.length, 0);
  const built = buildRows(report.data, report.mapping, { undatedDate: "2026-09-10" });
  assert.equal(built.rows.length, 2);
  assert.ok(built.rows.every((r) => r.date === "2026-09-10"));
});

test("an unreadable figure skips the row and says why", () => {
  const report = readReport("Royalty Date,Title,Net Units Sold\n2026-09-01,A,many\n2026-09-02,A,5");
  const built = buildRows(report.data, report.mapping);
  assert.equal(built.rows.length, 1);
  assert.match(built.skipped[0].reason, /not a valid count/);
});

// --- Server side --------------------------------------------------------

const TODAY = "2026-09-18";
const good = (over = {}) => ({
  title: "The Long Walk Home", marketplace: "Amazon.com", date: "2026-09-01",
  units_sold: 10, units_refunded: 1, net_units_sold: 9, royalty_cents: 3141, ...over,
});
const kenp = (over = {}) => good({ kenp_pages_read: 1200, kenp_royalty_cents: 432, ...over });

test("server: valid rows pass, duplicates merge, order is by date then title then marketplace", () => {
  const out = normaliseRows([good({ date: "2026-09-02" }), good(), good({ units_sold: 20 })], TODAY);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].date, "2026-09-01");
  assert.equal(out.rows[0].units_sold, 30, "the same title+marketplace+day sent twice is summed");
  assert.equal(out.from, "2026-09-01");
  assert.equal(out.to, "2026-09-02");
});

test("server: a blank title or marketplace gets the placeholder", () => {
  assert.equal(normaliseRows([good({ title: "  " })], TODAY).rows[0].title, SERVER_UNTITLED);
  assert.equal(normaliseRows([good({ marketplace: "" })], TODAY).rows[0].marketplace, SERVER_UNKNOWN_MARKET);
});

test("server: refuses what a real import could never produce", () => {
  const bad = (row, pattern) => assert.throws(() => normaliseRows([row], TODAY), pattern);
  bad(good({ date: "2026-13-01" }), /not a date/);
  bad(good({ date: "01/09/2026" }), /not a date/);
  bad(good({ date: "2026-02-31" }), /not a date/);
  bad(good({ date: "2006-01-01" }), /outside the range/);
  bad(good({ date: "2027-01-01" }), /outside the range/);
  bad(good({ units_sold: -1 }), /whole number/);
  bad(good({ units_sold: 1.5 }), /whole number/);
  bad(good({ net_units_sold: "many" }), /whole number/);
  bad(good({ royalty_cents: -5 }), /valid amount/);
  bad(good({ royalty_cents: 1.5 }), /valid amount/);
  assert.throws(() => normaliseRows([], TODAY), /no rows/);
  assert.throws(() => normaliseRows("nope", TODAY), /no rows/);
  assert.throws(() => normaliseRows([null], TODAY), /not a row/);
});

test("server: a request over the row limit is refused with advice", () => {
  const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => good({ title: `Book ${i}` }));
  assert.throws(() => normaliseRows(many, TODAY), /date ranges/);
});

test("server: a date up to tomorrow is allowed, for timezones ahead of the server", () => {
  assert.doesNotThrow(() => normaliseRows([good({ date: "2026-09-19" })], TODAY));
  assert.throws(() => normaliseRows([good({ date: "2026-09-20" })], TODAY), /outside the range/);
});

test("server: the stored row carries the owner and never trusts a client id", () => {
  const row = toDbRow(normaliseRows([good()], TODAY).rows[0], { userId: "u1", currency: "EUR", bookId: "b1" });
  assert.equal(row.user_id, "u1");
  assert.equal(row.external_title, "The Long Walk Home");
  assert.equal(row.marketplace, "Amazon.com");
  assert.equal(row.book_id, "b1");
});

test("summary and totals: figures are summed, and mixed currencies are flagged not added up", () => {
  const rows = [
    { metric_date: "2026-09-01", external_title: "A", currency: "EUR", imported_at: "2026-09-10T10:00:00Z", units_sold: 10, units_refunded: 1, net_units_sold: 9, royalty_cents: 899 },
    { metric_date: "2026-09-02", external_title: "B", currency: "EUR", imported_at: "2026-09-11T10:00:00Z", units_sold: 5, units_refunded: 0, net_units_sold: 5, royalty_cents: 0 },
  ];
  const s = summarise(rows);
  assert.deepEqual([s.rows, s.days, s.titles, s.from, s.to], [2, 2, ["A", "B"], "2026-09-01", "2026-09-02"]);
  assert.equal(s.last_imported_at, "2026-09-11T10:00:00Z");

  const t = totalsOf(rows);
  assert.equal(t.unitsSold, 15);
  assert.equal(t.royaltyCents, 899);
  assert.equal(t.currency, "EUR");
  assert.equal(t.mixedCurrencies, false);

  const mixed = totalsOf([...rows, { ...rows[0], currency: "USD", metric_date: "2026-09-03" }]);
  assert.equal(mixed.mixedCurrencies, true);
  assert.equal(mixed.currency, null);

  assert.equal(totalsOf([]), null);
  assert.deepEqual(summarise([]).titles, []);
});

test("KENP figures are validated like the other counts, and stored apart from royalty", () => {
  const out = normaliseRows([kenp(), kenp({ kenp_pages_read: 300, kenp_royalty_cents: 108 })], TODAY);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].kenp_pages_read, 1500);
  assert.equal(out.rows[0].kenp_royalty_cents, 540);
  assert.equal(out.rows[0].royalty_cents, 3141 * 2, "KENP royalty stays out of the book-sale royalty");

  assert.equal(normaliseRows([good()], TODAY).rows[0].kenp_pages_read, 0, "a report without them reads as zero");
  assert.throws(() => normaliseRows([kenp({ kenp_pages_read: -1 })], TODAY), /kenp_pages_read/);
  assert.throws(() => normaliseRows([kenp({ kenp_royalty_cents: -5 })], TODAY), /page-read royalty/);

  const row = toDbRow(out.rows[0], { userId: "u1", currency: "EUR" });
  assert.equal(row.kenp_pages_read, 1500);
  assert.equal(row.kenp_royalty_cents, 540);

  const totals = totalsOf([
    { metric_date: "2026-09-01", external_title: "A", currency: "EUR", units_sold: 1, kenp_pages_read: 1200, kenp_royalty_cents: 432, royalty_cents: 899 },
    { metric_date: "2026-09-02", external_title: "A", currency: "EUR", units_sold: 1 },
  ]);
  assert.equal(totals.kenpPagesRead, 1200);
  assert.equal(totals.kenpRoyaltyCents, 432);
  assert.equal(totals.royaltyCents, 899);
});

// --- Demo workspace -----------------------------------------------------

test("demo: import, replace on re-import, feed analytics as profit, and remove", async () => {
  resetDemo();
  assert.equal((await demoAdapter.request("GET", "/api/bp/kdp-sales-import")).summary.rows, 0);
  const before = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(before.kdpSales, null);
  assert.equal(before.profit, null);

  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);
  const res = await demoAdapter.request("POST", "/api/bp/kdp-sales-import", { rows: built.rows, currency: "EUR", links: [] });
  assert.equal(res.imported, 4);

  let analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(analytics.kdpSales.royaltyCents, 3141 + 1120 + 321900);
  assert.equal(analytics.kdpSales.currency, "EUR");
  // The demo profile's currency is EUR, so a profit figure is computed
  // when there is also ad spend; the demo dataset always has some.
  if (analytics.totals.hasData) {
    assert.ok(analytics.profit, "royalties in EUR against EUR ad spend produce a profit figure");
    assert.equal(analytics.profit.royaltyCents, analytics.kdpSales.royaltyCents + analytics.kdpSales.kenpRoyaltyCents);
    assert.equal(analytics.profit.netCents, analytics.profit.royaltyCents - analytics.profit.spendCents);
  }

  // Importing the same report again replaces those title-days; it does not double them.
  await demoAdapter.request("POST", "/api/bp/kdp-sales-import", { rows: built.rows, currency: "EUR", links: [] });
  analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(analytics.kdpSales.royaltyCents, 3141 + 1120 + 321900, "a re-import replaces, never adds");
  assert.equal((await demoAdapter.request("GET", "/api/bp/kdp-sales-import")).summary.rows, 4);

  // KDP figures never enter the ad-platform totals.
  assert.deepEqual(analytics.totals, before.totals);

  await demoAdapter.request("DELETE", "/api/bp/kdp-sales-import");
  const after = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(after.kdpSales, null);
  assert.equal(after.profit, null);
});

test("demo: mixed-currency royalties never produce a profit figure", async () => {
  resetDemo();
  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);
  await demoAdapter.request("POST", "/api/bp/kdp-sales-import", { rows: built.rows.slice(0, 2), currency: "EUR", links: [] });
  await demoAdapter.request("POST", "/api/bp/kdp-sales-import", {
    rows: built.rows.slice(2).map((r) => ({ ...r, date: "2026-10-01" })), currency: "USD", links: [],
  });
  const analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=365");
  assert.equal(analytics.kdpSales.mixedCurrencies, true);
  assert.equal(analytics.profit, null);
});
