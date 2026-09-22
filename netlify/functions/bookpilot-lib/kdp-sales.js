// KDP sales & royalties imports: validation and summaries.
//
// The browser parses the author's CSV and sends rows; nothing it says is
// trusted. Every value is re-checked here, and duplicates are merged, so a
// hand-built request cannot store anything a real import could not.
//
// This is the whole-book picture (every sale, not just ad-attributed
// ones), kept in kdp_royalty_metrics — a table of its own, never summed
// with amazon_attribution_metrics.
//
// Pure functions, no I/O, so the rules can be tested without a database.

import { Errors } from "./errors.js";

export const MAX_ROWS = 3000;
export const UNTITLED = "KDP (title not given)";
export const UNKNOWN_MARKET = "Amazon.com";

const MAX_COUNT = 1_000_000_000;
const MAX_MONEY_CENTS = 100_000_000_000; // 1bn in currency units
const EARLIEST = "2007-01-01"; // Kindle launched November 2007; earlier is a typo

const COUNT_FIELDS = ["units_sold", "units_refunded", "net_units_sold", "kenp_pages_read"];
const MONEY_FIELDS = [["royalty_cents", "royalty"], ["kenp_royalty_cents", "Kindle page-read royalty"]];

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
 * @returns {{ rows: object[], from: string, to: string, titles: string[], marketplaces: string[] }}
 */
export function normaliseRows(input, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(input) || input.length === 0) {
    throw Errors.invalid("There are no rows to import.");
  }
  if (input.length > MAX_ROWS) {
    throw Errors.invalid(
      `That report has ${input.length.toLocaleString("en")} title-days; the limit is ${MAX_ROWS.toLocaleString("en")} per import. Import it in date ranges.`
    );
  }
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const merged = new Map();
  input.forEach((raw, index) => {
    const line = index + 1;
    if (!raw || typeof raw !== "object") throw Errors.invalid(`Row ${line} is not a row.`);
    if (!isRealDate(raw.date)) throw Errors.invalid(`Row ${line}: "${String(raw.date).slice(0, 20)}" is not a date.`);
    if (raw.date < EARLIEST || raw.date > tomorrow) {
      throw Errors.invalid(`Row ${line}: ${raw.date} is outside the range a KDP royalty report can cover.`);
    }
    const title = (typeof raw.title === "string" ? raw.title.trim() : "").slice(0, 300) || UNTITLED;
    const marketplace = (typeof raw.marketplace === "string" ? raw.marketplace.trim() : "").slice(0, 100) || UNKNOWN_MARKET;

    const money = {};
    for (const [field, label] of MONEY_FIELDS) {
      const amount = Number(raw[field] ?? 0);
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_MONEY_CENTS) {
        throw Errors.invalid(`Row ${line}: ${label} is not a valid amount.`);
      }
      money[field] = amount;
    }

    const key = `${title}|${marketplace}|${raw.date}`;
    const row = merged.get(key) || {
      title, marketplace, date: raw.date, units_sold: 0, units_refunded: 0, net_units_sold: 0,
      kenp_pages_read: 0, royalty_cents: 0, kenp_royalty_cents: 0,
    };
    for (const field of COUNT_FIELDS) row[field] += count(raw[field] ?? 0, field, line);
    for (const [field] of MONEY_FIELDS) row[field] += money[field];
    if (COUNT_FIELDS.some((f) => row[f] > MAX_COUNT) || MONEY_FIELDS.some(([f]) => row[f] > MAX_MONEY_CENTS)) {
      throw Errors.invalid(`Row ${line}: the merged total for ${title} on ${raw.date} is implausibly large.`);
    }
    merged.set(key, row);
  });

  const rows = [...merged.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.marketplace.localeCompare(b.marketplace));
  return {
    rows,
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    titles: [...new Set(rows.map((r) => r.title))],
    marketplaces: [...new Set(rows.map((r) => r.marketplace))],
  };
}

/** The stored-row shape for the database. */
export function toDbRow(row, { userId, currency, bookId = null }) {
  return {
    user_id: userId,
    external_title: row.title,
    marketplace: row.marketplace,
    metric_date: row.date,
    units_sold: row.units_sold,
    units_refunded: row.units_refunded,
    net_units_sold: row.net_units_sold,
    kenp_pages_read: row.kenp_pages_read ?? 0,
    royalty_cents: row.royalty_cents,
    kenp_royalty_cents: row.kenp_royalty_cents ?? 0,
    currency,
    book_id: bookId,
    imported_at: new Date().toISOString(),
  };
}

/** What the import card shows about existing imports. */
export function summarise(dbRows) {
  if (!dbRows.length) return { days: 0, rows: 0, titles: [], from: null, to: null, last_imported_at: null, currencies: [] };
  const dates = dbRows.map((r) => r.metric_date).sort();
  const imported = dbRows.map((r) => r.imported_at).filter(Boolean).sort();
  return {
    days: new Set(dbRows.map((r) => r.metric_date)).size,
    rows: dbRows.length,
    titles: [...new Set(dbRows.map((r) => r.external_title))].sort(),
    from: dates[0],
    to: dates[dates.length - 1],
    last_imported_at: imported.length ? imported[imported.length - 1] : null,
    currencies: [...new Set(dbRows.map((r) => r.currency))],
  };
}

/** Sum stored rows for the analytics panel: the whole book, not just ads. */
export function totalsOf(dbRows) {
  if (!dbRows.length) return null;
  const sum = (field) => dbRows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
  const summary = summarise(dbRows);
  return {
    unitsSold: sum("units_sold"),
    unitsRefunded: sum("units_refunded"),
    netUnitsSold: sum("net_units_sold"),
    kenpPagesRead: sum("kenp_pages_read"),
    kenpRoyaltyCents: sum("kenp_royalty_cents"),
    royaltyCents: sum("royalty_cents"),
    // A KDP report is one currency at a time; a workspace that has
    // imported more than one must not present a single-currency sum as one.
    currency: summary.currencies.length === 1 ? summary.currencies[0] : null,
    mixedCurrencies: summary.currencies.length > 1,
    from: summary.from,
    to: summary.to,
    importedAt: summary.last_imported_at,
  };
}
