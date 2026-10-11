import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Datenschutz",
  description: "Welche Daten BFSG Check für einen Scan verarbeitet und was nicht gespeichert wird.",
};

export default function DatenschutzPage() {
  return (
    <PageShell
      eyebrow="Datenschutz"
      title="Datenschutzhinweise"
      intro="Kurz gesagt: Wir verarbeiten die eingegebene Adresse nur für den angeforderten Scan. Adresse, Seiteninhalt und Bericht werden nicht dauerhaft gespeichert. Eine Registrierung ist nicht nötig."
    >
      <Alert tone="warning" title="Vorlage für Betreiber" headingLevel={2}>
        Dieser Text beschreibt das Verhalten der Software im MVP. Betreiber müssen die mit [eckigen Klammern] markierten Angaben (Verantwortlicher, Hosting, ggf. Datenschutzbeauftragte) ergänzen und die Hinweise rechtlich prüfen lassen, bevor sie die Anwendung öffentlich betreiben.
      </Alert>

      <h2>Verantwortlicher</h2>
      <p>[Name und Anschrift des Verantwortlichen], [E-Mail-Adresse], [ggf. Datenschutzbeauftragte/r]</p>

      <h2>Was passiert bei einem Scan?</h2>
      <ol>
        <li>Sie geben eine Website-Adresse ein und beantworten fünf Fragen. Die Einschätzung zum Anwendungsbereich wird in Ihrem Browser berechnet.</li>
        <li>Zum Scan sendet Ihr Browser die Adresse an unseren Server. Der Server lädt die Seite einmalig in einem Browser, führt die Prüfregeln aus und schickt das Ergebnis an Ihren Browser zurück.</li>
        <li>Nach Abschluss der Anfrage verwirft der Server Adresse, Seiteninhalt und Ergebnis. <strong>Es erfolgt keine dauerhafte Speicherung</strong> in einer Datenbank, Datei oder einem Cache.</li>
      </ol>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b bzw. f DSGVO (Bereitstellung des angefragten Dienstes, Betriebssicherheit).</p>

      <h2>Bitte keine vertraulichen Inhalte</h2>
      <p>
        Geben Sie nur öffentlich erreichbare Seiten ein, deren Inhalte nicht vertraulich sind. Die Seite wird vollständig von unserem Server abgerufen und verarbeitet. Seiten hinter Anmeldung, interne Adressen und lokale Adressen werden aus Sicherheitsgründen abgelehnt.
      </p>

      <h2>Was im Browser gespeichert wird</h2>
      <p>
        Eingaben, Ergebnisse, Ihre Status-Angaben und die Felder für den Erklärungsentwurf liegen im <em>Session Storage</em> Ihres Browser-Tabs. Beim Schließen des Tabs werden sie gelöscht. Sie werden nicht an uns übertragen (außer der Adresse für den Scan). Wir setzen <strong>keine Cookies</strong>, keine Tracking- oder Analyse-Dienste und laden keine Schriften oder Skripte von Dritten.
      </p>

      <h2>Technische Verarbeitung auf dem Server</h2>
      <ul>
        <li><strong>Missbrauchsschutz:</strong> Zur Begrenzung der Anfragen halten wir einen Zähler je Absender (IP-Adresse oder gemeinsamer Zähler) ausschließlich im Arbeitsspeicher vor. Er läuft nach wenigen Minuten ab und wird nicht gespeichert.</li>
        <li><strong>Server-Logs:</strong> Der Hosting-Anbieter [Hosting-Anbieter eintragen] kann beim Aufruf technisch notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt) protokollieren. Die Scan-Adresse wird im Anfragekörper übertragen und von der Anwendung nicht protokolliert; Fehlerprotokolle enthalten nur Fehlercodes. [Aufbewahrungsdauer eintragen]</li>
      </ul>

      <h2>Auswirkungen auf die geprüfte Website</h2>
      <p>
        Der Scan ruft die eingegebene Seite samt eingebundenen Ressourcen wie ein normaler Browser ab. Im Zugriffsprotokoll der geprüften Website erscheinen dabei die IP-Adresse unseres Servers und eine Browser-Kennung mit dem Hinweis „BFSG-Check“. Bitte nutzen Sie den Dienst nur für Seiten, die Sie betreiben oder für die Sie die Erlaubnis haben.
      </p>

      <h2>Ihre Rechte</h2>
      <p>
        Sie haben nach der DSGVO Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Da keine Daten dauerhaft gespeichert werden, können wir Auskunft in der Regel nur zu Daten geben, die uns beim Hosting-Anbieter technisch vorliegen.
      </p>
    </PageShell>
  );
}
