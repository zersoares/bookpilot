"use client";
import { useId } from "react";
import type { Issue, IssueStatus } from "@/lib/scan/types";
import { formatWcag } from "@/lib/scan/wcag";
import { SeverityBadge, Tag } from "../severity-badge";
import { StatusSelect } from "./status-select";

const KIND_LABEL = { violation: "Automatisch erkannt", "needs-review": "Manuell prüfen (axe konnte es nicht entscheiden)" } as const;

interface Props {
  issue: Issue;
  status: IssueStatus;
  onStatusChange: (status: IssueStatus) => void;
  headingLevel?: 3 | 4;
}

export function IssueCard({ issue, status, onStatusChange, headingLevel = 4 }: Props) {
  const uid = useId();
  const Heading = `h${headingLevel}` as "h3" | "h4";
  const done = status === "done";
  return (
    <article className={`avoid-break rounded-xl border border-navy-200 bg-white p-5 ${done ? "opacity-80" : ""}`} aria-labelledby={`${uid}-t`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <Tag tone={issue.kind === "needs-review" ? "blue" : "neutral"}>{KIND_LABEL[issue.kind]}</Tag>
        {issue.bestPractice && <Tag>Empfehlung (kein WCAG-Kriterium)</Tag>}
      </div>

      <Heading id={`${uid}-t`} className="mt-3 text-lg">
        {issue.title}
        <span className="ml-2 text-sm font-normal text-navy-600">
          ({issue.nodeCount} {issue.nodeCount === 1 ? "Element" : "Elemente"})
        </span>
      </Heading>
      <p className="mt-2 text-navy-800">{issue.explanation}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
        <dt className="font-semibold text-navy-700">Betroffener Bereich</dt>
        <dd>{issue.areas.length ? issue.areas.join(", ") : "Nicht zuordenbar"}</dd>
        <dt className="font-semibold text-navy-700">Wer ist betroffen?</dt>
        <dd>{issue.affected.join(", ")}</dd>
        <dt className="font-semibold text-navy-700">WCAG-Bezug</dt>
        <dd>
          {issue.wcag.length > 0 ? (
            <ul className="space-y-0.5">
              {issue.wcag.map((w) => (
                <li key={w.criterion}>{formatWcag(w)}</li>
              ))}
            </ul>
          ) : (
            "Kein direktes WCAG-Erfolgskriterium (Best Practice)"
          )}
        </dd>
      </dl>

      <div className="mt-4">
        <h5 className="text-sm font-semibold text-navy-700">So beheben Sie es</h5>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-navy-800">
          {issue.remediation.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {issue.genericText && (
        <p className="mt-3 rounded-lg bg-navy-50 p-3 text-sm text-navy-700">
          Für diese Prüfregel liegt noch kein ausführlicher deutscher Text vor. Der Hinweis stammt aus der Originalbeschreibung von axe-core.
        </p>
      )}

      <details className="no-print mt-4 rounded-lg border border-navy-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary-700 underline-offset-2 hover:underline">
          Betroffene Elemente anzeigen ({issue.nodes.length}
          {issue.nodeCount > issue.nodes.length ? ` von ${issue.nodeCount}` : ""})
        </summary>
        <ul className="divide-y divide-navy-100 border-t border-navy-200">
          {issue.nodes.map((n, i) => (
            <li key={i} className="space-y-1 px-3 py-3 text-sm">
              <p>
                <span className="font-semibold">Bereich:</span> {n.area}
              </p>
              <p className="break-words">
                <span className="font-semibold">Selektor:</span> <code className="rounded bg-navy-50 px-1 py-0.5 text-[0.85em]">{n.selector}</code>
              </p>
              {n.html && (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-navy-50 p-2 text-xs text-navy-800">
                  <code>{n.html}</code>
                </pre>
              )}
              {n.details && <p className="text-xs text-navy-600">Technische Details (axe-core, Englisch): {n.details}</p>}
            </li>
          ))}
        </ul>
        {issue.helpUrl && (
          <p className="border-t border-navy-200 px-3 py-2 text-sm">
            <a className="link" href={issue.helpUrl} target="_blank" rel="noopener noreferrer">
              Regelbeschreibung bei Deque (Englisch)<span className="sr-only"> – öffnet in neuem Tab</span>
            </a>
          </p>
        )}
      </details>

      <div className="no-print mt-4 border-t border-navy-100 pt-4">
        <StatusSelect id={`${uid}-s`} issueTitle={issue.title} value={status} onChange={onStatusChange} />
      </div>
    </article>
  );
}
