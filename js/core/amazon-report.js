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

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RATE_WORDS = /\b(rate|percent|percentage|ratio|per|cost|acos|roas|cpc)\b/;

// --- CSV ---------------------------------------------------------------

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  const score = { ",": 0, ";": 0, "\t": 0 };
  for (const line of lines) {
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch in score) score[ch] += 1;
    }
  }
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
}

/** Parse delimited text into rows of strings. Handles quotes and CRLF. */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(src);
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return { delimiter, rows };
}

// --- Columns -----------------------------------------------------------

/**
 * For each field, the index of the header that most likely holds it, or
 * -1. An exact synonym beats a "total …" variant, and anything that
 * looks like a rate or a cost is never a count.
 */
export function guessMapping(headers) {
  const normalised = headers.map(norm);
  const mapping = {};
  for (const field of FIELDS) {
    let best = -1, bestScore = Infinity;
    normalised.forEach((h, index) => {
      if (!h) return;
      if (field.metric && RATE_WORDS.test(h)) return;
      const rank = field.synonyms.map(norm).indexOf(h);
      if (rank === -1) return;
      if (rank < bestScore) { best = index; bestScore = rank; }
    });
    mapping[field.key] = best;
  }
  return mapping;
}

/**
 * Find the header row. Reports often start with a title and a date-range
 * line, so look for the first row that reads like column names.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const mapping = guessMapping(rows[i]);
    const hits = Object.values(mapping).filter((v) => v !== -1).length;
    if (hits >= 2) return i;
  }
  return -1;
}

// --- Numbers and dates -------------------------------------------------

/**
 * A number from either "1,234.56" or "1.234,56", with or without a
 * currency sign. Returns NaN for anything that is not a number; blanks
 * and dashes are zero, which is how these reports write "none".
 */
export function parseNumber(value) {
  let s = String(value ?? "").trim();
  if (s === "" || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return 0;
  if (/[()]/.test(s) || /^-/.test(s)) return NaN; // negatives are not valid here
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return NaN;

  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  // With both marks present the later one is the decimal point. With one
  // kind, several of them (1,234,567) or exactly three digits after a
  // single one (1.234) mean thousands: money has two decimals and counts
  // have none, so three digits after a mark is a grouping, not a fraction.
  let decimal = null;
  if (lastDot !== -1 && lastComma !== -1) decimal = lastDot > lastComma ? "." : ",";
  else {
    const mark = lastDot !== -1 ? "." : lastComma !== -1 ? "," : null;
    if (mark) {
      const parts = s.split(mark);
      const grouping = parts.length > 2 || (/^[1-9]\d{0,2}$/.test(parts[0]) && parts[1].length === 3);
      decimal = grouping ? null : mark;
    }
  }
  const cleaned = decimal
    ? s.replace(decimal === "." ? /,/g : /\./g, "").replace(decimal, ".")
    : s.replace(/[.,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31 February and friends, which Date would quietly roll over.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * A date as ISO YYYY-MM-DD, or null. "03/04/2026" is ambiguous, so
 * `dayFirst` decides it; ISO and month-name dates are never ambiguous.
 */
export function parseDate(value, { dayFirst = true } = {}) {
  const s = String(value ?? "").trim();
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }

  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);

  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);

  return null;
}

/**
 * Day-first or month-first? Look for a date that can only be one:
 * a first part above 12 means day first, a second part above 12 means
 * month first. If every date is ambiguous, say so rather than guess.
 */
export function detectDayFirst(values) {
  let dayFirst = 0, monthFirst = 0, slashed = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(String(v ?? "").trim());
    if (!m) continue;
    slashed++;
    if (+m[1] > 12) dayFirst++;
    else if (+m[2] > 12) monthFirst++;
  }
  // ISO dates and month names cannot be read two ways; only the
  // numeric d/m/y kind raises the question.
  if (!slashed) return { dayFirst: true, certain: true };
  if (dayFirst && !monthFirst) return { dayFirst: true, certain: true };
  if (monthFirst && !dayFirst) return { dayFirst: false, certain: true };
  if (dayFirst && monthFirst) return { dayFirst: true, certain: false, conflict: true };
  return { dayFirst: true, certain: false };
}

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
