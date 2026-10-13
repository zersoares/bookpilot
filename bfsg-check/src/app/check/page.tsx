import type { Metadata } from "next";
import Link from "next/link";
import { ScopeQuestionnaire } from "@/components/scope-questionnaire";

export const metadata: Metadata = {
  title: "Kostenloser Check – Fragen zum Anwendungsbereich",
  description: "Fünf kurze Fragen zur ersten Einordnung, ob Ihr Angebot unter das BFSG fallen könnte – danach startet der automatische Scan.",
};

export default function CheckPage() {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Brotkrumen" className="text-sm text-navy-600">
          <ol className="flex flex-wrap gap-2">
            <li><Link className="link" href="/">Start</Link></li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">Check</li>
          </ol>
        </nav>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-primary-700">Schritt 1 von 3 · Anwendungsbereich</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Fällt Ihr Angebot wahrscheinlich unter das BFSG?</h1>
        <div className="mt-8">
          <ScopeQuestionnaire />
        </div>
      </div>
    </div>
  );
}
