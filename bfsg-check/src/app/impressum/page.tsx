import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Impressum", robots: { index: false, follow: true } };

export default function ImpressumPage() {
  return (
    <PageShell eyebrow="Rechtliches" title="Impressum">
      <Alert tone="warning" title="Platzhalter" headingLevel={2}>
        Dieses Impressum ist eine Vorlage. Betreiber müssen die Angaben nach § 5 DDG vollständig ergänzen, bevor die Anwendung öffentlich bereitgestellt wird.
      </Alert>
      <h2>Anbieter</h2>
      <p>[Name des Unternehmens, Rechtsform]<br />[Straße und Hausnummer]<br />[PLZ und Ort]</p>
      <h2>Kontakt</h2>
      <p>E-Mail: [E-Mail-Adresse]<br />Telefon: [Telefonnummer]</p>
      <h2>Vertretungsberechtigte, Register, Umsatzsteuer-ID</h2>
      <p>[Vertretungsberechtigte Person]<br />[Handelsregister und Registernummer]<br />[Umsatzsteuer-Identifikationsnummer, falls vorhanden]</p>
    </PageShell>
  );
}
