import { describe, expect, it } from "vitest";
import { normalizeAxeResults, severityFromImpact, type RawAxeResults } from "./normalize";
import { buildPlan } from "./plan";
import { wcagFromTags } from "./wcag";
import { buildDemoScan } from "../demo/demo-scan";

const meta = {
  url: "https://beispiel.de/",
  finalUrl: "https://beispiel.de/",
  scannedAt: "2025-10-11T10:00:00.000Z",
  axeVersion: "4.14.0",
  ruleset: "test",
  viewport: { width: 1280, height: 800 },
  pageTitle: "t",
  pageLang: "de",
  isDemo: false,
};
const empty: RawAxeResults = { violations: [], incomplete: [], passes: [], inapplicable: [] };

describe("severityFromImpact", () => {
  it("bildet axe-Wirkungsgrade auf deutsche Schweregrade ab", () => {
    expect(severityFromImpact("critical")).toBe("critical");
    expect(severityFromImpact("serious")).toBe("high");
    expect(severityFromImpact("moderate")).toBe("medium");
    expect(severityFromImpact("minor")).toBe("low");
    expect(severityFromImpact(null)).toBe("medium");
    expect(severityFromImpact("unbekannt")).toBe("medium");
  });
});

describe("wcagFromTags", () => {
  it("liest Erfolgskriterien und Stufe aus Tags", () => {
    expect(wcagFromTags(["cat.color", "wcag2aa", "wcag143"])).toEqual([{ criterion: "1.4.3", title: "Kontrast (Minimum)", level: "AA" }]);
    expect(wcagFromTags(["wcag2a", "wcag111", "wcag412"]).map((r) => r.criterion)).toEqual(["1.1.1", "4.1.2"]);
    expect(wcagFromTags(["wcag21aa", "wcag1410"])[0]).toMatchObject({ criterion: "1.4.10", level: "AA" });
  });
  it("ignoriert Konformitäts-Tags und liefert für Best Practices keine Referenz", () => {
    expect(wcagFromTags(["wcag2a", "wcag21aa", "best-practice"])).toEqual([]);
  });
});

describe("normalizeAxeResults", () => {
  it("erfindet nichts: leere Ergebnisse bleiben leer", () => {
    const r = normalizeAxeResults(empty, meta);
    expect(r.issues).toEqual([]);
    expect(r.counts.violationRules).toBe(0);
    expect(r.counts.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it("übernimmt Verstöße samt Elementen und deutschem Text", () => {
    const r = normalizeAxeResults(
      {
        ...empty,
        violations: [
          {
            id: "image-alt",
            impact: "critical",
            tags: ["wcag2a", "wcag111"],
            help: "Images must have alternative text",
            nodes: [{ target: ["img.logo"], html: '<img src="a.png">', impact: "critical" }],
          },
        ],
        passes: [{ id: "x", tags: [], nodes: [] }],
      },
      { ...meta, areaBySelector: new Map([["img.logo", "header"]]) },
    );
    const issue = r.issues[0]!;
    expect(issue).toMatchObject({ id: "violation:image-alt", severity: "critical", kind: "violation", nodeCount: 1, genericText: false });
    expect(issue.title).toBe("Bilder ohne Textalternative");
    expect(issue.nodes[0]).toMatchObject({ selector: "img.logo", area: "Kopfbereich" });
    expect(issue.wcag[0]?.criterion).toBe("1.1.1");
    expect(issue.affected).toContain("Screenreader-Nutzende");
    expect(issue.remediation.length).toBeGreaterThan(0);
    expect(r.counts).toMatchObject({ violationRules: 1, violationNodes: 1, passedRules: 1 });
  });

  it("kennzeichnet Regeln ohne kuratierten Text als generisch statt zu raten", () => {
    const r = normalizeAxeResults(
      { ...empty, violations: [{ id: "neue-regel-xyz", impact: "serious", tags: ["cat.forms", "wcag2a"], help: "Something is wrong", nodes: [{ target: ["#a"], html: "<a>" }] }] },
      meta,
    );
    expect(r.issues[0]).toMatchObject({ genericText: true, severity: "high" });
    expect(r.issues[0]?.explanation).toContain("Something is wrong");
  });

  it("trennt Verstöße und manuell zu prüfende Punkte; leere Regeln fallen weg", () => {
    const r = normalizeAxeResults(
      {
        ...empty,
        violations: [{ id: "label", impact: "critical", tags: [], nodes: [] }],
        incomplete: [{ id: "color-contrast", impact: null, tags: ["wcag143"], nodes: [{ target: ["h1"], html: "<h1>", impact: null }] }],
      },
      meta,
    );
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ kind: "needs-review", id: "needs-review:color-contrast" });
    expect(r.counts.needsReviewRules).toBe(1);
  });

  it("begrenzt gespeicherte Elemente, behält aber die Gesamtzahl und kürzt HTML", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => ({ target: [`#n${i}`], html: `<div>${"x".repeat(1000)}</div>`, impact: "minor" }));
    const r = normalizeAxeResults({ ...empty, violations: [{ id: "region", impact: "moderate", tags: ["best-practice"], nodes }] }, meta);
    expect(r.issues[0]?.nodes).toHaveLength(25);
    expect(r.issues[0]?.nodeCount).toBe(60);
    expect(r.issues[0]?.nodes[0]?.html.length).toBeLessThanOrEqual(300);
    expect(r.issues[0]?.bestPractice).toBe(true);
  });

  it("sortiert nach Schweregrad, dann Empfehlung, dann Elementanzahl", () => {
    const n = (c: number) => Array.from({ length: c }, (_, i) => ({ target: [`#a${i}`], html: "<a>" }));
    const r = normalizeAxeResults(
      {
        ...empty,
        violations: [
          { id: "heading-order", impact: "moderate", tags: [], nodes: n(1) },
          { id: "color-contrast", impact: "serious", tags: [], nodes: n(2) },
          { id: "label", impact: "critical", tags: [], nodes: n(1) },
          { id: "link-name", impact: "serious", tags: [], nodes: n(5) },
        ],
      },
      meta,
    );
    expect(r.issues.map((i) => i.ruleId)).toEqual(["label", "link-name", "color-contrast", "heading-order"]);
  });

  it("verbindet Frame-Pfade im Selektor", () => {
    const r = normalizeAxeResults({ ...empty, violations: [{ id: "label", impact: "critical", tags: [], nodes: [{ target: ["iframe#a", "input.x"], html: "<input>" }] }] }, meta);
    expect(r.issues[0]?.nodes[0]?.selector).toBe("iframe#a › input.x");
  });
});

describe("buildPlan", () => {
  const scan = buildDemoScan(new Date("2025-10-11T10:00:00Z"));
  const plan = buildPlan(scan);

  it("ordnet Kritisch/Hoch unter „Sofort beheben“", () => {
    expect(plan.immediate.length).toBeGreaterThan(0);
    expect(plan.immediate.every((i) => i.kind === "violation" && (i.severity === "critical" || i.severity === "high") && !i.bestPractice)).toBe(true);
  });
  it("ordnet Mittel/Niedrig und Empfehlungen unter „Als Nächstes planen“", () => {
    expect(plan.next.some((i) => i.ruleId === "heading-order")).toBe(true);
    expect(plan.next.every((i) => i.kind === "violation")).toBe(true);
  });
  it("sammelt axe-Zweifelsfälle unter „Manuell testen“", () => {
    expect(plan.manualIssues.every((i) => i.kind === "needs-review")).toBe(true);
    expect(plan.manualIssues.length).toBe(2);
  });
  it("liefert feste Listen für manuelle Tests und nicht automatisch Prüfbares", () => {
    expect(plan.manualChecklist.length).toBeGreaterThan(3);
    expect(plan.notAutomatable.length).toBeGreaterThan(3);
  });
  it("verliert keine Verstöße", () => {
    expect(plan.immediate.length + plan.next.length + plan.manualIssues.length).toBe(scan.issues.length);
  });
});

describe("Demo-Daten", () => {
  it("sind eindeutig als Demo markiert", () => {
    const demo = buildDemoScan();
    expect(demo.isDemo).toBe(true);
    expect(demo.engine.version).toBe("demo");
    expect(demo.url).toContain(".example");
  });
});
