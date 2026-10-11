import { SCOPE_DISCLAIMER } from "@/lib/scope/rules";

export const GENERAL_DISCLAIMER =
  "BFSG Check ist keine Rechtsberatung und keine Zertifizierung. Der Bericht bestätigt weder die Konformität mit dem BFSG, dem European Accessibility Act oder den WCAG, noch ersetzt er eine manuelle Prüfung.";

export const SCAN_LIMITATION =
  "Automatisierte Tests können nur einen Teil der Barrieren erkennen. Ein Ergebnis ohne Befunde bedeutet nicht, dass eine Seite barrierefrei ist. Manuelle Tests mit Tastatur und Screenreader bleiben erforderlich.";

export function ScopeDisclaimer({ className = "" }: { className?: string }) {
  return <p className={`text-sm text-navy-600 ${className}`}>{SCOPE_DISCLAIMER}</p>;
}
