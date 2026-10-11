import type { Issue, ScanResult } from "./types";

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
}

/**
 * Feste Checkliste für manuelle Tests. Das sind Anleitungen – keine Befunde.
 * Sie werden immer angezeigt, unabhängig vom Scan-Ergebnis.
 */
export const MANUAL_TEST_CHECKLIST: ChecklistItem[] = [
  {
    id: "keyboard",
    title: "Komplette Tastaturbedienung",
    description:
      "Bedienen Sie Navigation, Suche, Produktauswahl, Warenkorb und Bezahlvorgang nur mit Tab, Umschalt+Tab, Enter, Leertaste und Pfeiltasten. Prüfen Sie, dass alles erreichbar ist, der Fokus immer sichtbar bleibt und keine Tastaturfalle entsteht.",
  },
  {
    id: "screenreader",
    title: "Screenreader-Test",
    description:
      "Testen Sie die wichtigsten Abläufe mit NVDA (Windows, Firefox/Chrome) und VoiceOver (macOS/iOS). Achten Sie auf verständliche Namen, Überschriften-Navigation und Statusmeldungen (z. B. „Artikel hinzugefügt“).",
  },
  {
    id: "zoom",
    title: "Zoom und Reflow",
    description: "Vergrößern Sie die Seite auf 200 % und 400 % (bzw. Breite 320 px). Es darf kein Inhalt verloren gehen und kein horizontales Scrollen bei Fließtext entstehen.",
  },
  {
    id: "forms",
    title: "Formulare und Fehlermeldungen",
    description: "Lösen Sie absichtlich Fehler aus. Fehler müssen im Text benannt, dem Feld zugeordnet und für Hilfstechnik angekündigt werden.",
  },
  {
    id: "focus",
    title: "Fokusführung bei Overlays",
    description: "Prüfen Sie Menüs, Cookie-Banner, Dialoge und Warenkorb-Flyouts: Der Fokus muss hineinwandern, darf nicht entweichen und muss beim Schließen sinnvoll zurückkehren.",
  },
  {
    id: "motion",
    title: "Bewegung und Medien",
    description: "Karusselle, Videos und Animationen müssen pausierbar sein; Videos benötigen Untertitel, ggf. Audiodeskription.",
  },
  {
    id: "mobile",
    title: "Mobilgeräte und Touch",
    description: "Testen Sie auf einem echten Smartphone mit Screenreader (TalkBack/VoiceOver) und ausreichend großen Tippflächen.",
  },
];

/** Kriterien, die sich grundsätzlich nicht (vollständig) automatisch prüfen lassen. */
export const NOT_AUTOMATABLE: ChecklistItem[] = [
  { id: "alt-quality", title: "Qualität von Alternativtexten", description: "Ein Tool erkennt fehlende Alternativtexte, aber nicht, ob der Text das Bild sinnvoll beschreibt." },
  { id: "link-purpose", title: "Verständlichkeit von Linktexten und Überschriften", description: "Ob Beschriftungen aussagekräftig und im Kontext verständlich sind, beurteilen nur Menschen." },
  { id: "focus-order", title: "Logische Fokus- und Lesereihenfolge", description: "Ob die Reihenfolge zum Inhalt passt, lässt sich nur im Bedienablauf beurteilen." },
  { id: "captions", title: "Untertitel, Audiodeskription und Transkripte", description: "Vorhandensein und Qualität von Alternativen für Audio und Video sind nicht automatisiert bewertbar." },
  { id: "plain-language", title: "Verständliche Sprache und Gestaltung", description: "Einfache Sprache, klare Anweisungen und konsistente Bedienung erfordern redaktionelle Prüfung." },
  { id: "error-help", title: "Hilfreiche Fehlermeldungen", description: "Ob Fehlerhinweise verständlich sind und Korrekturvorschläge enthalten, bleibt manuell zu beurteilen." },
  { id: "timeouts", title: "Zeitbegrenzungen und Sitzungsabläufe", description: "Zeitlimits im Bestellprozess und deren Verlängerung lassen sich nicht aus einem Seitenaufruf erkennen." },
  { id: "dynamic", title: "Dynamische Zustände und Abläufe", description: "Der Scan prüft einen Seitenzustand. Mehrstufige Abläufe (Warenkorb, Checkout, Kundenkonto) werden nicht durchlaufen." },
  { id: "documents", title: "PDF-Dokumente, Apps und E-Mails", description: "Verlinkte Dokumente, mobile Apps und Bestell-E-Mails werden nicht geprüft." },
  { id: "other-pages", title: "Weitere Seiten und Vorlagen", description: "Es wird nur die eingegebene Seite geprüft. Weitere Seitentypen können abweichende Barrieren enthalten." },
];

export interface RemediationPlan {
  immediate: Issue[];
  next: Issue[];
  manualIssues: Issue[];
  manualChecklist: ChecklistItem[];
  notAutomatable: ChecklistItem[];
}

const isImmediate = (i: Issue) => (i.severity === "critical" || i.severity === "high") && !i.bestPractice;

export function buildPlan(scan: ScanResult): RemediationPlan {
  const violations = scan.issues.filter((i) => i.kind === "violation");
  return {
    // Empfehlungen (Best Practice) landen nie unter „Sofort beheben“.
    immediate: violations.filter(isImmediate),
    next: violations.filter((i) => !isImmediate(i)),
    manualIssues: scan.issues.filter((i) => i.kind === "needs-review"),
    manualChecklist: MANUAL_TEST_CHECKLIST,
    notAutomatable: NOT_AUTOMATABLE,
  };
}
