import type { Metadata } from "next";
import { ReportView } from "@/components/report/report-view";

export const metadata: Metadata = {
  title: "Bericht – drucken oder als PDF speichern",
  robots: { index: false, follow: false },
};

export default function ReportPage() {
  return <ReportView />;
}
