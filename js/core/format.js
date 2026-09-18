// Display formatting.
//
// The rule that shapes this file: an unknown value renders as "N/A",
// never as 0. metrics.js returns null for a rate whose denominator is
// zero, and every formatter here keeps that distinction visible all the
// way to the screen (spec §19, §44).

const NA = "N/A";

let locale = "en-GB";
export function setLocale(value) {
  if (value) locale = value;
}

export function money(cents, currency = "EUR", { decimals = 2 } = {}) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return NA;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(cents) / 100);
}

export function moneyShort(cents, currency = "EUR") {
  if (cents === null || cents === undefined) return NA;
  const value = Number(cents) / 100;
  return money(Math.round(value) * 100, currency, { decimals: value >= 1000 ? 0 : 2 });
}

export function number(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return NA;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value));
}

export function percent(value, { decimals = 2 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return NA;
  return `${number(value, { decimals })}%`;
}

export function multiple(value, { decimals = 2 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return NA;
  return `${number(value, { decimals })}×`;
}

export function date(value, { withTime = false } = {}) {
  if (!value) return NA;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NA;
  // A bare calendar date ("2026-09-01") is a day, not an instant. Read as
  // UTC midnight and shown in a western timezone it would print as the
  // day before, so format it in UTC.
  const calendarDay = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(calendarDay ? { timeZone: "UTC" } : {}),
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(parsed);
}

export function relativeTime(value) {
  if (!value) return NA;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return NA;
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(diffSeconds, "second");
}

const PLATFORM_NAMES = { meta: "Meta", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", google: "Google", youtube: "YouTube" };

/** A platform's proper name: title-casing alone turns "tiktok" into "Tiktok". */
export function platformName(value) {
  return PLATFORM_NAMES[String(value || "").toLowerCase()] || titleCase(value);
}

const PLATFORM_TOOLS = { tiktok: "TikTok Ads Manager", google: "Google Ads", meta: "Meta Ads Manager" };

/** Where an author manages a platform's campaigns. */
export function platformTool(value) {
  return PLATFORM_TOOLS[String(value || "").toLowerCase()] || `${platformName(value)} ads`;
}

export function titleCase(value) {
  if (!value) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(value, max = 120) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/** Status pill class for campaigns and creatives. */
export function statusTone(status) {
  switch (status) {
    case "active": return "success";
    case "scheduled": return "info";
    case "paused": return "warning";
    case "error": return "danger";
    case "completed": return "primary";
    default: return "";
  }
}

/**
 * Score band for a creative's predicted-quality score. Deliberately
 * conservative: nothing under 70 gets a green badge, because a green
 * badge reads as permission to spend.
 */
export function scoreTone(score) {
  if (score === null || score === undefined) return "";
  if (score >= 80) return "success";
  if (score >= 65) return "primary";
  if (score >= 50) return "warning";
  return "danger";
}
