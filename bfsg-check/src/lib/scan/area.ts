/** Seitenbereiche, die der In-Page-Klassifizierer zurückgeben darf. */
export const AREA_KEYS = ["header", "nav", "main", "footer", "aside", "form", "dialog", "page", "unknown"] as const;
export type AreaKey = (typeof AREA_KEYS)[number];

export const AREA_LABELS: Record<AreaKey, string> = {
  header: "Kopfbereich",
  nav: "Navigation",
  main: "Hauptinhalt",
  footer: "Fußbereich",
  aside: "Seitenleiste / Zusatzinhalt",
  form: "Formular",
  dialog: "Dialog / Overlay",
  page: "Gesamte Seite",
  unknown: "Nicht eindeutig zuordenbar",
};

export function areaLabel(key: string | null | undefined): string {
  return AREA_LABELS[(AREA_KEYS as readonly string[]).includes(key ?? "") ? (key as AreaKey) : "unknown"];
}

/**
 * Läuft IM Browser (wird serialisiert an page.evaluate übergeben) – deshalb
 * komplett eigenständig, ohne Importe oder Verweise auf Modul-Variablen.
 */
export function browserAreaClassifier(selectors: Array<string | null>): string[] {
  return selectors.map((sel) => {
    if (!sel) return "unknown";
    let el: Element | null = null;
    try {
      el = document.querySelector(sel);
    } catch {
      return "unknown";
    }
    if (!el) return "unknown";
    if (el === document.documentElement || el === document.body) return "page";
    const closest = (q: string) => el!.closest(q);
    if (closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return "dialog";
    if (closest('header, [role="banner"]')) return "header";
    if (closest('nav, [role="navigation"]')) return "nav";
    if (closest('footer, [role="contentinfo"]')) return "footer";
    if (closest('aside, [role="complementary"]')) return "aside";
    if (closest('form, [role="form"], [role="search"]')) return "form";
    if (closest('main, [role="main"]')) return "main";
    return "unknown";
  });
}
