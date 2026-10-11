import Link from "next/link";
import { ClipboardIcon, ListIcon, PlugIcon, ScanIcon, ShieldIcon, UsersIcon } from "../icons";
import { Tag } from "../severity-badge";
import { ButtonLink } from "../ui/button";
import { Card } from "../ui/card";

export function HowItWorks() {
  const steps = [
    { icon: <ShieldIcon />, title: "Anwendungsbereich einschätzen", text: "Fünf kurze Fragen zu Angebot, Kundschaft und Unternehmensgröße ergeben eine vorsichtige Orientierung, ob das BFSG Ihr Angebot betreffen könnte." },
    { icon: <ScanIcon />, title: "Seite automatisch prüfen", text: "Wir laden Ihre Seite in einem echten Browser und lassen die Prüfregeln von axe-core laufen. Ergebnisse stammen nur aus diesem Scan." },
    { icon: <ListIcon />, title: "Maßnahmen priorisieren", text: "Jeder Befund kommt mit Erklärung, Betroffenen, WCAG-Bezug und Lösungshinweis – einsortiert in einen Maßnahmenplan mit Statusverfolgung." },
  ];
  return (
    <section id="ablauf" aria-labelledby="ablauf-h" className="scroll-mt-24 py-16">
      <div className="container-page">
        <h2 id="ablauf-h" className="text-3xl">So funktioniert der Check</h2>
        <p className="mt-3 max-w-prose text-navy-700">In drei Schritten von der Einordnung zum dokumentierten Maßnahmenplan – ohne Registrierung.</p>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-50 text-primary-700">{s.icon}</span>
                  <span className="text-sm font-semibold text-navy-600">Schritt {i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg">{s.title}</h3>
                <p className="mt-2 text-navy-700">{s.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Deliverables() {
  const items = [
    ["Einschätzung zum Anwendungsbereich", "Verständlich begründet, mit klarem Hinweis auf die Grenzen."],
    ["Technische Befunde", "Schweregrad, betroffene Elemente und Bereiche, Wer ist betroffen, WCAG-Bezug."],
    ["Priorisierter Maßnahmenplan", "Sofort beheben, als Nächstes planen, manuell testen, nicht automatisch prüfbar."],
    ["Fortschritt dokumentieren", "Status je Punkt: Offen, In Arbeit, Erledigt, Manuell prüfen."],
    ["Bericht zum Drucken", "Sauberes Dokument mit Methodik und Hinweisen – als PDF speicherbar."],
    ["Entwurf einer Barrierefreiheitserklärung", "Vorsichtig formuliert, mit Platzhaltern und klar als Entwurf markiert."],
  ];
  return (
    <section aria-labelledby="inhalt-h" className="bg-navy-50 py-16">
      <div className="container-page">
        <h2 id="inhalt-h" className="text-3xl">Was Sie erhalten</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([t, d]) => (
            <li key={t}>
              <Card className="h-full">
                <h3 className="text-base">{t}</h3>
                <p className="mt-1 text-navy-700">{d}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Boundaries() {
  return (
    <section aria-labelledby="grenzen-h" className="py-16">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 id="grenzen-h" className="text-3xl">Ehrlich über die Grenzen</h2>
            <p className="mt-3 max-w-prose text-navy-700">
              BFSG Check ist ein Werkzeug für Nachweis und Priorisierung – kein Gütesiegel. Wir geben keine Scores, keine Prozent-Konformität und kein „vollständig barrierefrei“ aus.
            </p>
            <div className="mt-5">
              <ButtonLink href="/methodik" variant="secondary">Methodik im Detail</ButtonLink>
            </div>
          </div>
          <ul className="space-y-3">
            {[
              "Automatisierte Tests finden nur einen Teil der Barrieren. Manuelle Tests mit Tastatur und Screenreader bleiben erforderlich.",
              "Geprüft wird die eingegebene Seite – nicht der gesamte Shop und nicht der Bestellprozess.",
              "Die Einschätzung zum Anwendungsbereich ist eine Orientierung und keine Rechtsberatung.",
              "Kein Overlay, kein Widget, keine automatische Korrektur Ihrer Website.",
              "Keine Zertifizierung: Weder BFSG-, EAA- noch WCAG-Konformität wird bescheinigt.",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl border border-navy-200 p-4">
                <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-700" />
                <span className="text-navy-800">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Agencies() {
  return (
    <section id="agenturen" aria-labelledby="agenturen-h" className="scroll-mt-24 bg-navy-50 py-16">
      <div className="container-page">
        <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-primary-700 ring-1 ring-navy-200"><UsersIcon /></span>
              <Tag tone="blue">Geplant – noch nicht verfügbar</Tag>
            </div>
            <h2 id="agenturen-h" className="mt-4 text-3xl">Für Agenturen</h2>
            <p className="mt-3 max-w-prose text-navy-700">
              Wer mehrere Kundenprojekte betreut, braucht nachvollziehbare Berichte statt Einzelchecks. Als künftige Funktion sind Mehr-Kunden-Berichte vorgesehen. Der MVP enthält dafür bewusst weder Anmeldung noch Abrechnung.
            </p>
          </div>
          <Card>
            <h3 className="text-base">Vorgesehen für später</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-navy-800">
              <li>Mehrere Kunden und Projekte in einer Übersicht</li>
              <li>Wiederholte Scans und Verlauf über die Zeit</li>
              <li>Berichte im Branding der Agentur</li>
              <li>Gemeinsame Bearbeitung von Maßnahmen</li>
            </ul>
            <p className="mt-4 text-sm text-navy-600">Interesse? Schreiben Sie uns über das <Link className="link" href="/impressum">Impressum</Link>.</p>
          </Card>
        </div>
      </div>
    </section>
  );
}

export function Integrations() {
  const items = [
    { name: "WordPress", text: "Geplant: Plugin, das Scan-Ergebnisse im Dashboard anzeigt und Befunde mit Seiten und Themes verknüpft." },
    { name: "Shopify", text: "Geplant: App, die Vorlagen eines Shops prüft und Befunde den Theme-Dateien zuordnet." },
  ];
  return (
    <section aria-labelledby="integr-h" className="py-16">
      <div className="container-page">
        <h2 id="integr-h" className="text-3xl">Integrationen</h2>
        <p className="mt-3 max-w-prose text-navy-700">In Planung. Diese Integrationen zeigen Befunde an und beheben nichts automatisch – es wird kein Overlay und keine verdeckte Änderung an Ihrer Website geben.</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {items.map((i) => (
            <li key={i.name}>
              <Card tone="muted" className="h-full border-dashed">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-navy-600 ring-1 ring-navy-200"><PlugIcon /></span>
                  <h3 className="text-lg">{i.name}</h3>
                  <Tag>In Planung</Tag>
                </div>
                <p className="mt-3 text-navy-700">{i.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FAQ = [
  ["Ist das eine Rechtsberatung?", "Nein. BFSG Check liefert eine Orientierung und technische Hinweise. Die Anwendbarkeit des BFSG hängt vom Einzelfall ab; im Zweifel holen Sie fachkundigen Rat ein."],
  ["Kann ich damit nachweisen, dass meine Seite konform ist?", "Nein. Der Bericht dokumentiert automatisch erkannte Auffälligkeiten und Ihren Bearbeitungsstand. Er bescheinigt keine Konformität mit BFSG, EAA oder WCAG."],
  ["Werden meine Daten gespeichert?", "Adresse, Seiteninhalt und Bericht werden nicht dauerhaft gespeichert. Ergebnisse liegen nur in Ihrem Browser-Tab. Details finden Sie unter Datenschutz."],
  ["Warum wird nur eine Seite geprüft?", "Der MVP prüft bewusst nur die eingegebene Seite, um Last und Missbrauchsrisiko gering zu halten. Prüfen Sie zentrale Seitentypen (Startseite, Produkt, Warenkorb, Kasse) einzeln."],
  ["Warum meldet der Scan manchmal nichts?", "Automatisierte Tests decken nur einen Teil der Anforderungen ab. Keine Befunde heißt nicht „barrierefrei“. Nutzen Sie die Checkliste für manuelle Tests."],
];

export function Faq() {
  return (
    <section aria-labelledby="faq-h" className="bg-navy-50 py-16">
      <div className="container-page">
        <div className="mx-auto max-w-3xl">
          <h2 id="faq-h" className="text-3xl">Häufige Fragen</h2>
          <div className="mt-6 divide-y divide-navy-200 rounded-xl border border-navy-200 bg-white">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="cursor-pointer text-lg font-semibold text-navy-900 marker:text-primary-700">{q}</summary>
                <p className="mt-3 max-w-prose text-navy-700">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroPanel() {
  const items = [
    { icon: <ShieldIcon />, t: "Einschätzung", d: "Betrifft das BFSG Ihr Angebot?" },
    { icon: <ScanIcon />, t: "Befunde", d: "Technische Barrieren auf Ihrer Seite" },
    { icon: <ClipboardIcon />, t: "Maßnahmenplan", d: "Was zuerst, was später, was manuell" },
  ];
  return (
    <Card tone="muted" className="lg:mt-2">
      <h2 className="text-base">Ihr Ergebnis auf einen Blick</h2>
      <ul className="mt-4 space-y-4">
        {items.map((i) => (
          <li key={i.t} className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-primary-700 ring-1 ring-navy-200">{i.icon}</span>
            <span>
              <span className="block font-semibold">{i.t}</span>
              <span className="block text-sm text-navy-700">{i.d}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-navy-200 pt-4 text-sm text-navy-700">Kostenlos, ohne Registrierung. Keine Rechtsberatung, keine Zertifizierung.</p>
    </Card>
  );
}
