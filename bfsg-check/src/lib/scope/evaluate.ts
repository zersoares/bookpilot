import {
  REVIEWED_ON,
  RULES_VERSION,
  SCOPE_BASIS,
  SCOPE_DISCLAIMER,
  SCOPE_LABELS,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPE_PHRASES,
  type ScopeOutcome,
  type ServiceType,
  type Tri,
} from "./rules";

export interface ScopeAnswers {
  /** Verkauf/Angebot an Verbraucher (B2C)? */
  consumers: Tri;
  serviceType: ServiceType;
  /** Dienstleister mit < 10 Beschäftigten und ≤ 2 Mio. € Umsatz/Bilanzsumme? */
  microEnterprise: Tri;
  /** Angebot richtet sich an Kunden in Deutschland? */
  germany: Tri;
  /** Website öffentlich erreichbar und aktiv? */
  publicActive: Tri;
}

export interface ScopeFactor {
  question: string;
  answer: string;
}

export interface ScopeResult {
  outcome: ScopeOutcome;
  label: string;
  /** Erklärung in einfacher Sprache, ein Absatz je Eintrag. */
  reasons: string[];
  /** Hinweise, was als Nächstes sinnvoll ist. */
  nextSteps: string[];
  factors: ScopeFactor[];
  rulesVersion: string;
  rulesReviewedOn: string;
  disclaimer: string;
}

export const EMPTY_ANSWERS: ScopeAnswers = {
  consumers: "unsure",
  serviceType: "unsure",
  microEnterprise: "unsure",
  germany: "unsure",
  publicActive: "unsure",
};

const TRI_LABEL: Record<Tri, string> = { yes: "Ja", no: "Nein", unsure: "Unsicher" };

function factorsFor(a: ScopeAnswers): ScopeFactor[] {
  return [
    { question: "Verkauf oder Angebot an Verbraucher", answer: TRI_LABEL[a.consumers] },
    { question: "Art des Angebots", answer: SERVICE_TYPE_LABELS[a.serviceType] },
    { question: "Kleinstunternehmen (< 10 Beschäftigte, ≤ 2 Mio. € Umsatz)", answer: TRI_LABEL[a.microEnterprise] },
    { question: "Angebot für Kundschaft in Deutschland", answer: TRI_LABEL[a.germany] },
    { question: "Website öffentlich erreichbar und aktiv", answer: TRI_LABEL[a.publicActive] },
  ];
}

function build(outcome: ScopeOutcome, a: ScopeAnswers, reasons: string[], nextSteps: string[]): ScopeResult {
  return {
    outcome,
    label: SCOPE_LABELS[outcome],
    reasons,
    nextSteps,
    factors: factorsFor(a),
    rulesVersion: RULES_VERSION,
    rulesReviewedOn: REVIEWED_ON,
    disclaimer: SCOPE_DISCLAIMER,
  };
}

/**
 * Orientierende Einschätzung. Reihenfolge der Prüfung ist bewusst festgelegt:
 *  1. Nicht öffentlich/aktiv  → nicht beurteilbar (Scan nicht sinnvoll)
 *  2. Kein Angebot in DE      → möglicherweise ausgenommen
 *  3. Kein Verbraucherangebot → möglicherweise ausgenommen
 *  4. Kleinstunternehmen      → möglicherweise ausgenommen (E-Books: Prüfung empfohlen)
 *  5. Zu viele Unsicherheiten → nicht ausreichend beurteilbar
 *  6. Eine Unsicherheit / "anderes Angebot" → möglicherweise betroffen
 *  7. Sonst                   → wahrscheinlich betroffen
 * Das Ergebnis ist nie ein Rechtsurteil und nie "ausgenommen" ohne "möglicherweise".
 */
export function evaluateScope(a: ScopeAnswers): ScopeResult {
  const unsureCount = (["consumers", "germany", "publicActive"] as const).filter((k) => a[k] === "unsure").length +
    (a.serviceType === "unsure" ? 1 : 0);

  if (a.publicActive === "no") {
    return build(
      "undetermined",
      a,
      [
        "Sie haben angegeben, dass die Website nicht öffentlich erreichbar oder derzeit nicht aktiv ist. Für ein Angebot, das (noch) nicht am Markt bereitgestellt wird, lässt sich die Anwendbarkeit des BFSG nicht sinnvoll einschätzen.",
        "Außerdem kann der automatische Scan nur öffentlich erreichbare Seiten prüfen.",
      ],
      [
        "Prüfen Sie die Einschätzung erneut, sobald das Angebot bereitgestellt wird.",
        "Barrierefreiheit lässt sich am günstigsten schon in Planung und Entwicklung berücksichtigen.",
      ],
    );
  }

  if (a.germany === "no") {
    return build(
      "exempt",
      a,
      [
        "Das BFSG gilt für Angebote, die auf dem deutschen Markt bereitgestellt werden. Richtet sich Ihr Angebot nicht an Kundschaft in Deutschland, ist das BFSG möglicherweise nicht anwendbar.",
        "Für Angebote in anderen EU-Staaten können vergleichbare nationale Regeln gelten, die die gleiche europäische Richtlinie umsetzen.",
      ],
      [
        "Prüfen Sie, ob nationale Barrierefreiheitsregeln in den Zielmärkten Ihres Angebots gelten.",
        "Lassen Sie die Ausnahme im Zweifel fachkundig bestätigen, bevor Sie sich darauf verlassen.",
      ],
    );
  }

  if (a.consumers === "no") {
    return build(
      "exempt",
      a,
      [
        "Das BFSG schützt Verbraucherinnen und Verbraucher. Richtet sich Ihr Angebot ausschließlich an Geschäftskunden (B2B), ist es möglicherweise nicht erfasst.",
        "Sobald auch Privatpersonen Verträge online abschließen können – etwa über ein Kundenkonto oder eine Bestellfunktion –, kann sich diese Einschätzung ändern.",
      ],
      [
        "Prüfen Sie, ob Privatpersonen Ihr Angebot tatsächlich nutzen oder nutzen können.",
        "Barrierefreie Websites sind unabhängig vom BFSG auch für Geschäftskunden und für die Auffindbarkeit von Vorteil.",
      ],
    );
  }

  if (a.microEnterprise === "yes") {
    if (a.serviceType === "ebook") {
      return build(
        "possible",
        a,
        [
          `${SCOPE_BASIS.microEnterprise}`,
          "Bei E-Books und zugehöriger Software ist die Einordnung als Produkt oder Dienstleistung im Einzelfall zu prüfen. Die Ausnahme für Kleinstunternehmen betrifft nur Dienstleistungen.",
        ],
        [
          "Lassen Sie klären, ob Ihr Angebot als Produkt oder als Dienstleistung gilt.",
          "Dokumentieren Sie Mitarbeiterzahl sowie Umsatz bzw. Bilanzsumme nachvollziehbar.",
        ],
      );
    }
    return build(
      "exempt",
      a,
      [
        SCOPE_BASIS.microEnterprise,
        "Nach Ihren Angaben erbringen Sie die Dienstleistung als Kleinstunternehmen. Dann sind Sie möglicherweise von den Anforderungen ausgenommen.",
        "Die Ausnahme hängt von den genauen Zahlen, möglichen verbundenen Unternehmen und der Art Ihres Angebots ab. Sie gilt nicht für Hersteller von Produkten.",
      ],
      [
        "Halten Sie die Grundlage der Ausnahme schriftlich fest (Beschäftigte, Umsatz/Bilanzsumme, Konzernverbund).",
        "Auch ohne Pflicht lohnt sich Barrierefreiheit: Sie erreicht mehr Kundschaft und verbessert die Nutzbarkeit für alle.",
      ],
    );
  }

  if (unsureCount >= 2) {
    return build(
      "undetermined",
      a,
      [
        "Bei mehreren Fragen waren Sie unsicher. Damit lässt sich nicht ausreichend beurteilen, ob Ihr Angebot unter das BFSG fällt.",
        `Entscheidend sind vor allem: Richtet sich das Angebot an Verbraucher? Welche Art von Angebot ist es? Wird es in Deutschland angeboten? Außerdem zählt, ob Ihr Unternehmen ein Kleinstunternehmen ist (Angabe: ${TRI_LABEL[a.microEnterprise]}).`,
      ],
      [
        "Klären Sie die offenen Punkte intern und wiederholen Sie die Einschätzung.",
        "Holen Sie bei Unklarheit fachkundigen Rat ein, z. B. bei einer auf Digitalrecht spezialisierten Kanzlei oder Ihrem Branchenverband.",
      ],
    );
  }

  const microUnsure = a.microEnterprise === "unsure";

  if (unsureCount === 1 || a.serviceType === "other" || microUnsure) {
    const reasons: string[] = [];
    if (a.serviceType === "other") {
      reasons.push(
        "Ihr Angebot gehört nicht eindeutig zu den typischen Kategorien (Online-Handel, Buchung, Bank-/Zahlungsdienst, Verkehr). Entscheidend ist, ob Verbraucher über Ihre Website oder App Verträge abschließen können.",
      );
    }
    if (microUnsure) {
      reasons.push(
        "Sie sind unsicher, ob Ihr Unternehmen als Kleinstunternehmen gilt. Trifft das zu, sind Sie als Dienstleister möglicherweise ausgenommen.",
      );
    }
    if (unsureCount === 1) {
      reasons.push("Eine Ihrer Antworten war „Unsicher“. Dadurch bleibt offen, ob das BFSG auf Ihr Angebot anwendbar ist.");
    }
    reasons.push("Aus Vorsicht gehen wir davon aus, dass eine genauere Prüfung sinnvoll ist.");
    return build("possible", a, reasons, [
      "Klären Sie die offenen Punkte und wiederholen Sie die Einschätzung.",
      "Beginnen Sie unabhängig davon mit der Behebung der technisch erkannten Barrieren.",
    ]);
  }

  // Hier gilt: Verbraucher=ja, Deutschland=ja, öffentlich=ja, Kleinstunternehmen=nein, Art bekannt.
  const extra =
    a.serviceType === "ebook"
      ? "Prüfen Sie zusätzlich die Barrierefreiheit der E-Book-Formate und der Lese-Software."
      : "Ergänzen Sie den automatischen Scan um manuelle Tests (Tastatur, Screenreader).";
  return build(
    "likely",
    a,
    [
      `Sie betreiben ${SERVICE_TYPE_PHRASES[a.serviceType]} für Verbraucher in Deutschland und sind nach Ihren Angaben kein Kleinstunternehmen.`,
      SCOPE_BASIS.note,
      "Solche Angebote gehören zu den Dienstleistungen, die das BFSG typischerweise erfasst.",
    ],
    [
      "Beheben Sie zuerst die als „Sofort beheben“ eingestuften Barrieren.",
      extra,
      "Bereiten Sie eine Barrierefreiheitserklärung vor und lassen Sie sie rechtlich prüfen.",
    ],
  );
}
