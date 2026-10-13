import { describe, expect, it } from "vitest";
import { buildDemoScan } from "./demo/demo-scan";
import { buildStatementDraft, DRAFT_MARKER, PLACEHOLDERS, splitPlaceholders, statementToText } from "./statement";

describe("buildStatementDraft", () => {
  it("enthält ohne Eingaben alle Platzhalter und die Entwurfs-Markierung", () => {
    const draft = buildStatementDraft(undefined);
    const text = statementToText(draft);
    expect(draft.marker).toBe(DRAFT_MARKER);
    expect(text).toContain("Entwurf");
    for (const key of ["organisation", "address", "feedback", "assessmentDate", "limitations", "authority", "complaint"] as const) {
      expect(text).toContain(PLACEHOLDERS[key]);
    }
  });
  it("setzt Eingaben ein, behält aber das Bewertungsdatum als Platzhalter", () => {
    const text = statementToText(buildStatementDraft(buildDemoScan(), { organisation: "Muster GmbH", address: "Musterstr. 1, 10115 Berlin", feedback: "barriere@muster.example" }));
    expect(text).toContain("Muster GmbH");
    expect(text).toContain("barriere@muster.example");
    expect(text).toContain(PLACEHOLDERS.assessmentDate);
    expect(text).not.toContain(PLACEHOLDERS.organisation);
  });
  it("behauptet nie Konformität", () => {
    const text = statementToText(buildStatementDraft(buildDemoScan()));
    expect(text).not.toMatch(/vollständig (barrierefrei|konform)|erfüllt (alle|sämtliche)|zertifiziert|konform mit/i);
    expect(text).toContain("nicht abschließend festgestellt");
  });
  it("führt erkannte Einschränkungen aus dem Scan auf", () => {
    const draft = buildStatementDraft(buildDemoScan());
    const items = draft.sections.flatMap((s) => s.items ?? []);
    expect(items.some((i) => i.includes("Bilder ohne Textalternative"))).toBe(true);
  });
  it("relativiert eine saubere Prüfung", () => {
    const scan = { ...buildDemoScan(), issues: [], counts: { ...buildDemoScan().counts, violationRules: 0, needsReviewRules: 0 } };
    expect(statementToText(buildStatementDraft(scan))).toContain("kein Nachweis der Barrierefreiheit");
  });
});

describe("splitPlaceholders", () => {
  it("trennt Platzhalter von normalem Text", () => {
    expect(splitPlaceholders("Hallo [Name], willkommen")).toEqual([
      { text: "Hallo ", placeholder: false },
      { text: "[Name]", placeholder: true },
      { text: ", willkommen", placeholder: false },
    ]);
    expect(splitPlaceholders("ohne")).toEqual([{ text: "ohne", placeholder: false }]);
  });
});
