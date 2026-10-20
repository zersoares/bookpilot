import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Impressum", robots: { index: false, follow: true } };

export default function ImpressumPage() {
  return (
    <PageShell eyebrow="Rechtliches" title="Impressum">
      <Alert tone="warning" title="Unvollständig – bitte ergänzen" headingLevel={2}>
        Die Angaben mit [eckigen Klammern] fehlen noch. Welche Pflichtangaben für diesen Dienst gelten (z. B. § 5 DDG oder die Vorschriften des Sitzstaats Kroatien), sollte rechtlich geprüft werden, bevor die Anwendung öffentlich bereitgestellt wird.
      </Alert>
      <h2>Anbieter</h2>
      <p>
        GDPRGard.eu<br />
        betrieben von Zirlandia Milkovic (freiberufliche DSGVO-Beratung)<br />
        [Straße und Hausnummer]<br />
        [PLZ] Rijeka, Kroatien (EU)
      </p>
      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href="mailto:hello@gdprgard.eu">hello@gdprgard.eu</a><br />
        Datenschutzanfragen: <a href="mailto:privacy@gdprgard.eu">privacy@gdprgard.eu</a><br />
        Website: <a href="https://gdprgard.eu">gdprgard.eu</a><br />
        Telefon: [Telefonnummer, falls gewünscht]
      </p>
      <h2>Register und Umsatzsteuer-ID</h2>
      <p>[Registereintrag und Registernummer, falls vorhanden]<br />[Umsatzsteuer-Identifikationsnummer (USt-IdNr./OIB), falls vorhanden]</p>
    </PageShell>
  );
}
