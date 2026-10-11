"use client";
import Link from "next/link";
import { useMemo } from "react";
import { buildPlan } from "@/lib/scan/plan";
import { SEVERITIES, SEVERITY_LABELS, STATUS_LABELS, type Issue, type IssueStatus } from "@/lib/scan/types";
import { formatWcag } from "@/lib/scan/wcag";
import { REVIEW_CYCLE_MONTHS } from "@/lib/scope/rules";
import { useCheckSession } from "@/lib/session";
import { GENERAL_DISCLAIMER, SCAN_LIMITATION } from "../disclaimer";
import { PrinterIcon } from "../icons";
import { ScopeResultCard } from "../scope-result";
import { SeverityBadge } from "../severity-badge";
import { Button, ButtonLink } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { DemoBanner } from "../results/demo-banner";
import { StatementPreview } from "../results/statement-draft";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" });

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="report-section mt-10">
      <h2 id={id} className="border-b border-navy-200 pb-2 text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function IssueTable({ issues, statuses, caption }: { issues: Issue[]; statuses: Record<string, IssueStatus>; caption: string }) {
  if (issues.length === 0) return <p className="text-navy-700">Keine Einträge.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-navy-300">
            <th scope="col" className="py-2 pr-3 font-semibold">Schweregrad</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Problem</th>
            <th scope="col" className="py-2 pr-3 font-semibold">WCAG</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Elemente</th>
            <th scope="col" className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id} className="avoid-break border-b border-navy-100 align-top">
              <td className="py-2 pr-3"><SeverityBadge severity={i.severity} /></td>
              <td className="py-2 pr-3">
                <span className="font-medium">{i.title}</span>
                <span className="block text-xs text-navy-600">{i.areas.join(", ")}</span>
              </td>
              <td className="py-2 pr-3">{i.wcag.length ? i.wcag.map((w) => w.criterion).join(", ") : "–"}</td>
              <td className="py-2 pr-3 tabular-nums">{i.nodeCount}</td>
              <td className="py-2">{STATUS_LABELS[statuses[i.id] ?? (i.kind === "needs-review" ? "manual" : "open")]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <p className="text-navy-700">Keine Einträge.</p>;
  return (
    <ol className="space-y-4">
      {issues.map((i) => (
        <li key={i.id} className="avoid-break">
          <p className="font-semibold">
            {i.title} <span className="font-normal text-navy-600">– {SEVERITY_LABELS[i.severity]}, {i.nodeCount} {i.nodeCount === 1 ? "Element" : "Elemente"}</span>
          </p>
          <p className="text-sm text-navy-700">Betroffen: {i.affected.join(", ")}.{i.wcag.length > 0 && ` ${i.wcag.map(formatWcag).join("; ")}.`}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {i.remediation.map((r, k) => (
              <li key={k}>{r}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function ReportView() {
  const { session, hydrated } = useCheckSession();
  const { scan, scope, statuses } = session;
  const plan = useMemo(() => (scan ? buildPlan(scan) : null), [scan]);

  if (!hydrated) {
    return <div className="container-page py-14" role="status"><p className="text-navy-600">Bericht wird geladen …</p></div>;
  }

  if (!scan || !scope || !plan) {
    return (
      <div className="container-page py-14">
        <div className="mx-auto max-w-2xl">
          <EmptyState title="Noch kein Bericht verfügbar" action={<ButtonLink href="/check">Kostenlosen Check starten</ButtonLink>}>
            Ein Bericht entsteht aus einem abgeschlossenen Check. Ergebnisse werden nur in diesem Browser-Tab gehalten; nach dem Schließen des Tabs sind sie nicht mehr verfügbar.
          </EmptyState>
        </div>
      </div>
    );
  }

  const done = scan.issues.filter((i) => statuses[i.id] === "done").length;
  const dateText = dateFmt.format(new Date(scan.scannedAt));

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="no-print mx-auto mb-8 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 p-4">
        <p className="max-w-prose text-sm text-navy-800">
          Nutzen Sie „Drucken / Als PDF speichern“ und wählen Sie im Druckdialog <strong>„Als PDF speichern“</strong>. Der Bericht enthält den aktuellen Bearbeitungsstand.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.print()}>
            <PrinterIcon />
            Drucken / Als PDF speichern
          </Button>
          <ButtonLink href="/ergebnis" variant="secondary">
            Zurück zu den Ergebnissen
          </ButtonLink>
        </div>
      </div>

      <article className="mx-auto max-w-4xl" aria-labelledby="report-title">
        <header className="border-b-4 border-primary-700 pb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">BFSG Check · Bericht</p>
          <h1 id="report-title" className="mt-2 text-3xl sm:text-4xl">
            Bericht zur digitalen Barrierefreiheit
          </h1>
          <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="font-semibold text-navy-700">Geprüfte Adresse</dt>
            <dd className="break-all">{scan.url}</dd>
            {scan.finalUrl !== scan.url && (
              <>
                <dt className="font-semibold text-navy-700">Nach Weiterleitung</dt>
                <dd className="break-all">{scan.finalUrl}</dd>
              </>
            )}
            <dt className="font-semibold text-navy-700">Datum des Scans</dt>
            <dd>{dateText} Uhr</dd>
            <dt className="font-semibold text-navy-700">Prüfumfang</dt>
            <dd>Eine einzelne Seite, automatisierter Test ({scan.engine.name} {scan.engine.version}, {scan.ruleset})</dd>
          </dl>
          {scan.isDemo && <div className="mt-5"><DemoBanner /></div>}
          <p className="mt-5 rounded-lg border border-navy-200 bg-navy-50 p-3 text-sm text-navy-800">{GENERAL_DISCLAIMER}</p>
        </header>

        <Section id="r-scope" title="1. Einschätzung zum Anwendungsbereich">
          <ScopeResultCard result={scope} headingLevel={3} compact />
        </Section>

        <Section id="r-summary" title="2. Zusammenfassung des automatischen Scans">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Kennzahlen des automatischen Scans</caption>
            <tbody>
              {[
                ["Erkannte Auffälligkeiten (Regeln)", scan.counts.violationRules],
                ["Davon betroffene Elemente", scan.counts.violationNodes],
                ...SEVERITIES.map((s) => [`– Schweregrad ${SEVERITY_LABELS[s]}`, scan.counts.bySeverity[s]] as [string, number]),
                ["Manuell zu prüfende Punkte (axe: unentschieden)", scan.counts.needsReviewRules],
                ["Regeln ohne Befund (kein Nachweis der Barrierefreiheit)", scan.counts.passedRules],
                ["Nicht anwendbare Regeln", scan.counts.inapplicableRules],
                ["Bearbeitungsstand: als erledigt markiert", `${done} von ${scan.issues.length}`],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b border-navy-100">
                  <th scope="row" className="py-2 pr-4 font-normal">{label}</th>
                  <td className="py-2 text-right font-semibold tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-950 print-colors">{SCAN_LIMITATION}</p>
        </Section>

        <Section id="r-issues" title="3. Priorisierte Befunde">
          <IssueTable issues={scan.issues} statuses={statuses} caption="Alle Befunde nach Priorität" />
        </Section>

        <Section id="r-plan" title="4. Maßnahmenplan">
          <h3 className="text-lg">Sofort beheben ({plan.immediate.length})</h3>
          <div className="mt-3"><ActionList issues={plan.immediate} /></div>
          <h3 className="mt-8 text-lg">Als Nächstes planen ({plan.next.length})</h3>
          <div className="mt-3"><ActionList issues={plan.next} /></div>
          <h3 className="mt-8 text-lg">Manuell testen</h3>
          {plan.manualIssues.length > 0 && <div className="mt-3"><ActionList issues={plan.manualIssues} /></div>}
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {plan.manualChecklist.map((c) => (
              <li key={c.id} className="avoid-break"><span className="font-semibold">{c.title}:</span> {c.description}</li>
            ))}
          </ul>
          <h3 className="mt-8 text-lg">Nicht automatisch prüfbar</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {plan.notAutomatable.map((c) => (
              <li key={c.id} className="avoid-break"><span className="font-semibold">{c.title}:</span> {c.description}</li>
            ))}
          </ul>
        </Section>

        <Section id="r-method" title="5. Methodik und Grenzen">
          <div className="prose-de !max-w-none space-y-3 text-sm">
            <p>Die Prüfung erfolgt automatisiert mit {scan.engine.name} {scan.engine.version} in einem Chromium-Browser (Desktop-Ansicht {scan.viewport.width} × {scan.viewport.height} px). Angewendet wurde der Regelsatz „{scan.ruleset}“. Geprüft wurde ausschließlich die oben genannte Seite im Zustand nach dem Laden.</p>
            <p>Nicht geprüft werden u. a. weitere Seiten, mehrstufige Abläufe (Warenkorb, Bestellung, Kundenkonto), geschützte Bereiche, Dokumente (z. B. PDF), mobile Apps sowie Inhalte, die erst nach Interaktion erscheinen. Viele Anforderungen – etwa die Qualität von Alternativtexten, eine logische Fokusreihenfolge oder verständliche Fehlermeldungen – lassen sich nur manuell beurteilen.</p>
            <p>Manuelle Tests mit Tastatur und Screenreader bleiben erforderlich. Der Schweregrad entspricht der Einstufung von axe-core (Kritisch = „critical“, Hoch = „serious“, Mittel = „moderate“, Niedrig = „minor“) und ist keine rechtliche Bewertung.</p>
            <p>Die Deutschland-spezifische Einordnung folgt versionierten Regeln (Stand {scope.rulesVersion}, geprüft am {scope.rulesReviewedOn}) und sollte spätestens alle {REVIEW_CYCLE_MONTHS} Monate überprüft werden. Details: <Link href="/methodik" className="link">Methodik-Seite</Link>.</p>
          </div>
        </Section>

        <Section id="r-statement" title="Anhang: Entwurf einer Erklärung zur Barrierefreiheit">
          <StatementPreview scan={scan} fields={session.statement} headingLevel={3} />
        </Section>

        <Section id="r-legal" title="Rechtlicher Hinweis">
          <p className="text-sm">{GENERAL_DISCLAIMER}</p>
          <p className="mt-2 text-sm">{scope.disclaimer}</p>
          <p className="mt-2 text-sm text-navy-600">Dieser Bericht wurde nicht auf einem Server gespeichert; er existiert nur in Ihrem Browser und in den von Ihnen erzeugten Ausdrucken bzw. PDF-Dateien.</p>
        </Section>
      </article>
    </div>
  );
}
