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
        Dieser Text beschreibt das Verhalten der Software im MVP. Betreiber müssen die mit [eckigen Klammern] markierten Angaben (Straßenanschrift des Verantwortlichen, Aufbewahrungsdauer der Zugriffsprotokolle bei Netlify) ergänzen und die Hinweise rechtlich prüfen lassen, bevor sie die Anwendung öffentlich betreiben.
      </Alert>

      <h2>Verantwortlicher</h2>
      <p>
        GDPRGard.eu, betrieben von Zirlandia Milkovic (freiberufliche DSGVO-Beratung), Rijeka, Kroatien (EU). [Straße und Hausnummer, PLZ ergänzen]<br />
        Kontakt in Datenschutzangelegenheiten: <a href="mailto:privacy@gdprgard.eu">privacy@gdprgard.eu</a>
      </p>

      <h2>Was passiert bei einem Scan?</h2>
      <ol>
        <li>Sie geben eine Website-Adresse ein und beantworten fünf Fragen. Die Einschätzung zum Anwendungsbereich wird in Ihrem Browser berechnet.</li>
        <li>Zum Scan sendet Ihr Browser die Adresse an unseren Server. Der Server lädt die Seite einmalig in einem Browser, führt die Prüfregeln aus und schickt das Ergebnis an Ihren Browser zurück. Das Ergebnis enthält Textauszüge (HTML-Ausschnitte) der betroffenen Elemente der geprüften Seite. Falls diese Seite personenbezogene Daten Dritter enthält, können sie darin vorkommen; sie werden nur zur Beantwortung Ihrer Anfrage verarbeitet und nicht gespeichert.</li>
        <li>Nach Abschluss der Anfrage verwirft der Server Adresse, Seiteninhalt und Ergebnis. <strong>Es erfolgt keine dauerhafte Speicherung</strong> in einer Datenbank, Datei oder einem Cache.</li>
      </ol>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b bzw. f DSGVO (Bereitstellung des angefragten Dienstes, Betriebssicherheit).</p>

      <h2>Bitte keine vertraulichen Inhalte</h2>
      <p>
        Geben Sie nur öffentlich erreichbare Seiten ein, deren Inhalte nicht vertraulich sind. Die Seite wird vollständig von unserem Server abgerufen und verarbeitet. Interne und lokale Adressen werden aus Sicherheitsgründen abgelehnt. Seiten hinter einer Anmeldung können nicht sinnvoll geprüft werden: Der Scan sieht nur die öffentlich erreichbare Seite, bei einem Login also lediglich die Anmeldemaske.
      </p>

      <h2>Was im Browser gespeichert wird</h2>
      <p>
        Eingaben, Ergebnisse, Ihre Status-Angaben und die Felder für den Erklärungsentwurf liegen im <em>Session Storage</em> Ihres Browser-Tabs. Beim Schließen des Tabs werden sie gelöscht. Sie werden nicht dauerhaft bei uns gespeichert; an den Server wird nur die Adresse für den Scan gesendet (die Scan-Ergebnisse kommen vom Server zurück, siehe oben). Wir setzen <strong>keine Cookies</strong>, keine Tracking- oder Analyse-Dienste und laden keine Schriften oder Skripte von Dritten. Der Session Storage gilt für die gesamte Domain gdprgard.eu: Skripte anderer Seiten dieser Domain, die im selben Tab geöffnet werden, könnten ihn technisch lesen. [Bitte prüfen, ob dies für Ihr Gesamtangebot relevant ist.]
      </p>

      <h2>Technische Verarbeitung auf dem Server</h2>
      <ul>
        <li><strong>Missbrauchsschutz:</strong> Zur Begrenzung der Anfragen halten wir einen Zähler je Absender (IP-Adresse oder gemeinsamer Zähler) ausschließlich im Arbeitsspeicher vor. Er läuft nach wenigen Minuten ab und wird nicht gespeichert.</li>
        <li><strong>Server-Logs:</strong> Beim Aufruf entstehen bei den unten genannten Dienstleistern technisch notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt, aufgerufener Pfad, Browserkennung). Die Scan-Adresse wird im Anfragekörper übertragen und von der Anwendung nicht protokolliert; Fehlerprotokolle der Anwendung enthalten nur Fehlercodes.</li>
      </ul>

      <h2>Empfänger und Auftragsverarbeiter</h2>
      <p>Zur Bereitstellung des Dienstes setzen wir folgende Dienstleister als Auftragsverarbeiter ein. Beide verarbeiten dabei technisch notwendige Verbindungsdaten wie Ihre IP-Adresse:</p>
      <ul>
        <li>
          <strong>Netlify, Inc.</strong> (USA) – Auslieferung der Domain gdprgard.eu und Weiterleitung der Anfragen an den Scan-Server. Es besteht eine Datenverarbeitungsvereinbarung (DPA), die Bestandteil der Netlify-Vertragsbedingungen ist. Netlify ist nach eigenen Angaben unter dem EU-US Data Privacy Framework zertifiziert. [Aufbewahrungsdauer der Zugriffsprotokolle bei Netlify eintragen]
        </li>
        <li>
          <strong>Google Cloud EMEA Limited</strong> (Irland, ggf. gemeinsam mit Google LLC, USA, als Unterauftragsverarbeiter) – Betrieb des Scan-Servers auf Google Cloud Run in der Region <strong>europe-west1 (Belgien)</strong>. Es gilt das Cloud Data Processing Addendum von Google. Cloud Run protokolliert Anfragen (u. a. IP-Adresse, Zeitpunkt, Pfad, Browserkennung) in Cloud Logging; die Standard-Aufbewahrungsdauer beträgt dort <strong>30 Tage</strong>, danach werden die Einträge gelöscht.
        </li>
      </ul>

      <h2>Übermittlung in Drittländer</h2>
      <p>
        Der Scan-Server und seine Protokolle liegen in der EU (Belgien). Ein Zugriff durch Konzerngesellschaften oder Unterauftragsverarbeiter in den USA, etwa im Rahmen von Support, kann nicht vollständig ausgeschlossen werden. Netlify hat seinen Sitz in den USA. Als Grundlage für Übermittlungen dienen:
      </p>
      <ul>
        <li>bei Netlify: der Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework (Art. 45 DSGVO), soweit das Unternehmen zertifiziert ist;</li>
        <li>bei Google Cloud: die Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO), die Bestandteil des Cloud Data Processing Addendum sind.</li>
      </ul>
      <p>Eine Kopie der Garantien können Sie unter privacy@gdprgard.eu anfordern.</p>

      <h2>Auswirkungen auf die geprüfte Website</h2>
      <p>
        Der Scan ruft die eingegebene Seite samt eingebundenen Ressourcen wie ein normaler Browser ab. Im Zugriffsprotokoll der geprüften Website erscheinen dabei die IP-Adresse unseres Servers und eine Browser-Kennung mit dem Hinweis „BFSG-Check“. Bitte nutzen Sie den Dienst nur für Seiten, die Sie betreiben oder für die Sie die Erlaubnis haben.
      </p>

      <h2>Ihre Rechte</h2>
      <p>
        Sie haben nach der DSGVO Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, in Kroatien bei der Agencija za zaštitu osobnih podataka (AZOP, azop.hr). Zur Ausübung Ihrer Rechte schreiben Sie an privacy@gdprgard.eu. Da keine Daten dauerhaft gespeichert werden, können wir Auskunft in der Regel nur zu Daten geben, die uns bei den oben genannten Dienstleistern technisch vorliegen.
      </p>

      <p className="text-sm text-navy-600">Stand: 12. Oktober 2026 (Entwurf, noch nicht rechtlich geprüft).</p>
    </PageShell>
  );
}
