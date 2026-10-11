"use client";
import type { RemediationPlan } from "@/lib/scan/plan";
import type { Issue, IssueStatus } from "@/lib/scan/types";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { IssueCard } from "./issue-card";

interface Props {
  plan: RemediationPlan;
  statuses: Record<string, IssueStatus>;
  onStatusChange: (issue: Issue, status: IssueStatus) => void;
}

const statusOf = (issue: Issue, statuses: Record<string, IssueStatus>): IssueStatus => statuses[issue.id] ?? (issue.kind === "needs-review" ? "manual" : "open");

function Group({ id, title, intro, count, children }: { id: string; title: string; intro: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="scroll-mt-24 report-section">
      <h3 id={`${id}-h`} className="text-xl">
        {title}
        {count !== undefined && <span className="ml-2 text-base font-normal text-navy-600">({count})</span>}
      </h3>
      <p className="mt-1 max-w-prose text-navy-700">{intro}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function RemediationPlanView({ plan, statuses, onStatusChange }: Props) {
  const render = (issues: Issue[]) =>
    issues.map((i) => <IssueCard key={i.id} issue={i} status={statusOf(i, statuses)} onStatusChange={(s) => onStatusChange(i, s)} />);

  return (
    <div className="space-y-10">
      <nav aria-label="Abschnitte des Maßnahmenplans" className="no-print">
        <ul className="flex flex-wrap gap-2 text-sm">
          {[
            ["sofort", `Sofort beheben (${plan.immediate.length})`],
            ["naechstes", `Als Nächstes planen (${plan.next.length})`],
            ["manuell", "Manuell testen"],
            ["nicht-automatisch", "Nicht automatisch prüfbar"],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-[44px] items-center rounded-full border border-navy-300 bg-white px-4 py-1.5 font-medium text-navy-800 hover:bg-navy-50">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Group
        id="sofort"
        title="Sofort beheben"
        count={plan.immediate.length}
        intro="Kritische und hohe Auffälligkeiten, die Nutzende typischerweise ganz am Zugang hindern – etwa fehlende Beschriftungen oder Kontraste. Beginnen Sie hier."
      >
        {plan.immediate.length === 0 ? (
          <EmptyState title="Keine kritischen oder hohen Auffälligkeiten erkannt">
            Das bedeutet nicht, dass keine vorhanden sind: Der Scan deckt nur einen Teil ab. Arbeiten Sie die manuellen Tests ab.
          </EmptyState>
        ) : (
          render(plan.immediate)
        )}
      </Group>

      <Group
        id="naechstes"
        title="Als Nächstes planen"
        count={plan.next.length}
        intro="Mittlere und niedrige Auffälligkeiten sowie Empfehlungen (Best Practices). Planen Sie sie in die nächsten Releases ein."
      >
        {plan.next.length === 0 ? <EmptyState title="Keine weiteren Auffälligkeiten erkannt" /> : render(plan.next)}
      </Group>

      <Group
        id="manuell"
        title="Manuell testen"
        intro="Punkte, bei denen der Scan keine eindeutige Aussage treffen konnte, sowie eine feste Checkliste für Tests, die ein Mensch durchführen muss."
      >
        {plan.manualIssues.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-base font-semibold">Vom Scan nicht eindeutig entschiedene Punkte ({plan.manualIssues.length})</h4>
            {render(plan.manualIssues)}
          </div>
        )}
        <Card as="section" aria-labelledby="checkliste-h" tone="muted">
          <h4 id="checkliste-h" className="text-base font-semibold">
            Checkliste für manuelle Tests
          </h4>
          <p className="mt-1 text-sm text-navy-600">Allgemeine Anleitung – kein Befund. Unabhängig vom Scan-Ergebnis empfohlen.</p>
          <ul className="mt-4 space-y-4">
            {plan.manualChecklist.map((c) => (
              <li key={c.id}>
                <p className="font-semibold">{c.title}</p>
                <p className="text-navy-700">{c.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Group>

      <Group
        id="nicht-automatisch"
        title="Nicht automatisch prüfbar"
        intro="Diese Anforderungen kann kein automatischer Test beurteilen. Sie benötigen redaktionelle oder manuelle Prüfung – der Scan sagt dazu nichts aus."
      >
        <Card tone="muted">
          <ul className="space-y-4">
            {plan.notAutomatable.map((c) => (
              <li key={c.id}>
                <p className="font-semibold">{c.title}</p>
                <p className="text-navy-700">{c.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Group>
    </div>
  );
}
