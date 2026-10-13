import type { ScopeResult as Result } from "@/lib/scope/evaluate";
import type { ScopeOutcome } from "@/lib/scope/rules";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";
import { Card } from "./ui/card";

const tones: Record<ScopeOutcome, { box: string; icon: React.ReactNode }> = {
  likely: { box: "border-primary-700 bg-primary-50", icon: <InfoIcon className="text-primary-700" width={28} height={28} /> },
  possible: { box: "border-yellow-400 bg-yellow-50", icon: <AlertIcon className="text-yellow-800" width={28} height={28} /> },
  exempt: { box: "border-green-400 bg-green-50", icon: <CheckIcon className="text-green-800" width={28} height={28} /> },
  undetermined: { box: "border-navy-300 bg-navy-50", icon: <InfoIcon className="text-navy-600" width={28} height={28} /> },
};

export function ScopeResultCard({ result, headingLevel = 2, compact = false }: { result: Result; headingLevel?: 2 | 3; compact?: boolean }) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  return (
    <Card className={`print-colors border-2 ${tones[result.outcome].box}`}>
      <div className="flex items-start gap-4">
        <span className="mt-1 shrink-0">{tones[result.outcome].icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-navy-600">Einschätzung zum Anwendungsbereich</p>
          <Heading className="mt-1 text-2xl">{result.label}</Heading>
          <div className="mt-3 space-y-3 text-navy-800">
            {result.reasons.map((r, i) => (
              <p key={i}>{r}</p>
            ))}
          </div>
          {!compact && (
            <>
              <h3 className="mt-5 text-base font-semibold">Empfohlene nächste Schritte</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-navy-800">
                {result.nextSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium text-primary-700 underline underline-offset-2">Ihre Angaben im Überblick</summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              {result.factors.map((f) => (
                <div key={f.question} className="contents">
                  <dt className="text-navy-600">{f.question}</dt>
                  <dd className="font-medium">{f.answer}</dd>
                </div>
              ))}
            </dl>
          </details>
          <p className="mt-5 border-t border-navy-200 pt-4 text-sm text-navy-700">{result.disclaimer}</p>
          <p className="mt-2 text-xs text-navy-600">
            Regelstand: Version {result.rulesVersion}, zuletzt überprüft am {new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date(result.rulesReviewedOn))}.
          </p>
        </div>
      </div>
    </Card>
  );
}
