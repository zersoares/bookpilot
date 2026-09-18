// Reading a TikTok Ads Manager report.
//
// BookPilot does not connect to TikTok's API (that needs an approved
// TikTok developer app). What an advertiser can always do is export a
// report from Ads Manager as CSV, so this turns one into daily
// campaign-level rows: spend, impressions, clicks, conversions, revenue.
//
// It needs a daily breakdown. A report that only totals a period cannot be
// placed on days without inventing a trend, so it is refused with the
// instruction to export "by day". Reach is left out on purpose: it is a
// count of unique people, and summing it across ad groups counts the same
// person more than once.

import {
  parseCsv, parseNumber, parseDate, detectDayFirst,
  guessMapping as guess, findHeaderRow as findHeader,
} from "./report-parse.js";

export const FIELDS = [
  { key: "campaign", label: "Campaign", metric: false,
    synonyms: ["campaign name", "campaign", "campaign_name"] },
  { key: "date", label: "Date", metric: false,
    synonyms: ["date", "by day", "stat time day", "stat_time_day", "day"] },
  { key: "impressions", label: "Impressions", metric: true,
    synonyms: ["impressions", "impression"] },
  { key: "clicks", label: "Clicks", metric: true,
    synonyms: ["clicks (destination)", "clicks destination", "clicks", "clicks (all)", "link clicks", "click"] },
  { key: "spend", label: "Spend", metric: true,
    synonyms: ["cost", "spend", "total cost", "amount spent", "total spend"] },
  { key: "conversions", label: "Conversions (purchases)", metric: true,
    synonyms: ["complete payment", "total complete payment", "purchases", "website purchases", "purchase", "conversions", "conversion", "results", "result"] },
  { key: "revenue", label: "Purchase value", metric: true,
    synonyms: ["complete payment value", "total complete payment value", "purchase value", "total purchase value", "conversion value", "revenue", "value"] },
];

export const UNNAMED_CAMPAIGN = "TikTok (all campaigns)";

export const guessMapping = (headers) => guess(headers, FIELDS);
export const findHeaderRow = (rows) => findHeader(rows, FIELDS);

/**
 * Turn the table under a chosen mapping into one row per campaign per day,
 * saying what was left out and why.
 */
export function buildRows(dataRows, mapping, { dayFirst = true } = {}) {
  const skipped = [];
  const byKey = new Map();
  const totals = { impressions: 0, clicks: 0, spend_cents: 0, conversions: 0, revenue_cents: 0 };

  if (mapping.date === -1) {
    return { rows: [], skipped, totals, campaigns: [], from: null, to: null, needsDate: true };
  }

  dataRows.forEach((cells, index) => {
    const line = index + 1; // the data row, counted from the one under the headings
    if (!cells.some((c) => String(c).trim() !== "")) return;

    const date = parseDate(cells[mapping.date], { dayFirst });
    if (!date) { skipped.push({ line, reason: "no valid date (a totals or summary row)" }); return; }

    const counts = {};
    for (const key of ["impressions", "clicks", "conversions"]) {
      const n = mapping[key] === -1 ? 0 : parseNumber(cells[mapping[key]]);
      // A conversion count can be fractional in some attributed views;
      // it is stored as a whole number, like every other count.
      if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping[key]]}" is not a valid count` }); return; }
      counts[key] = Math.round(n);
    }
    const money = {};
    for (const [key, out] of [["spend", "spend_cents"], ["revenue", "revenue_cents"]]) {
      const n = mapping[key] === -1 ? 0 : parseNumber(cells[mapping[key]]);
      if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping[key]]}" is not a valid amount` }); return; }
      money[out] = Math.round(n * 100);
    }

    const campaign = (mapping.campaign !== -1 ? String(cells[mapping.campaign]).trim() : "") || UNNAMED_CAMPAIGN;
    // JSON keeps the pair unambiguous whatever characters a name holds.
    const key = JSON.stringify([campaign, date]);
    const row = byKey.get(key) || { campaign, date, impressions: 0, clicks: 0, spend_cents: 0, conversions: 0, revenue_cents: 0 };
    for (const k of Object.keys(counts)) { row[k] += counts[k]; totals[k] += counts[k]; }
    for (const k of Object.keys(money)) { row[k] += money[k]; totals[k] += money[k]; }
    byKey.set(key, row);
  });

  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));
  return {
    rows, skipped, totals,
    campaigns: [...new Set(rows.map((r) => r.campaign))],
    from: rows[0]?.date || null,
    to: rows[rows.length - 1]?.date || null,
  };
}

/** A first look at a file: header row, data, guessed columns, date format. */
export function readReport(text) {
  const { delimiter, rows } = parseCsv(text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) return { ok: false, delimiter, reason: "no_header" };
  const headers = rows[headerIndex].map((h) => String(h).trim());
  const data = rows.slice(headerIndex + 1);
  const mapping = guessMapping(headers);
  const dateFormat = mapping.date === -1
    ? { dayFirst: true, certain: true }
    : detectDayFirst(data.map((r) => r[mapping.date]));
  return { ok: true, delimiter, headers, data, mapping, dateFormat, preamble: headerIndex };
}
