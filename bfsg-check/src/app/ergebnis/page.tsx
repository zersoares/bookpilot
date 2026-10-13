import type { Metadata } from "next";
import { ResultsView } from "@/components/results/results-view";

export const metadata: Metadata = {
  title: "Ergebnisse – Einschätzung, Befunde und Maßnahmenplan",
  robots: { index: false, follow: false },
};

export default function ResultsPage() {
  return <ResultsView />;
}
