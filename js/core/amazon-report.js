// Reading an Amazon Attribution report.
//
// Amazon does not let third-party tools read Attribution data without
// approved Amazon Ads API access, but the console lets an advertiser
// download its reports as CSV. This turns one of those files into rows
// BookPilot can store.
//
// Amazon's exports vary — column names change between report types and
// marketplaces, files carry preamble lines and a totals row, and numbers
// come in "1,234.56" and "1.234,56" forms — so nothing here assumes one
// layout. It guesses, and the screen shows the guess for the author to
// correct before anything is imported.
//
// Pure functions, no DOM and no network, so the awkward cases can be
// tested. Runs in the browser; the server re-validates everything.

export const FIELDS = [
  { key: "campaign", label: "Campaign", metric: false,
    synonyms: ["campaign", "campaign name", "campaignname", "campaign id"] },
  { key: "date", label: "Date", metric: false,
    synonyms: ["date", "day", "report date", "reporting date", "start date", "click date"] },
  { key: "clicks", label: "Clicks", metric: true,
    synonyms: ["click-throughs", "clickthroughs", "click throughs", "clicks", "total clicks"] },
  { key: "detail_page_views", label: "Detail page views", metric: true,
    synonyms: ["detail page views", "detail page view", "dpv", "detail page views (dpv)", "total detail page views"] },
  { key: "add_to_carts", label: "Add to cart", metric: true,
    synonyms: ["add to cart", "add to carts", "add-to-cart", "atc", "total add to cart", "total add to carts"] },
  { key: "purchases", label: "Purchases", metric: true,
    synonyms: ["purchases", "orders", "total purchases", "purchase"] },
  { key: "units_sold", label: "Units sold", metric: true,
    synonyms: ["units sold", "units", "total units sold", "units ordered"] },
  { key: "product_sales", label: "Product sales", metric: true,
    synonyms: ["product sales", "sales", "total product sales", "total sales", "revenue", "ordered product sales"] },
];

import {
  parseCsv, parseNumber, parseDate, detectDayFirst,
  guessMapping as guess, findHeaderRow as findHeader,
} from "./report-parse.js";

export { parseCsv, parseNumber, parseDate, detectDayFirst };

export const guessMapping = (headers) => guess(headers, FIELDS);
export const findHeaderRow = (rows) => findHeader(rows, FIELDS);

// --- Rows --------------------------------------------------------------

export const UNNAMED_CAMPAIGN = "Amazon Attribution (all campaigns)";

/**
 * Turn the table under a chosen mapping into importable rows, one per
 * campaign per day. Also says what it left out and why, because a
 * silent skip is how an import ends up quietly wrong.
 *
 * @param {string[][]} dataRows   rows below the header
 * @param {object} mapping        field key -> column index or -1
 * @param {object} options        { dayFirst, undatedDate }
 */
export function buildRows(dataRows, mapping, { dayFirst = true, undatedDate = null } = {}) {
  const dated = mapping.date !== -1;
  const skipped = [];
  const byKey = new Map();
  const totals = { clicks: 0, detail_page_views: 0, add_to_carts: 0, purchases: 0, units_sold: 0, product_sales_cents: 0 };

  dataRows.forEach((cells, index) => {
    const line = index + 1; // the data row, counted from the one under the headings
    if (!cells.some((c) => String(c).trim() !== "")) return;

    let date = undatedDate;
    if (dated) {
      date = parseDate(cells[mapping.date], { dayFirst });
      if (!date) { skipped.push({ line, reason: "no valid date (a totals or summary row)" }); return; }
    }
    if (!date) { skipped.push({ line, reason: "no date to record it on" }); return; }

    const counts = {};
    for (const key of ["clicks", "detail_page_views", "add_to_carts", "purchases", "units_sold"]) {
      const n = mapping[key] === -1 ? 0 : parseNumber(cells[mapping[key]]);
      if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping[key]]}" is not a valid count` }); return; }
      counts[key] = Math.round(n);
    }
    let salesCents = 0;
    if (mapping.product_sales !== -1) {
      const n = parseNumber(cells[mapping.product_sales]);
      if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping.product_sales]}" is not a valid amount` }); return; }
      salesCents = Math.round(n * 100);
    }

    const campaign = (mapping.campaign !== -1 ? String(cells[mapping.campaign]).trim() : "") || UNNAMED_CAMPAIGN;
    const key = `${campaign}\u0000${date}`;
    const row = byKey.get(key) || { campaign, date, clicks: 0, detail_page_views: 0, add_to_carts: 0, purchases: 0, units_sold: 0, product_sales_cents: 0 };
    for (const k of Object.keys(counts)) { row[k] += counts[k]; totals[k] += counts[k]; }
    row.product_sales_cents += salesCents;
    totals.product_sales_cents += salesCents;
    byKey.set(key, row);
  });

  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));
  return {
    rows,
    skipped,
    totals,
    campaigns: [...new Set(rows.map((r) => r.campaign))],
    from: rows[0]?.date || null,
    to: rows[rows.length - 1]?.date || null,
  };
}

/**
 * Everything a first look at a file needs: the header row, the data
 * beneath it, the guessed columns and the date format.
 */
export function readReport(text) {
  const { delimiter, rows } = parseCsv(text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) return { ok: false, delimiter, reason: "no_header" };
  const headers = rows[headerIndex].map((h) => String(h).trim());
  const data = rows.slice(headerIndex + 1);
  const mapping = guessMapping(headers);
  const dateFormat = mapping.date === -1 ? { dayFirst: true, certain: true } : detectDayFirst(data.map((r) => r[mapping.date]));
  return { ok: true, delimiter, headers, data, mapping, dateFormat, preamble: headerIndex };
}
