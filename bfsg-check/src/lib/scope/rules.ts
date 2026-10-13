/**
 * Deutschland-spezifische Scope-Regeln (BFSG / Europäischer Rechtsakt zur Barrierefreiheit).
 *
 * >>> HIER aktualisieren, wenn sich Rechtslage oder Auslegung ändern. <<<
 * Die Logik in evaluate.ts enthält keine Rechtstexte – nur Entscheidungsfluss.
 * Nach jeder inhaltlichen Änderung: RULES_VERSION erhöhen, REVIEWED_ON setzen,
 * `npm test` ausführen (scope/evaluate.test.ts) und die Methodik-Seite prüfen.
 */

export const RULES_VERSION = "2025-10-1";
export const REVIEWED_ON = "2025-10-11";
/** Empfohlener Zyklus für die Überprüfung dieser Regeln. */
export const REVIEW_CYCLE_MONTHS = 6;

export const SCOPE_DISCLAIMER =
  "Diese Einschätzung ist eine Orientierung und keine Rechtsberatung. Die konkrete Anwendbarkeit hängt von Ihrem Angebot und den Umständen Ihres Unternehmens ab.";

export type Tri = "yes" | "no" | "unsure";

export const SERVICE_TYPES = [
  "shop",
  "booking",
  "banking",
  "transport",
  "ebook",
  "other",
  "unsure",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  shop: "Online-Shop (Verkauf von Waren oder digitalen Produkten)",
  booking: "Buchungs- oder Reservierungsdienst",
  banking: "Bank- oder Zahlungsdienst für Verbraucher",
  transport: "Verkehrsbezogener Dienst (z. B. Ticketverkauf, Fahrplanauskunft)",
  ebook: "E-Book-Angebot oder zugehörige Software",
  other: "Anderes digitales Angebot",
  unsure: "Weiß ich nicht",
};

/** Satzbaustein für die Begründung ("Sie betreiben …"). */
export const SERVICE_TYPE_PHRASES: Record<ServiceType, string> = {
  shop: "einen Online-Shop",
  booking: "einen Buchungs- oder Reservierungsdienst",
  banking: "einen Bank- oder Zahlungsdienst",
  transport: "einen verkehrsbezogenen Dienst",
  ebook: "ein E-Book-Angebot",
  other: "ein digitales Angebot",
  unsure: "ein digitales Angebot",
};

export const SCOPE_OUTCOMES = ["likely", "possible", "exempt", "undetermined"] as const;
export type ScopeOutcome = (typeof SCOPE_OUTCOMES)[number];

/** Die einzigen erlaubten Ergebnis-Bezeichnungen. */
export const SCOPE_LABELS: Record<ScopeOutcome, string> = {
  likely: "Wahrscheinlich betroffen",
  possible: "Möglicherweise betroffen – Prüfung empfohlen",
  exempt: "Möglicherweise ausgenommen",
  undetermined: "Nicht ausreichend beurteilbar",
};

export const SCOPE_BASIS = {
  inForceSince: "28. Juni 2025",
  note:
    "Das Barrierefreiheitsstärkungsgesetz (BFSG) setzt die europäische Richtlinie (EU) 2019/882 (European Accessibility Act) um und gilt seit dem 28. Juni 2025 für bestimmte Produkte und Dienstleistungen, die an Verbraucher gerichtet sind.",
  microEnterprise:
    "Kleinstunternehmen, die Dienstleistungen erbringen, sind nach dem BFSG von den Anforderungen ausgenommen. Als Kleinstunternehmen gilt, wer weniger als 10 Personen beschäftigt und einen Jahresumsatz oder eine Jahresbilanzsumme von höchstens 2 Mio. € hat. Verbundene oder Partnerunternehmen können dabei mitzählen.",
} as const;
