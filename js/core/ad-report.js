// Reading an ad-platform report (TikTok Ads Manager, Google Ads).
//
// BookPilot does not connect to these platforms' APIs (that needs an
// approved developer app or token). What an advertiser can always do is
// export a report as CSV, so this turns one into daily campaign-level
// rows: spend, impressions, clicks, conversions, purchase value.
//
// It needs a daily breakdown. A report that only totals a period cannot be
// placed on days without inventing a trend, so it is refused with the
// instruction to export "by day". Reach is left out on purpose: it is a
// count of unique people, and summing it across ad groups counts the same
// person more than once.
//
// What differs between platforms is only a set of column names; the
// parsing, the totals-row handling and the rules are shared.

import {
  parseCsv, parseNumber, parseDate, detectDayFirst,
  guessMapping as guess, findHeaderRow as findHeader,
} from "./report-parse.js";

const field = (key, label, metric, synonyms) => ({ key, label, metric, synonyms });

export const PLATFORM_REPORTS = {
  tiktok: {
    name: "TikTok Ads",
    tool: "TikTok Ads Manager",
    unnamed: "TikTok (all campaigns)",
    fields: [
      field("campaign", "Campaign", false, ["campaign name", "campaign", "campaign_name"]),
      field("date", "Date", false, ["date", "by day", "stat time day", "stat_time_day", "day"]),
      field("impressions", "Impressions", true, ["impressions", "impression"]),
      field("clicks", "Clicks", true, ["clicks (destination)", "clicks destination", "clicks", "clicks (all)", "link clicks", "click"]),
      field("spend", "Spend", true, ["cost", "spend", "total cost", "amount spent", "total spend"]),
      field("conversions", "Conversions (purchases)", true,
        ["complete payment", "total complete payment", "purchases", "website purchases", "purchase", "conversions", "conversion", "results", "result"]),
      field("revenue", "Purchase value", true,
        ["complete payment value", "total complete payment value", "purchase value", "total purchase value", "conversion value", "revenue", "value"]),
    ],
  },
  google: {
    name: "Google Ads",
    tool: "Google Ads",
    unnamed: "Google Ads (all campaigns)",
    fields: [
      field("campaign", "Campaign", false, ["campaign", "campaign name"]),
      field("date", "Date", false, ["day", "date"]),
      field("impressions", "Impressions", true, ["impr", "impressions"]),
      field("clicks", "Clicks", true, ["clicks", "click"]),
      field("spend", "Spend", true, ["cost", "spend", "total cost"]),
      field("conversions", "Conversions", true, ["conversions", "all conv", "all conversions", "conv"]),
      field("revenue", "Conversion value", true, ["conv value", "conversion value", "all conv value", "total conv value", "conversions value"]),
      // Google's export names the account currency in a column of its own.
      field("currency", "Currency", false, ["currency code", "currency"]),
    ],
  },
  pinterest: {
    name: "Pinterest Ads",
    tool: "Pinterest Ads Manager",
    unnamed: "Pinterest (all campaigns)",
    fields: [
      field("campaign", "Campaign", false, ["campaign name", "campaign"]),
      field("date", "Date", false, ["date", "day"]),
      field("impressions", "Impressions", true, ["impressions", "impression"]),
      // Outbound clicks are the ones that reached the author's site; a Pin
      // click can be a look at the Pin itself, so it is the last resort.
      field("clicks", "Clicks", true, ["outbound clicks", "link clicks", "clicks", "pin clicks"]),
      field("spend", "Spend", true, ["spend", "total spend", "amount spent"]),
      field("conversions", "Conversions (checkouts)", true,
        ["checkouts", "total checkouts", "web checkouts", "purchases", "total conversions", "conversions", "results"]),
      field("revenue", "Checkout value", true,
        ["checkout value", "total checkout value", "web checkout value", "order value", "total order value", "conversion value", "total conversion value", "revenue"]),
      field("currency", "Currency", false, ["currency", "account currency", "currency code"]),
    ],
  },
};

/** The reader for one platform's reports. */
export function reportFor(platform) {
  const config = PLATFORM_REPORTS[platform];
  if (!config) throw new Error(`No report format for ${platform}`);
  const { fields, unnamed } = config;

  const guessMapping = (headers) => guess(headers, fields);
  const findHeaderRow = (rows) => findHeader(rows, fields);

  /**
   * Turn the table under a chosen mapping into one row per campaign per
   * day, saying what was left out and why.
   */
  function buildRows(dataRows, mapping, { dayFirst = true } = {}) {
    const skipped = [];
    const byKey = new Map();
    const totals = { impressions: 0, clicks: 0, spend_cents: 0, conversions: 0, revenue_cents: 0 };

    if (mapping.date === -1) {
      return { rows: [], skipped, totals, campaigns: [], from: null, to: null, needsDate: true };
    }

    dataRows.forEach((cells, index) => {
      const line = index + 1; // the data row, counted from the one under the headings
      if (!cells.some((c) => String(c).trim() !== "")) return;

      // Google closes a report with "Total: Account" style rows and TikTok
      // with "Total"; neither has a date, so neither is read as a day.
      const date = parseDate(cells[mapping.date], { dayFirst });
      if (!date) { skipped.push({ line, reason: "no valid date (a totals or summary row)" }); return; }

      const counts = {};
      for (const key of ["impressions", "clicks", "conversions"]) {
        const n = mapping[key] === -1 ? 0 : parseNumber(cells[mapping[key]]);
        // Some platforms report fractional conversions (shared credit); a
        // day's figure is stored as a whole number, like every other count.
        if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping[key]]}" is not a valid count` }); return; }
        counts[key] = Math.round(n);
      }
      const money = {};
      for (const [key, out] of [["spend", "spend_cents"], ["revenue", "revenue_cents"]]) {
        const n = mapping[key] === -1 ? 0 : parseNumber(cells[mapping[key]]);
        if (!Number.isFinite(n) || n < 0) { skipped.push({ line, reason: `"${cells[mapping[key]]}" is not a valid amount` }); return; }
        money[out] = Math.round(n * 100);
      }

      const campaign = (mapping.campaign !== -1 ? String(cells[mapping.campaign]).trim() : "") || unnamed;
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

  /**
   * The currency a report is in, when it says so: a Currency column with
   * one value, or a code in the spend heading ("Cost (EUR)"). Otherwise
   * null, and the author chooses.
   */
  function currencyOf(headers, data, mapping) {
    if (mapping.currency !== undefined && mapping.currency !== -1) {
      const values = new Set(data.map((r) => String(r[mapping.currency] ?? "").trim().toUpperCase()).filter(Boolean));
      const [only] = values;
      return values.size === 1 && /^[A-Z]{3}$/.test(only) ? only : null;
    }
    const heading = mapping.spend === -1 ? "" : headers[mapping.spend];
    const m = /\(([A-Za-z]{3})\)\s*$/.exec(heading || "");
    return m ? m[1].toUpperCase() : null;
  }

  /** A first look at a file: header row, data, guessed columns, date format. */
  function readReport(text) {
    const { delimiter, rows } = parseCsv(text);
    const headerIndex = findHeaderRow(rows);
    if (headerIndex === -1) return { ok: false, delimiter, reason: "no_header" };
    const headers = rows[headerIndex].map((h) => String(h).trim());
    const data = rows.slice(headerIndex + 1);
    const mapping = guessMapping(headers);
    const dateFormat = mapping.date === -1
      ? { dayFirst: true, certain: true }
      : detectDayFirst(data.map((r) => r[mapping.date]));
    return { ok: true, delimiter, headers, data, mapping, dateFormat, preamble: headerIndex, currency: currencyOf(headers, data, mapping) };
  }

  return { config, fields, unnamed, guessMapping, findHeaderRow, buildRows, readReport };
}
