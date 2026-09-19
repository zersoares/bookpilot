// Amazon Attribution imports: validation and summaries.
//
// The browser parses the author's CSV and sends rows; nothing it says is
// trusted. Every value is re-checked here, and duplicates are merged, so a
// hand-built request cannot store anything a real import could not.
//
// Pure functions, no I/O, so the rules can be tested without a database.

import { Errors } from "./errors.js";

export const MAX_ROWS = 3000;
export const UNNAMED = "Amazon Attribution (all campaigns)";

const MAX_COUNT = 1_000_000_000;
const MAX_SALES_CENTS = 100_000_000_000; // 1bn in currency units
const EARLIEST = "2015-01-01"; // Amazon Attribution launched in 2018; earlier is a typo

// Kindle pages read are pages read by Kindle Unlimited readers within 14 days
// of an ad click; their royalties are Amazon's estimate. Both are kept in
// columns of their own and never added to product sales.
const COUNT_FIELDS = ["clicks", "detail_page_views", "add_to_carts", "purchases", "units_sold", "kindle_pages_read"];
const MONEY_FIELDS = [["product_sales_cents", "product sales"], ["kindle_royalties_cents", "Kindle royalties"]];

function count(value, field, line) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
    throw Errors.invalid(`Row ${line}: ${field} must be a whole number from 0 to ${MAX_COUNT.toLocaleString("en")}.`);
  }
  return n;
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validate and merge the rows of an import.
 *
 * @param {unknown} input   the `rows` array from the request
 * @param {string}  today   ISO date, injectable for tests
 * @returns {{ rows: object[], from: string, to: string, campaigns: string[] }}
 */
export function normaliseRows(input, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(input) || input.length === 0) {
    throw Errors.invalid("There are no rows to import.");
  }
  if (input.length > MAX_ROWS) {
    throw Errors.invalid(
      `That report has ${input.length.toLocaleString("en")} campaign-days; the limit is ${MAX_ROWS.toLocaleString("en")} per import. Import it in date ranges.`
    );
  }
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const merged = new Map();
  input.forEach((raw, index) => {
    const line = index + 1;
    if (!raw || typeof raw !== "object") throw Errors.invalid(`Row ${line} is not a row.`);
    if (!isRealDate(raw.date)) throw Errors.invalid(`Row ${line}: "${String(raw.date).slice(0, 20)}" is not a date.`);
    if (raw.date < EARLIEST || raw.date > tomorrow) {
      throw Errors.invalid(`Row ${line}: ${raw.date} is outside the range Amazon Attribution can report on.`);
    }
    const campaign = (typeof raw.campaign === "string" ? raw.campaign.trim() : "").slice(0, 200) || UNNAMED;

    const money = {};
    for (const [field, label] of MONEY_FIELDS) {
      const amount = Number(raw[field] ?? 0);
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_SALES_CENTS) {
        throw Errors.invalid(`Row ${line}: ${label} is not a valid amount.`);
      }
      money[field] = amount;
    }

    const key = `${campaign}|${raw.date}`;
    const row = merged.get(key) || {
      campaign, date: raw.date, clicks: 0, detail_page_views: 0, add_to_carts: 0,
      purchases: 0, units_sold: 0, kindle_pages_read: 0, product_sales_cents: 0, kindle_royalties_cents: 0,
    };
    for (const field of COUNT_FIELDS) row[field] += count(raw[field] ?? 0, field, line);
    for (const [field] of MONEY_FIELDS) row[field] += money[field];
    if (COUNT_FIELDS.some((f) => row[f] > MAX_COUNT) || MONEY_FIELDS.some(([f]) => row[f] > MAX_SALES_CENTS)) {
      throw Errors.invalid(`Row ${line}: the merged total for ${campaign} on ${raw.date} is implausibly large.`);
    }
    merged.set(key, row);
  });

  const rows = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));
  return {
    rows,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    campaigns: [...new Set(rows.map((r) => r.campaign))],
  };
}

/** The stored-row shape for the database. */
export function toDbRow(row, { userId, currency, campaignId = null, bookId = null }) {
  return {
    user_id: userId,
    external_campaign: row.campaign,
    metric_date: row.date,
    clicks: row.clicks,
    detail_page_views: row.detail_page_views,
    add_to_carts: row.add_to_carts,
    purchases: row.purchases,
    units_sold: row.units_sold,
    kindle_pages_read: row.kindle_pages_read ?? 0,
    product_sales_cents: row.product_sales_cents,
    kindle_royalties_cents: row.kindle_royalties_cents ?? 0,
    currency,
    campaign_id: campaignId,
    book_id: bookId,
    imported_at: new Date().toISOString(),
  };
}

/** What the Attribution card shows about existing imports. */
export function summarise(dbRows) {
  if (!dbRows.length) return { days: 0, rows: 0, campaigns: [], from: null, to: null, last_imported_at: null, currencies: [] };
  const dates = dbRows.map((r) => r.metric_date).sort();
  const imported = dbRows.map((r) => r.imported_at).filter(Boolean).sort();
  return {
    days: new Set(dbRows.map((r) => r.metric_date)).size,
    rows: dbRows.length,
    campaigns: [...new Set(dbRows.map((r) => r.external_campaign))].sort(),
    from: dates[0],
    to: dates[dates.length - 1],
    last_imported_at: imported.length ? imported[imported.length - 1] : null,
    currencies: [...new Set(dbRows.map((r) => r.currency))],
  };
}

/** Sum stored rows for the analytics panel. Amazon figures, on their own. */
export function totalsOf(dbRows) {
  if (!dbRows.length) return null;
  const sum = (field) => dbRows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
  const summary = summarise(dbRows);
  return {
    clicks: sum("clicks"),
    detailPageViews: sum("detail_page_views"),
    addToCarts: sum("add_to_carts"),
    purchases: sum("purchases"),
    unitsSold: sum("units_sold"),
    kindlePagesRead: sum("kindle_pages_read"),
    kindleRoyaltiesCents: sum("kindle_royalties_cents"),
    productSalesCents: sum("product_sales_cents"),
    // Amazon reports each import in one currency; if a workspace mixes
    // them the panel must not present a single-currency sum as one.
    currency: summary.currencies.length === 1 ? summary.currencies[0] : null,
    mixedCurrencies: summary.currencies.length > 1,
    from: summary.from,
    to: summary.to,
    importedAt: summary.last_imported_at,
  };
}
