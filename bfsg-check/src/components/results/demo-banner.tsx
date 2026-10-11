import { Alert } from "../ui/alert";

export function DemoBanner() {
  return (
    <Alert tone="warning" title="Demo-Daten" role="status" headingLevel={2}>
      Diese Befunde sind <strong>Beispieldaten</strong> aus dem Entwicklungsmodus und stammen nicht aus einem echten Scan. In der Produktion werden ausschließlich Ergebnisse des tatsächlichen Scans angezeigt.
    </Alert>
  );
}
