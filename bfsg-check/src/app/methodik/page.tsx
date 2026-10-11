import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Alert } from "@/components/ui/alert";
import { AXE_TAGS, RULESET_LABEL } from "@/lib/scan/ruleset";
import { REVIEW_CYCLE_MONTHS, REVIEWED_ON, RULES_VERSION, SCOPE_BASIS } from "@/lib/scope/rules";
import { SEVERITY_LABELS } from "@/lib/scan/types";
import axe from "axe-core";

export const metadata: Metadata = {
  title: "Methodik und Grenzen",
  description: "Wie BFSG Check arbeitet, was automatische Tests leisten können und was nicht.",
};

const reviewed = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date(REVIEWED_ON));

export default function MethodikPage() {
  return (
    <PageShell
      eyebrow="Transparenz"
      title="Methodik und Grenzen"
      intro="So kommen Einschätzung und Befunde zustande – und was BFSG Check ausdrücklich nicht leistet."
    >
      <Alert tone="warning" title="Kurzfassung" headingLevel={2}>
        BFSG Check führt automatisierte Prüfungen nach anerkannten Barrierefreiheits-Regeln durch. Das ist ein nützlicher Startpunkt, aber kein Konformitätsnachweis. Manuelle Tests bleiben notwendig. Das Werkzeug vergibt keine Zertifikate und ist keine Rechtsberatung.
      </Alert>

      <h2>1. Was automatisch geprüft wird</h2>
      <p>
        Die Seite wird auf unserem Server in einem Chromium-Browser geladen, einschließlich JavaScript. Nach dem Laden (und einer kurzen Wartezeit für nachladende Inhalte) führt die Open-Source-Bibliothek <strong>axe-core</strong> (Deque Systems) ihre Prüfregeln auf dem fertig dargestellten Dokument aus – inklusive eingebetteter Frames.
      </p>
      <ul>
        <li>Engine: axe-core {axe.version}</li>
        <li>Regelsatz: {RULESET_LABEL} (Tags: {AXE_TAGS.join(", ")})</li>
        <li>Ansicht: Desktop, 1280 × 800 px, Sprache de-DE</li>
        <li>Umfang: ausschließlich die eingegebene Seite; es werden keine Links verfolgt</li>
      </ul>
      <p>
        Die Regeln orientieren sich an den Web Content Accessibility Guidelines (WCAG) 2.1, Stufen A und AA. Auf diese verweist auch die europäische Norm EN 301 549, die für den European Accessibility Act und damit das BFSG relevant ist. „Best Practices“ sind Empfehlungen ohne direktes WCAG-Erfolgskriterium und als solche gekennzeichnet.
      </p>

      <h2>2. Was automatische Tests nicht leisten können</h2>
      <p>
        Studien und Hersteller selbst gehen davon aus, dass automatisierte Werkzeuge nur einen Teil der möglichen Barrieren finden. Nicht erkennbar sind beispielsweise:
      </p>
      <ul>
        <li>ob Alternativtexte, Linktexte und Überschriften inhaltlich sinnvoll sind,</li>
        <li>ob die Fokus- und Leseführung logisch ist,</li>
        <li>ob Videos Untertitel oder Audiodeskription haben und diese gut sind,</li>
        <li>ob Fehlermeldungen verständlich sind und Zeitlimits ausreichend,</li>
        <li>mehrstufige Abläufe wie Warenkorb, Bezahlvorgang und Kundenkonto,</li>
        <li>PDF-Dokumente, mobile Apps und E-Mails.</li>
      </ul>
      <p>
        Der Scan trennt deshalb <em>erkannte Auffälligkeiten</em> (axe hat einen Verstoß festgestellt) von <em>manuell zu prüfenden Punkten</em> (axe konnte es nicht entscheiden). Findet axe nichts, bedeutet das nicht, dass die Seite barrierefrei ist.
      </p>

      <h2>3. Manuelle Tests bleiben erforderlich</h2>
      <p>
        Für belastbare Aussagen sind manuelle Prüfungen nötig: vollständige Bedienung nur mit der Tastatur, Tests mit Screenreadern (z. B. NVDA, VoiceOver), Zoom auf 200 % und 400 %, Test von Formularen, Overlays und dem Bestellprozess – idealerweise auch mit Menschen mit Behinderungen. Der Maßnahmenplan enthält dafür eine Checkliste.
      </p>

      <h2>4. Schweregrade</h2>
      <p>Die Einstufung übernimmt die Wirkungsgrade von axe-core. Sie beschreibt die technische Auswirkung auf Nutzende, nicht ein rechtliches Risiko.</p>
      <table className="my-4 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-navy-300">
            <th scope="col" className="py-2 pr-4">Anzeige</th>
            <th scope="col" className="py-2">axe-core-Wirkung</th>
          </tr>
        </thead>
        <tbody>
          {([["critical", "critical"], ["high", "serious"], ["medium", "moderate"], ["low", "minor"]] as const).map(([s, a]) => (
            <tr key={s} className="border-b border-navy-100">
              <td className="py-2 pr-4 font-medium">{SEVERITY_LABELS[s]}</td>
              <td className="py-2">{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        „Sofort beheben“ umfasst Kritisch und Hoch. „Als Nächstes planen“ umfasst Mittel, Niedrig und Empfehlungen. Es gibt bewusst keinen Gesamt-Score und keine Prozentzahl „Konformität“.
      </p>

      <h2>5. Keine Zertifizierung, keine Rechtsberatung</h2>
      <p>
        BFSG Check bescheinigt <strong>nicht</strong>, dass eine Website mit dem BFSG, dem European Accessibility Act, den WCAG oder anderen Vorgaben übereinstimmt. Der Bericht ist eine technische Dokumentationshilfe. Die „Erklärung zur Barrierefreiheit“ wird als Entwurf mit Platzhaltern erzeugt und muss von einer verantwortlichen Person geprüft werden. Das Werkzeug enthält weder ein Overlay noch eine automatische Korrektur Ihrer Website.
      </p>

      <h2>6. Einschätzung des Anwendungsbereichs</h2>
      <p>
        Die Fragen zur Betroffenheit führen zu einer vorsichtigen Orientierung. Ergebnisse lauten immer nur „Wahrscheinlich betroffen“, „Möglicherweise betroffen – Prüfung empfohlen“, „Möglicherweise ausgenommen“ oder „Nicht ausreichend beurteilbar“. Ausnahmen werden nie als endgültig dargestellt.
      </p>
      <p>{SCOPE_BASIS.note}</p>
      <p>{SCOPE_BASIS.microEnterprise}</p>
      <Alert tone="info" title="Versionierte Regeln">
        Die Deutschland-spezifischen Regeln sind versioniert. Aktuell: Version <strong>{RULES_VERSION}</strong>, zuletzt überprüft am {reviewed}. Wir empfehlen, sie mindestens alle {REVIEW_CYCLE_MONTHS} Monate und bei Änderungen von Gesetz, Verordnung oder Behördenauslegung zu prüfen. Der Stand wird in jeder Einschätzung und in jedem Bericht ausgewiesen.
      </Alert>

      <h2>7. Weitere bekannte Einschränkungen</h2>
      <ul>
        <li>Seiten, die Bots blockieren, eine Anmeldung verlangen oder Cookie-Banner vor den Inhalt legen, können unvollständig oder gar nicht geprüft werden.</li>
        <li>Inhalte, die nur nach Klick, Hover oder Scrollen erscheinen, werden nicht ausgelöst.</li>
        <li>Die Prüfung ist eine Momentaufnahme. Dynamische oder personalisierte Seiten können beim nächsten Aufruf anders ausfallen.</li>
        <li>Zu große, sehr langsame oder nicht öffentlich erreichbare Seiten werden abgebrochen; dann gibt es einen Fehlerhinweis, aber keine Ersatzergebnisse.</li>
      </ul>

      <p>
        Zum Umgang mit Ihren Daten siehe <Link href="/datenschutz">Datenschutz</Link>.
      </p>
    </PageShell>
  );
}
