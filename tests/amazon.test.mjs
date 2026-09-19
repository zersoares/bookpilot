// Amazon Attribution import: reading a report, and validating what the
// browser sends.
//
// Amazon's exports are not consistent, and an import that quietly
// misreads a column or a date puts wrong numbers in front of an author
// who will make ad decisions from them. These are the awkward cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv, parseNumber, parseDate, detectDayFirst, guessMapping, findHeaderRow, buildRows, readReport,
  UNNAMED_CAMPAIGN,
} from "../js/core/amazon-report.js";
import { normaliseRows, summarise, totalsOf, toDbRow, MAX_ROWS, UNNAMED } from "../netlify/functions/bookpilot-lib/amazon.js";
import { demoAdapter, resetDemo } from "../js/data/demo-adapter.js";

const BOM = String.fromCharCode(0xfeff);

const SAMPLE = [
  "Amazon Attribution report",
  "Reporting period: 2026-09-01 to 2026-09-03",
  "",
  "Date,Campaign,Ad group,Click-throughs,Detail page views,Add to cart,Purchases,Purchase rate,Units sold,Sales",
  '2026-09-01,Spring Launch,Ad group 1,120,95,14,3,2.5%,3,"26,97"',
  '2026-09-01,Spring Launch,Ad group 2,80,60,6,1,1.2%,1,"8,99"',
  '2026-09-02,Spring Launch,Ad group 1,"1,100",900,40,9,0.8%,10,"89,90"',
  "2026-09-03,Newsletter,Ad group 1,15,12,1,0,0%,0,-",
  "Total,,,1315,1067,61,13,,14,125.86",
].join("\r\n");

test("CSV: quotes, embedded commas, CRLF and a byte-order mark", () => {
  const { rows } = parseCsv(`${BOM}a,b\r\n"x, y","say ""hi"""\r\n`);
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"']]);
});

test("CSV: semicolon and tab delimiters are detected", () => {
  assert.equal(parseCsv("a;b;c\n1;2;3").delimiter, ";");
  assert.equal(parseCsv("a\tb\tc\n1\t2\t3").delimiter, "\t");
  assert.equal(parseCsv("a,b,c\n1,2,3").delimiter, ",");
});

test("the header row is found beneath a preamble", () => {
  const { rows } = parseCsv(SAMPLE);
  assert.equal(findHeaderRow(rows), 2); // title and period lines come first; the blank line is dropped
  const report = readReport(SAMPLE);
  assert.equal(report.ok, true);
  assert.equal(report.preamble, 2);
  assert.equal(report.headers[0], "Date");
});

test("a file with no recognisable headings is refused, not guessed at", () => {
  assert.equal(readReport("foo,bar\n1,2").ok, false);
  assert.equal(readReport("").ok, false);
});

test("columns: rates are never counts, and an exact name beats a Total variant", () => {
  const m = guessMapping(["Date", "Campaign", "Total Purchases", "Purchases", "Purchase rate", "Click-throughs", "Sales"]);
  assert.equal(m.purchases, 3, "the plain Purchases column, not Total Purchases");
  assert.equal(m.clicks, 5);
  assert.equal(m.product_sales, 6);
  // "Purchase rate" must not be picked for anything.
  assert.notEqual(m.purchases, 4);
});

test("columns: only a Total variant present is still found", () => {
  const m = guessMapping(["Day", "Campaign name", "Total detail page views", "Total add to cart"]);
  assert.equal(m.date, 0);
  assert.equal(m.campaign, 1);
  assert.equal(m.detail_page_views, 2);
  assert.equal(m.add_to_carts, 3);
  assert.equal(m.clicks, -1);
});

test("numbers: both decimal conventions, currency signs, blanks and dashes", () => {
  const cases = {
    "1,234.56": 1234.56, "1.234,56": 1234.56, "1,234": 1234, "1.234": 1234, "12,5": 12.5, "12.5": 12.5,
    "0.500": 0.5, "1,234,567": 1234567, "€ 8,99": 8.99, "$1,299.00": 1299, "-": 0, "": 0, "N/A": 0,
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(parseNumber(text), expected, text);
  assert.ok(Number.isNaN(parseNumber("abc")));
  assert.ok(Number.isNaN(parseNumber("-5")), "negatives are rejected");
  assert.ok(Number.isNaN(parseNumber("(5)")));
});

test("dates: ISO, day-first, month-first and month names; impossible dates are refused", () => {
  assert.equal(parseDate("2026-09-01"), "2026-09-01");
  assert.equal(parseDate("2026-09-01T00:00:00Z"), "2026-09-01");
  assert.equal(parseDate("03/04/2026", { dayFirst: true }), "2026-04-03");
  assert.equal(parseDate("03/04/2026", { dayFirst: false }), "2026-03-04");
  assert.equal(parseDate("31.12.2026"), "2026-12-31");
  assert.equal(parseDate("Sep 3, 2026"), "2026-09-03");
  assert.equal(parseDate("3 September 2026"), "2026-09-03");
  assert.equal(parseDate("31/02/2026"), null, "31 February must not roll into March");
  assert.equal(parseDate("Total"), null);
  assert.equal(parseDate(""), null);
});

test("dates: day-first is detected when a date can only be one, and doubt is reported", () => {
  assert.deepEqual(detectDayFirst(["13/04/2026", "01/05/2026"]), { dayFirst: true, certain: true });
  assert.deepEqual(detectDayFirst(["04/13/2026", "05/01/2026"]), { dayFirst: false, certain: true });
  assert.equal(detectDayFirst(["01/02/2026", "03/04/2026"]).certain, false);
  assert.equal(detectDayFirst(["2026-09-01", "Sep 3, 2026"]).certain, true, "unambiguous formats raise no question");
});

test("a full report: ad groups merge, the totals row is left out, nothing is double-counted", () => {
  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);

  assert.equal(built.rows.length, 3, "two Spring Launch days and one Newsletter day");
  const day1 = built.rows.find((r) => r.date === "2026-09-01");
  assert.equal(day1.clicks, 200, "two ad groups on the same day are summed");
  assert.equal(day1.product_sales_cents, 3596);
  assert.equal(built.rows.find((r) => r.date === "2026-09-02").clicks, 1100);

  // 1315 clicks appear on the totals row; counting it would double them.
  assert.equal(built.totals.clicks, 200 + 1100 + 15);
  assert.equal(built.skipped.length, 1);
  assert.match(built.skipped[0].reason, /no valid date/);
  assert.deepEqual([...built.campaigns].sort(), ["Newsletter", "Spring Launch"]);
  assert.equal(built.from, "2026-09-01");
  assert.equal(built.to, "2026-09-03");
});

test("a report without dates needs a date to record it on", () => {
  const csv = "Campaign,Clicks,Purchases\nA,10,1\nB,5,0";
  const report = readReport(csv);
  assert.equal(report.mapping.date, -1);
  assert.equal(buildRows(report.data, report.mapping).rows.length, 0);
  const built = buildRows(report.data, report.mapping, { undatedDate: "2026-09-10" });
  assert.equal(built.rows.length, 2);
  assert.ok(built.rows.every((r) => r.date === "2026-09-10"));
});

test("a report without a campaign column uses one placeholder name", () => {
  const report = readReport("Date,Clicks\n2026-09-01,4\n2026-09-02,6");
  const built = buildRows(report.data, report.mapping);
  assert.deepEqual(built.campaigns, [UNNAMED_CAMPAIGN]);
  assert.equal(UNNAMED_CAMPAIGN, UNNAMED, "browser and server agree on the placeholder");
});

test("an unreadable figure skips the row and says why", () => {
  const report = readReport("Date,Campaign,Clicks\n2026-09-01,A,ten\n2026-09-02,A,5");
  const built = buildRows(report.data, report.mapping);
  assert.equal(built.rows.length, 1);
  assert.match(built.skipped[0].reason, /not a valid count/);
});

// --- Server side --------------------------------------------------------

const TODAY = "2026-09-18";
const good = (over = {}) => ({ campaign: "A", date: "2026-09-01", clicks: 5, detail_page_views: 4, add_to_carts: 1, purchases: 1, units_sold: 1, product_sales_cents: 899, ...over });
const kindle = (over = {}) => good({ kindle_pages_read: 1200, kindle_royalties_cents: 432, ...over });

test("server: valid rows pass, duplicates merge, order is by date", () => {
  const out = normaliseRows([good({ date: "2026-09-02" }), good(), good({ clicks: 10 })], TODAY);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].date, "2026-09-01");
  assert.equal(out.rows[0].clicks, 15, "the same campaign-day sent twice is summed");
  assert.equal(out.from, "2026-09-01");
  assert.equal(out.to, "2026-09-02");
});

test("server: a blank campaign gets the placeholder", () => {
  assert.equal(normaliseRows([good({ campaign: "  " })], TODAY).rows[0].campaign, UNNAMED);
});

test("server: refuses what a real import could never produce", () => {
  const bad = (row, pattern) => assert.throws(() => normaliseRows([row], TODAY), pattern);
  bad(good({ date: "2026-13-01" }), /not a date/);
  bad(good({ date: "01/09/2026" }), /not a date/);
  bad(good({ date: "2026-02-31" }), /not a date/);
  bad(good({ date: "2010-01-01" }), /outside the range/);
  bad(good({ date: "2027-01-01" }), /outside the range/);
  bad(good({ clicks: -1 }), /whole number/);
  bad(good({ clicks: 1.5 }), /whole number/);
  bad(good({ purchases: "many" }), /whole number/);
  bad(good({ product_sales_cents: -5 }), /valid amount/);
  bad(good({ product_sales_cents: 1.5 }), /valid amount/);
  assert.throws(() => normaliseRows([], TODAY), /no rows/);
  assert.throws(() => normaliseRows("nope", TODAY), /no rows/);
  assert.throws(() => normaliseRows([null], TODAY), /not a row/);
});

test("server: a request over the row limit is refused with advice", () => {
  const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => good({ campaign: `c${i}` }));
  assert.throws(() => normaliseRows(many, TODAY), /date ranges/);
});

test("server: a date up to tomorrow is allowed, for timezones ahead of the server", () => {
  assert.doesNotThrow(() => normaliseRows([good({ date: "2026-09-19" })], TODAY));
  assert.throws(() => normaliseRows([good({ date: "2026-09-20" })], TODAY), /outside the range/);
});

test("server: the stored row carries the owner and never trusts a client id", () => {
  const row = toDbRow(normaliseRows([good()], TODAY).rows[0], { userId: "u1", currency: "EUR", campaignId: "c1", bookId: "b1" });
  assert.equal(row.user_id, "u1");
  assert.equal(row.external_campaign, "A");
  assert.equal(row.campaign_id, "c1");
  assert.equal(row.book_id, "b1");
});

test("summary and totals: figures are summed, and mixed currencies are flagged not added up", () => {
  const rows = [
    { metric_date: "2026-09-01", external_campaign: "A", currency: "EUR", imported_at: "2026-09-10T10:00:00Z", clicks: 10, detail_page_views: 8, add_to_carts: 2, purchases: 1, units_sold: 1, product_sales_cents: 899 },
    { metric_date: "2026-09-02", external_campaign: "B", currency: "EUR", imported_at: "2026-09-11T10:00:00Z", clicks: 5, detail_page_views: 4, add_to_carts: 1, purchases: 0, units_sold: 0, product_sales_cents: 0 },
  ];
  const s = summarise(rows);
  assert.deepEqual([s.rows, s.days, s.campaigns, s.from, s.to], [2, 2, ["A", "B"], "2026-09-01", "2026-09-02"]);
  assert.equal(s.last_imported_at, "2026-09-11T10:00:00Z");

  const t = totalsOf(rows);
  assert.equal(t.clicks, 15);
  assert.equal(t.productSalesCents, 899);
  assert.equal(t.currency, "EUR");
  assert.equal(t.mixedCurrencies, false);

  const mixed = totalsOf([...rows, { ...rows[0], currency: "USD", metric_date: "2026-09-03" }]);
  assert.equal(mixed.mixedCurrencies, true);
  assert.equal(mixed.currency, null);

  assert.equal(totalsOf([]), null);
  assert.deepEqual(summarise([]).campaigns, []);
});

// --- Demo workspace -----------------------------------------------------

test("demo: import, replace on re-import, feed analytics, and remove", async () => {
  resetDemo();
  assert.equal((await demoAdapter.request("GET", "/api/bp/amazon-import")).summary.rows, 0);
  const before = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(before.amazon, null);

  const report = readReport(SAMPLE);
  const built = buildRows(report.data, report.mapping);
  const res = await demoAdapter.request("POST", "/api/bp/amazon-import", { rows: built.rows, currency: "EUR", links: [] });
  assert.equal(res.imported, 3);

  let analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(analytics.amazon.clicks, 1315);
  assert.equal(analytics.amazon.currency, "EUR");

  // Importing the same report again replaces those days; it does not double them.
  await demoAdapter.request("POST", "/api/bp/amazon-import", { rows: built.rows, currency: "EUR", links: [] });
  analytics = await demoAdapter.request("GET", "/api/bp/analytics?days=30");
  assert.equal(analytics.amazon.clicks, 1315, "a re-import replaces, never adds");
  assert.equal((await demoAdapter.request("GET", "/api/bp/amazon-import")).summary.rows, 3);

  // Amazon figures are reported on their own and never enter the totals.
  assert.deepEqual(analytics.totals, before.totals);

  await demoAdapter.request("DELETE", "/api/bp/amazon-import");
  assert.equal((await demoAdapter.request("GET", "/api/bp/analytics?days=30")).amazon, null);
});

// --- Kindle pages read ----------------------------------------------------------

test("Kindle pages and royalties are validated like the other figures, and merged per campaign and day", () => {
  const out = normaliseRows([kindle(), kindle({ kindle_pages_read: 300, kindle_royalties_cents: 108 })], TODAY);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].kindle_pages_read, 1500);
  assert.equal(out.rows[0].kindle_royalties_cents, 540);
  assert.equal(out.rows[0].product_sales_cents, 899 * 2, "royalties stay out of product sales");

  assert.equal(normaliseRows([good()], TODAY).rows[0].kindle_pages_read, 0, "a report without them reads as zero");
  assert.throws(() => normaliseRows([kindle({ kindle_pages_read: -1 })], TODAY), /kindle_pages_read/);
  assert.throws(() => normaliseRows([kindle({ kindle_pages_read: 1.5 })], TODAY), /kindle_pages_read/);
  assert.throws(() => normaliseRows([kindle({ kindle_royalties_cents: -5 })], TODAY), /Kindle royalties/);
  assert.throws(() => normaliseRows([kindle({ kindle_royalties_cents: "lots" })], TODAY), /Kindle royalties/);
});

test("Kindle figures are stored in their own columns and totalled apart from sales", () => {
  const row = toDbRow(normaliseRows([kindle()], TODAY).rows[0], { userId: "u1", currency: "EUR" });
  assert.equal(row.kindle_pages_read, 1200);
  assert.equal(row.kindle_royalties_cents, 432);
  assert.equal(row.product_sales_cents, 899);

  const totals = totalsOf([
    { metric_date: "2026-09-01", external_campaign: "A", currency: "EUR", clicks: 1, kindle_pages_read: 1200, kindle_royalties_cents: 432, product_sales_cents: 899 },
    { metric_date: "2026-09-02", external_campaign: "A", currency: "EUR", clicks: 1 },
  ]);
  assert.equal(totals.kindlePagesRead, 1200);
  assert.equal(totals.kindleRoyaltiesCents, 432);
  assert.equal(totals.productSalesCents, 899);
});

test("a CSV with Kindle columns has them found, imported, and totalled; without them nothing changes", () => {
  const csv = [
    "Date,Campaign,Click-throughs,Purchases,Product sales,Kindle Edition Normalized Pages Read,Kindle Edition Normalized Page Royalties",
    "2026-09-01,A,10,1,8.99,1200,4.32",
    "2026-09-02,A,5,0,0,300,1.08",
  ].join("\n");
  const report = readReport(csv);
  assert.ok(report.mapping.kindle_pages_read !== -1, "pages read column found");
  assert.ok(report.mapping.kindle_royalties !== -1, "royalties column found");
  assert.notEqual(report.mapping.kindle_pages_read, report.mapping.kindle_royalties);
  assert.notEqual(report.mapping.product_sales, report.mapping.kindle_royalties, "royalties are not mistaken for sales");

  const built = buildRows(report.data, report.mapping);
  assert.equal(built.totals.kindle_pages_read, 1500);
  assert.equal(built.totals.kindle_royalties_cents, 540);
  assert.equal(built.totals.product_sales_cents, 899);
  assert.equal(built.rows[0].kindle_pages_read, 1200);
  assert.equal(normaliseRows(built.rows, TODAY).rows.length, 2, "and the server accepts what the browser built");

  const plain = buildRows(readReport("Date,Campaign,Clicks\n2026-09-01,A,10").data, { date: 0, campaign: 1, clicks: 2, detail_page_views: -1, add_to_carts: -1, purchases: -1, units_sold: -1, product_sales: -1 });
  assert.equal(plain.rows[0].kindle_pages_read, 0, "an older mapping without the Kindle keys still works");
  assert.equal(plain.totals.kindle_royalties_cents, 0);
});
