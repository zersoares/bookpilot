import { areaLabel } from "./area";
import { genericContent, RULE_CONTENT } from "./rule-content";
import { SEVERITIES, type Issue, type IssueKind, type IssueNode, type ScanCounts, type ScanResult, type Severity } from "./types";
import { wcagFromTags } from "./wcag";

/** Minimaler Ausschnitt der axe-core-Ergebnisstruktur, den wir verwenden. */
export interface RawAxeNode {
  target: Array<string | string[]>;
  html?: string;
  failureSummary?: string;
  impact?: string | null;
}
export interface RawAxeRule {
  id: string;
  impact?: string | null;
  tags: string[];
  description?: string;
  help?: string;
  helpUrl?: string;
  nodes: RawAxeNode[];
}
export interface RawAxeResults {
  violations: RawAxeRule[];
  incomplete: RawAxeRule[];
  passes: RawAxeRule[];
  inapplicable: RawAxeRule[];
}

export interface NormalizeMeta {
  url: string;
  finalUrl: string;
  scannedAt: string;
  axeVersion: string;
  ruleset: string;
  viewport: { width: number; height: number };
  pageTitle: string;
  pageLang: string;
  isDemo: boolean;
  /** Bereichsschlüssel je Selektor (aus dem Browser), optional. */
  areaBySelector?: Map<string, string>;
}

export const MAX_NODES_PER_ISSUE = 25;
const MAX_HTML_LENGTH = 300;
const MAX_DETAILS_LENGTH = 500;

const IMPACT_TO_SEVERITY: Record<string, Severity> = {
  critical: "critical",
  serious: "high",
  moderate: "medium",
  minor: "low",
};

export function severityFromImpact(impact: string | null | undefined): Severity {
  return (impact && IMPACT_TO_SEVERITY[impact]) || "medium";
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function selectorOf(target: Array<string | string[]>): string {
  // Shadow-DOM-Pfade sind verschachtelte Arrays; Frames sind aufeinanderfolgende Einträge.
  return target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" › ");
}

function toIssue(rule: RawAxeRule, kind: IssueKind, areaBySelector?: Map<string, string>): Issue {
  const curated = RULE_CONTENT[rule.id];
  const content = curated ?? genericContent({ ruleId: rule.id, help: rule.help ?? rule.id, description: rule.description ?? "", tags: rule.tags });

  // Impact steht je Knoten (bei „incomplete“ oft null); wir nehmen die höchste vorhandene.
  const impacts = [rule.impact, ...rule.nodes.map((n) => n.impact)].filter(Boolean) as string[];
  const order = ["minor", "moderate", "serious", "critical"];
  const top = impacts.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];

  const nodes: IssueNode[] = rule.nodes.slice(0, MAX_NODES_PER_ISSUE).map((n) => {
    const selector = selectorOf(n.target);
    const area = areaLabel(areaBySelector?.get(selector));
    return {
      selector,
      html: truncate(n.html ?? "", MAX_HTML_LENGTH),
      area,
      details: n.failureSummary ? truncate(n.failureSummary, MAX_DETAILS_LENGTH) : undefined,
    };
  });
  const areas = [...new Set(nodes.map((n) => n.area))];

  return {
    id: `${kind}:${rule.id}`,
    ruleId: rule.id,
    kind,
    severity: severityFromImpact(top),
    title: content.title,
    explanation: content.explanation,
    affected: [...content.affected],
    wcag: wcagFromTags(rule.tags),
    bestPractice: rule.tags.includes("best-practice"),
    remediation: content.remediation,
    areas,
    nodes,
    nodeCount: rule.nodes.length,
    originalHelp: rule.help ?? rule.id,
    helpUrl: rule.helpUrl,
    genericText: !curated,
  };
}

const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      Number(a.bestPractice) - Number(b.bestPractice) ||
      b.nodeCount - a.nodeCount ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function normalizeAxeResults(raw: RawAxeResults, meta: NormalizeMeta): ScanResult {
  const violations = raw.violations.filter((r) => r.nodes.length > 0).map((r) => toIssue(r, "violation", meta.areaBySelector));
  const review = raw.incomplete.filter((r) => r.nodes.length > 0).map((r) => toIssue(r, "needs-review", meta.areaBySelector));

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const v of violations) bySeverity[v.severity] += 1;

  const counts: ScanCounts = {
    violationRules: violations.length,
    violationNodes: violations.reduce((n, v) => n + v.nodeCount, 0),
    needsReviewRules: review.length,
    passedRules: raw.passes.length,
    inapplicableRules: raw.inapplicable.length,
    bySeverity,
  };

  return {
    url: meta.url,
    finalUrl: meta.finalUrl,
    scannedAt: meta.scannedAt,
    engine: { name: "axe-core", version: meta.axeVersion },
    ruleset: meta.ruleset,
    viewport: meta.viewport,
    pageTitle: meta.pageTitle,
    pageLang: meta.pageLang,
    isDemo: meta.isDemo,
    counts,
    issues: sortIssues([...violations, ...review]),
  };
}
