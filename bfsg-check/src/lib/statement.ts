import type { ScanResult, StatementFields } from "./scan/types";

export const DRAFT_MARKER = "ENTWURF – Vor Veröffentlichung durch eine verantwortliche Person prüfen und ggf. rechtlich bewerten lassen.";

export const PLACEHOLDERS = {
  organisation: "[Name der Organisation]",
  address: "[Kontaktanschrift]",
  feedback: "[Feedback-Kanal, z. B. E-Mail-Adresse oder Kontaktformular]",
  assessmentDate: "[Datum der Bewertung]",
  method: "[Bewertungsmethode, z. B. Selbstbewertung oder externes Audit]",
  responseTime: "[Antwortzeit, z. B. innerhalb von 14 Tagen]",
  authority: "[Zuständige Marktüberwachungsbehörde samt Kontaktdaten – bitte prüfen und ergänzen]",
  complaint: "[Hinweise zu Beschwerde- und Schlichtungsmöglichkeiten – bitte rechtlich prüfen und ergänzen]",
  limitations: "[Weitere bekannte Einschränkungen ergänzen]",
} as const;

export interface StatementSection {
  heading: string;
  paragraphs: string[];
  /** Aufzählung, falls vorhanden */
  items?: string[];
}

export interface StatementDraft {
  title: string;
  marker: string;
  sections: StatementSection[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(d);
}

const filled = (value: string | undefined, placeholder: string) => (value && value.trim() ? value.trim() : placeholder);

/**
 * Erzeugt einen bewusst vorsichtigen Entwurf. Er behauptet nie Konformität,
 * sondern beschreibt den Stand und nennt Einschränkungen. Alles Unbekannte
 * bleibt als [Platzhalter] stehen.
 */
export function buildStatementDraft(scan: ScanResult | undefined, fields: Partial<StatementFields> = {}): StatementDraft {
  const org = filled(fields.organisation, PLACEHOLDERS.organisation);
  const address = filled(fields.address, PLACEHOLDERS.address);
  const feedback = filled(fields.feedback, PLACEHOLDERS.feedback);

  let host = "[Adresse des Angebots]";
  if (scan) {
    try {
      host = new URL(scan.finalUrl || scan.url).hostname;
    } catch {
      host = scan.url;
    }
  }

  const status: string[] = [
    `${org} bemüht sich, das Online-Angebot unter ${host} für möglichst viele Menschen zugänglich zu machen. Ob und in welchem Umfang das Angebot die Anforderungen an die Barrierefreiheit erfüllt, ist derzeit nicht abschließend festgestellt.`,
  ];
  const items: string[] = [];
  if (scan) {
    const { counts } = scan;
    status.push(
      `Am ${formatDate(scan.scannedAt)} wurde eine automatisierte technische Prüfung einer einzelnen Seite (${scan.finalUrl}) mit ${scan.engine.name} ${scan.engine.version} durchgeführt. ` +
        (counts.violationRules === 0
          ? "Dabei wurden keine automatisch erkennbaren Verstöße gemeldet. Das ist kein Nachweis der Barrierefreiheit, da automatisierte Tests nur einen Teil der Anforderungen abdecken."
          : `Dabei wurden ${counts.violationRules} automatisch erkennbare Auffälligkeiten festgestellt${counts.needsReviewRules ? `; weitere ${counts.needsReviewRules} Punkte müssen manuell geprüft werden` : ""}.`),
    );
    for (const issue of scan.issues.filter((i) => i.kind === "violation").slice(0, 8)) {
      const wcag = issue.wcag[0] ? ` (WCAG ${issue.wcag[0].criterion})` : "";
      items.push(`${issue.title}${wcag}`);
    }
  }

  return {
    title: "Erklärung zur Barrierefreiheit (Entwurf)",
    marker: DRAFT_MARKER,
    sections: [
      {
        heading: "1. Geltungsbereich und Stand",
        paragraphs: [...status, `Datum der Bewertung: ${PLACEHOLDERS.assessmentDate}.`],
      },
      {
        heading: "2. Bekannte Einschränkungen",
        paragraphs: [
          scan
            ? "Nach derzeitigem Kenntnisstand bestehen insbesondere folgende technische Einschränkungen, die wir beheben möchten:"
            : "Bekannte Einschränkungen: noch keine automatische Prüfung durchgeführt.",
          "Es wurde nicht das gesamte Angebot geprüft. Mehrstufige Abläufe wie Warenkorb, Bestellvorgang und Kundenkonto sowie verlinkte Dokumente sind nicht vollständig bewertet. Manuelle Tests mit Tastatur und Screenreader stehen aus bzw. sind hier zu ergänzen.",
          PLACEHOLDERS.limitations,
        ],
        items: items.length ? items : undefined,
      },
      {
        heading: "3. Erstellung dieser Erklärung",
        paragraphs: [
          `Diese Erklärung wurde am ${PLACEHOLDERS.assessmentDate} erstellt. Bewertungsmethode: ${PLACEHOLDERS.method}.`,
          "Ergänzend wurde eine automatisierte Prüfung nach den Regeln von axe-core durchgeführt (siehe Methodik des Berichts). Sie ersetzt keine manuelle Prüfung und keine Zertifizierung.",
        ],
      },
      {
        heading: "4. Feedback und Kontakt",
        paragraphs: [
          `Wenn Ihnen Barrieren auffallen oder Sie Inhalte in einer zugänglichen Form benötigen, kontaktieren Sie uns bitte: ${org}, ${address}. Erreichbar über: ${feedback}.`,
          `Wir bemühen uns, Ihre Anfrage ${PLACEHOLDERS.responseTime} zu beantworten.`,
        ],
      },
      {
        heading: "5. Beschwerde und Durchsetzung",
        paragraphs: [
          "Wenn Sie mit unserer Antwort nicht zufrieden sind, können Sie sich an die zuständige Stelle wenden.",
          PLACEHOLDERS.authority,
          PLACEHOLDERS.complaint,
        ],
      },
    ],
  };
}

/** Reintext-Fassung zum Kopieren. */
export function statementToText(draft: StatementDraft): string {
  const lines: string[] = [draft.title, draft.marker, ""];
  for (const s of draft.sections) {
    lines.push(s.heading, "");
    for (const p of s.paragraphs) lines.push(p, "");
    for (const it of s.items ?? []) lines.push(`- ${it}`);
    if (s.items?.length) lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

/** Zerlegt Text in Segmente, damit Platzhalter in der UI hervorgehoben werden können. */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  const out: Array<{ text: string; placeholder: boolean }> = [];
  const re = /\[[^\]]+\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}
