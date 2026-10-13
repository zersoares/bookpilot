import type { WcagRef } from "./types";

/** Deutsche Kurztitel der häufigsten WCAG-2.1-Erfolgskriterien. */
const TITLES: Record<string, string> = {
  "1.1.1": "Nicht-Text-Inhalt",
  "1.2.1": "Nur Audio und nur Video (aufgezeichnet)",
  "1.2.2": "Untertitel (aufgezeichnet)",
  "1.2.3": "Audiodeskription oder Medienalternative (aufgezeichnet)",
  "1.2.5": "Audiodeskription (aufgezeichnet)",
  "1.3.1": "Info und Beziehungen",
  "1.3.2": "Bedeutungsvolle Reihenfolge",
  "1.3.4": "Anzeigeausrichtung",
  "1.3.5": "Eingabezweck bestimmen",
  "1.4.1": "Benutzung von Farbe",
  "1.4.2": "Audiosteuerung",
  "1.4.3": "Kontrast (Minimum)",
  "1.4.4": "Textgröße ändern",
  "1.4.10": "Umbruch (Reflow)",
  "1.4.11": "Kontrast von Nicht-Text-Inhalten",
  "1.4.12": "Textabstand",
  "2.1.1": "Tastatur",
  "2.1.2": "Keine Tastaturfalle",
  "2.2.1": "Zeitbegrenzung einstellbar",
  "2.2.2": "Pausieren, beenden, ausblenden",
  "2.3.1": "Dreimaliges Blitzen oder unterhalb des Grenzwertes",
  "2.4.1": "Blöcke umgehen",
  "2.4.2": "Seite mit Titel",
  "2.4.3": "Fokus-Reihenfolge",
  "2.4.4": "Linkzweck (im Kontext)",
  "2.4.5": "Verschiedene Möglichkeiten",
  "2.4.6": "Überschriften und Beschriftungen",
  "2.4.7": "Fokus sichtbar",
  "2.5.3": "Beschriftung im Namen",
  "2.5.8": "Zielgröße (Minimum)",
  "3.1.1": "Sprache der Seite",
  "3.1.2": "Sprache von Teilen",
  "3.2.2": "Bei Eingabe",
  "3.3.2": "Beschriftungen oder Anweisungen",
  "4.1.1": "Syntaxanalyse",
  "4.1.2": "Name, Rolle, Wert",
};

/**
 * Liest WCAG-Erfolgskriterien aus axe-core-Tags ("wcag143" → "1.4.3").
 * Tags wie "wcag2aa" (Konformitätsstufe) oder "wcag21aa" (Version) werden ignoriert.
 */
export function wcagFromTags(tags: readonly string[]): WcagRef[] {
  const level: WcagRef["level"] = tags.some((t) => t === "wcag2aaa" || t === "wcag21aaa" || t === "wcag22aaa")
    ? "AAA"
    : tags.some((t) => t === "wcag2aa" || t === "wcag21aa" || t === "wcag22aa")
      ? "AA"
      : "A";
  const refs: WcagRef[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
    if (!m) continue;
    const criterion = `${m[1]}.${m[2]}.${m[3]}`;
    refs.push({ criterion, title: TITLES[criterion], level });
  }
  return refs;
}

export function formatWcag(ref: WcagRef): string {
  return `WCAG ${ref.criterion}${ref.title ? ` ${ref.title}` : ""} (Stufe ${ref.level})`;
}
