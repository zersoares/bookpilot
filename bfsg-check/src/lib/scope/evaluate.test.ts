import { describe, expect, it } from "vitest";
import { evaluateScope, type ScopeAnswers } from "./evaluate";
import { RULES_VERSION, SCOPE_DISCLAIMER, SCOPE_LABELS } from "./rules";

const base: ScopeAnswers = {
  consumers: "yes",
  serviceType: "shop",
  microEnterprise: "no",
  germany: "yes",
  publicActive: "yes",
};
const run = (over: Partial<ScopeAnswers> = {}) => evaluateScope({ ...base, ...over });

describe("evaluateScope – Ergebnisbezeichnungen", () => {
  it("verwendet ausschließlich die vier erlaubten Bezeichnungen", () => {
    expect(Object.values(SCOPE_LABELS)).toEqual([
      "Wahrscheinlich betroffen",
      "Möglicherweise betroffen – Prüfung empfohlen",
      "Möglicherweise ausgenommen",
      "Nicht ausreichend beurteilbar",
    ]);
  });
  it("liefert immer Haftungshinweis, Regelversion und Begründung", () => {
    for (const over of [{}, { germany: "no" as const }, { consumers: "unsure" as const, germany: "unsure" as const }]) {
      const r = run(over);
      expect(r.disclaimer).toBe(SCOPE_DISCLAIMER);
      expect(r.disclaimer).toContain("keine Rechtsberatung");
      expect(r.rulesVersion).toBe(RULES_VERSION);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.factors).toHaveLength(5);
      expect(Object.values(SCOPE_LABELS)).toContain(r.label);
    }
  });
});

describe("evaluateScope – wahrscheinlich betroffen", () => {
  it.each(["shop", "booking", "banking", "transport", "ebook"] as const)("B2C in Deutschland, kein Kleinstunternehmen, %s", (serviceType) => {
    const r = run({ serviceType });
    expect(r.outcome).toBe("likely");
    expect(r.label).toBe("Wahrscheinlich betroffen");
  });
  it("benennt die Angebotsart in der Begründung", () => {
    expect(run({ serviceType: "booking" }).reasons[0]).toContain("Buchungs- oder Reservierungsdienst");
  });
});

describe("evaluateScope – möglicherweise betroffen", () => {
  it("bei anderem digitalem Angebot", () => {
    expect(run({ serviceType: "other" }).outcome).toBe("possible");
  });
  it("bei Unsicherheit über das Kleinstunternehmen", () => {
    const r = run({ microEnterprise: "unsure" });
    expect(r.outcome).toBe("possible");
    expect(r.reasons.join(" ")).toContain("Kleinstunternehmen");
  });
  it("bei genau einer Unsicherheit (Verbraucher / Deutschland / Angebotsart)", () => {
    expect(run({ consumers: "unsure" }).outcome).toBe("possible");
    expect(run({ germany: "unsure" }).outcome).toBe("possible");
    expect(run({ serviceType: "unsure" }).outcome).toBe("possible");
    expect(run({ publicActive: "unsure" }).outcome).toBe("possible");
  });
  it("bei Kleinstunternehmen mit E-Book-Angebot (Einordnung Produkt/Dienstleistung offen)", () => {
    expect(run({ microEnterprise: "yes", serviceType: "ebook" }).outcome).toBe("possible");
  });
});

describe("evaluateScope – möglicherweise ausgenommen", () => {
  it("bei Kleinstunternehmen, das Dienstleistungen erbringt", () => {
    const r = run({ microEnterprise: "yes" });
    expect(r.outcome).toBe("exempt");
    expect(r.label).toBe("Möglicherweise ausgenommen");
    expect(r.reasons.join(" ")).toMatch(/10 Personen/);
  });
  it("wenn das Angebot nicht für Deutschland gedacht ist", () => {
    expect(run({ germany: "no" }).outcome).toBe("exempt");
  });
  it("wenn es kein Verbraucherangebot (B2B) ist", () => {
    expect(run({ consumers: "no" }).outcome).toBe("exempt");
  });
  it("formuliert nie endgültig („ausgenommen“ nur mit „möglicherweise“)", () => {
    for (const over of [{ microEnterprise: "yes" as const }, { germany: "no" as const }, { consumers: "no" as const }]) {
      const r = run(over);
      expect(r.label).toMatch(/^Möglicherweise/);
      expect([...r.reasons, ...r.nextSteps].join(" ")).not.toMatch(/sind (Sie )?(von|vom) .*befreit\b/);
    }
  });
});

describe("evaluateScope – nicht ausreichend beurteilbar", () => {
  it("bei nicht öffentlicher/inaktiver Website", () => {
    expect(run({ publicActive: "no" }).outcome).toBe("undetermined");
  });
  it("bei mehreren Unsicherheiten", () => {
    expect(run({ consumers: "unsure", germany: "unsure" }).outcome).toBe("undetermined");
    expect(run({ serviceType: "unsure", consumers: "unsure" }).outcome).toBe("undetermined");
  });
  it("alles unsicher", () => {
    expect(evaluateScope({ consumers: "unsure", serviceType: "unsure", microEnterprise: "unsure", germany: "unsure", publicActive: "unsure" }).outcome).toBe("undetermined");
  });
});

describe("evaluateScope – Vorrangregeln", () => {
  it("inaktive Website schlägt Ausnahmen", () => {
    expect(run({ publicActive: "no", germany: "no" }).outcome).toBe("undetermined");
  });
  it("Kein Deutschland-Bezug schlägt Betroffenheit", () => {
    expect(run({ germany: "no", serviceType: "shop" }).outcome).toBe("exempt");
  });
  it("Kleinstunternehmen mit Unsicherheit bei anderen Fragen bleibt „möglicherweise ausgenommen“", () => {
    expect(run({ microEnterprise: "yes", germany: "unsure" }).outcome).toBe("exempt");
  });
  it("ist deterministisch und verändert die Eingabe nicht", () => {
    const input = { ...base };
    expect(evaluateScope(input)).toEqual(evaluateScope(input));
    expect(input).toEqual(base);
  });
});
