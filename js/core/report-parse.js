// Shared parsing for imported ad-platform reports (Amazon Attribution,
// TikTok Ads Manager, and whatever comes next).
//
// Exports from these tools vary — column names change between report
// types and marketplaces, files carry preamble lines and a totals row,
// numbers come in "1,234.56" and "1.234,56" forms, and dates in whichever
// order the account's locale prefers — so nothing here assumes one layout.
// It guesses, and the screen shows the guess for correction.
//
// Pure functions: no DOM, no network, and testable.

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RATE_WORDS = /\b(rate|percent|percentage|ratio|per|acos|roas|cpc|cpm|cpa|ctr|ecpc|ecpm)\b/;

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
export function guessMapping(headers, fields) {
  const normalised = headers.map(norm);
  const mapping = {};
  for (const field of fields) {
    const synonyms = field.synonyms.map(norm);
    let best = -1, bestScore = Infinity;
    normalised.forEach((h, index) => {
      if (!h) return;
      if (field.metric && RATE_WORDS.test(h)) return;
      // "Cost (EUR)" is "Cost": a trailing currency code names the unit,
      // not a different column.
      const raw = headers[index];
      const withoutCurrency = norm(String(raw).replace(/\s*[(\[]?\b[A-Z]{3}\b[)\]]?\s*$/, ""));
      // Pinterest writes "Spend in account currency": same column, longer name.
      const withoutUnit = h.replace(/ in account currency$/, "");
      const rank = Math.min(...[h, withoutCurrency, withoutUnit].map((x) => {
        const i = synonyms.indexOf(x);
        return i === -1 ? Infinity : i;
      }));
      if (rank === Infinity) return;
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
export function findHeaderRow(rows, fields) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const mapping = guessMapping(rows[i], fields);
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

