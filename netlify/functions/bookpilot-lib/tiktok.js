// TikTok Ads report imports: validation and summaries.
//
// The browser parses the author's Ads Manager CSV and sends daily
// campaign-level rows; nothing it says is trusted. Every value is
// re-checked here and duplicates are merged, so a hand-built request
// cannot store anything a real import could not.
//
// Pure functions, no I/O, so the rules can be tested without a database.

import { Errors } from "./errors.js";

export const MAX_ROWS = 3000;
export const UNNAMED = "TikTok (all campaigns)";

const MAX_COUNT = 10_000_000_000;
const MAX_CENTS = 100_000_000_000; // 1bn in currency units
const EARLIEST = "2018-01-01"; // TikTok for Business launched in 2018; earlier is a typo

const COUNTS = ["impressions", "clicks", "conversions"];
const MONEY = ["spend_cents", "revenue_cents"];

function whole(value, field, line, max) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw Errors.invalid(`Row ${line}: ${field.replace("_cents", "")} is not a valid ${MONEY.includes(field) ? "amount" : "count"}.`);
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
 */
export function normaliseRows(input, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(input) || input.length === 0) throw Errors.invalid("There are no rows to import.");
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
      throw Errors.invalid(`Row ${line}: ${raw.date} is outside the range TikTok Ads can report on.`);
    }
    const campaign = (typeof raw.campaign === "string" ? raw.campaign.trim() : "").slice(0, 200) || UNNAMED;

    const key = JSON.stringify([campaign, raw.date]);
    const row = merged.get(key) || { campaign, date: raw.date, impressions: 0, clicks: 0, conversions: 0, spend_cents: 0, revenue_cents: 0 };
    for (const f of COUNTS) row[f] += whole(raw[f], f, line, MAX_COUNT);
    for (const f of MONEY) row[f] += whole(raw[f], f, line, MAX_CENTS);
    if (COUNTS.some((f) => row[f] > MAX_COUNT) || MONEY.some((f) => row[f] > MAX_CENTS)) {
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

/** The stored performance row: campaign and day level, so no ad id. */
export function toPerformanceRow(row, campaignId) {
  return {
    campaign_id: campaignId,
    ad_id: null,
    metric_date: row.date,
    source: "tiktok",
    impressions: row.impressions,
    reach: 0, // unique reach cannot be summed across ad groups, so it is not imported
    clicks: row.clicks,
    spend_cents: row.spend_cents,
    conversions: row.conversions,
    revenue_cents: row.revenue_cents,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Which BookPilot campaign each TikTok campaign name lands on. Every name
 * in the report needs a target: an existing tracking campaign, or a book to
 * create one under. Returns a Map name -> { campaignId } | { bookId }.
 */
export function resolveTargets(names, targets) {
  const byName = new Map();
  for (const t of Array.isArray(targets) ? targets.slice(0, 200) : []) {
    if (t && typeof t.campaign === "string") byName.set(t.campaign, t);
  }
  const out = new Map();
  for (const name of names) {
    const t = byName.get(name);
    if (t?.campaign_id) out.set(name, { campaignId: t.campaign_id });
    else if (t?.book_id) out.set(name, { bookId: t.book_id });
    else throw Errors.invalid(`Choose where "${name.slice(0, 60)}" goes: an existing campaign, or a book to create one for.`);
  }
  return out;
}

/** What the TikTok card shows about existing imports. */
export function summarise(perfRows, campaignNames = new Map()) {
  if (!perfRows.length) return { days: 0, rows: 0, campaigns: [], from: null, to: null, last_imported_at: null };
  const dates = perfRows.map((r) => r.metric_date).sort();
  const synced = perfRows.map((r) => r.synced_at).filter(Boolean).sort();
  return {
    days: new Set(perfRows.map((r) => r.metric_date)).size,
    rows: perfRows.length,
    campaigns: [...new Set(perfRows.map((r) => campaignNames.get(r.campaign_id) || "Unnamed"))].sort(),
    from: dates[0],
    to: dates[dates.length - 1],
    last_imported_at: synced.length ? synced[synced.length - 1] : null,
  };
}
