import type { ScanResult, IssueStatus } from "@/lib/scan/types";
import { SEVERITIES, SEVERITY_LABELS, type Severity } from "@/lib/scan/types";
import { SCAN_LIMITATION } from "../disclaimer";
import { Alert } from "../ui/alert";
import { Card } from "../ui/card";
import { Progress } from "../ui/progress";

const barColor: Record<Severity, string> = {
  critical: "bg-red-700",
  high: "bg-orange-600",
  medium: "bg-yellow-500",
  low: "bg-green-600",
};

function Stat({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <Card className="!p-4">
      <p className="text-3xl font-bold tabular-nums text-navy-900">{value}</p>
      <p className="mt-1 text-sm font-semibold text-navy-800">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-navy-600">{hint}</p>}
    </Card>
  );
}

export function ScanSummary({ scan, statuses }: { scan: ScanResult; statuses: Record<string, IssueStatus> }) {
  const { counts } = scan;
  const total = scan.issues.length;
  const done = scan.issues.filter((i) => statuses[i.id] === "done").length;
  const max = Math.max(1, ...SEVERITIES.map((s) => counts.bySeverity[s]));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat value={counts.violationRules} label="Erkannte Auffälligkeiten" hint={`betrifft ${counts.violationNodes} Elemente`} />
        <Stat value={counts.needsReviewRules} label="Manuell zu prüfen" hint="axe konnte nicht entscheiden" />
        <Stat value={counts.passedRules} label="Regeln ohne Befund" hint="kein Nachweis der Barrierefreiheit" />
        <Stat value={counts.inapplicableRules} label="Nicht anwendbare Regeln" hint="z. B. keine Tabellen vorhanden" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold">Auffälligkeiten nach Schweregrad</h3>
          <ul className="mt-4 space-y-3">
            {SEVERITIES.map((s) => (
              <li key={s} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 text-sm">
                <span className="font-medium">{SEVERITY_LABELS[s]}</span>
                <span className="h-3 overflow-hidden rounded-full bg-navy-100" aria-hidden="true">
                  <span className={`print-colors block h-full rounded-full ${barColor[s]}`} style={{ width: `${(counts.bySeverity[s] / max) * 100}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums">{counts.bySeverity[s]}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="text-base font-semibold">Ihr Bearbeitungsstand</h3>
          <p className="mt-1 text-sm text-navy-600">Zählt nur Ihre eigenen Status-Angaben. Es ist keine Bewertung der Seite.</p>
          <Progress className="mt-4" label="Erledigte Punkte" value={done} max={total} valueText={`${done} von ${total}`} />
          <p className="mt-3 text-sm text-navy-700" role="status">
            {total === 0 ? "Keine Punkte zu bearbeiten." : done === total ? "Alle automatisch erkannten Punkte sind als erledigt markiert. Bitte prüfen Sie zusätzlich manuell." : `${total - done} Punkte offen.`}
          </p>
        </Card>
      </div>

      <Alert tone="warning" title="Wichtig zur Einordnung">
        {SCAN_LIMITATION}
      </Alert>

      <p className="text-sm text-navy-600">
        Geprüft mit {scan.engine.name} {scan.engine.version} · {scan.ruleset} · Desktop-Ansicht {scan.viewport.width} × {scan.viewport.height} px · nur die eingegebene Seite.
      </p>
    </div>
  );
}
