import type { ScopeAnswers, ScopeResult } from "../scope/evaluate";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Kritisch",
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

export const ISSUE_STATUSES = ["open", "in_progress", "done", "manual"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
  manual: "Manuell prüfen",
};

/** violation = axe hat einen Verstoß festgestellt; needs-review = axe konnte es nicht eindeutig entscheiden. */
export type IssueKind = "violation" | "needs-review";

export interface WcagRef {
  /** z. B. "1.4.3" */
  criterion: string;
  /** deutscher Kurztitel, falls bekannt */
  title?: string;
  level: "A" | "AA" | "AAA";
}

export interface IssueNode {
  /** CSS-Selektor (bei Frames: Pfad mit " › " getrennt) */
  selector: string;
  /** Gekürzter HTML-Ausschnitt des Elements */
  html: string;
  /** Bereich der Seite, z. B. "Kopfbereich" */
  area: string;
  /** Technische Details von axe-core (englisch), gekürzt */
  details?: string;
}

export interface Issue {
  /** Stabil: `${kind}:${ruleId}` */
  id: string;
  ruleId: string;
  kind: IssueKind;
  severity: Severity;
  title: string;
  explanation: string;
  /** Betroffene Personengruppen */
  affected: string[];
  wcag: WcagRef[];
  /** true = Empfehlung (Best Practice), kein WCAG-Erfolgskriterium */
  bestPractice: boolean;
  remediation: string[];
  /** Zusammenfassung der betroffenen Seitenbereiche */
  areas: string[];
  nodes: IssueNode[];
  /** Gesamtzahl betroffener Elemente (kann größer sein als nodes.length) */
  nodeCount: number;
  /** Englische Original-Beschreibung von axe-core */
  originalHelp: string;
  helpUrl?: string;
  /** true, wenn für diese Regel kein kuratierter deutscher Text existiert */
  genericText: boolean;
}

export interface ScanCounts {
  violationRules: number;
  violationNodes: number;
  needsReviewRules: number;
  passedRules: number;
  inapplicableRules: number;
  bySeverity: Record<Severity, number>;
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  /** ISO-Zeitstempel */
  scannedAt: string;
  engine: { name: "axe-core"; version: string };
  ruleset: string;
  viewport: { width: number; height: number };
  pageTitle: string;
  pageLang: string;
  /** true = Beispieldaten (nur Entwicklung) */
  isDemo: boolean;
  counts: ScanCounts;
  issues: Issue[];
}

export type ScanErrorCode =
  | "INVALID_URL"
  | "BLOCKED_TARGET"
  | "RATE_LIMITED"
  | "BUSY"
  | "SCANNER_UNAVAILABLE"
  | "NAVIGATION_FAILED"
  | "HTTP_ERROR"
  | "NOT_HTML"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "BAD_REQUEST"
  | "INTERNAL";

export interface ScanErrorBody {
  code: ScanErrorCode;
  message: string;
  /** Nur bei RATE_LIMITED */
  retryAfterSeconds?: number;
}

export type ScanResponse = { ok: true; result: ScanResult } | { ok: false; error: ScanErrorBody };

/** Alles, was die Sitzung im Browser (sessionStorage) hält – nie auf dem Server. */
export interface StatementFields {
  organisation: string;
  address: string;
  feedback: string;
}

export interface CheckSession {
  version: 1;
  url: string;
  answers?: ScopeAnswers;
  scope?: ScopeResult;
  scan?: ScanResult;
  statuses: Record<string, IssueStatus>;
  statement: StatementFields;
}
