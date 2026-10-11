import { SEVERITY_LABELS, type Severity } from "@/lib/scan/types";

const styles: Record<Severity, { box: string; bars: number }> = {
  critical: { box: "border-red-300 bg-red-50 text-red-900", bars: 4 },
  high: { box: "border-orange-300 bg-orange-50 text-orange-900", bars: 3 },
  medium: { box: "border-yellow-300 bg-yellow-50 text-yellow-900", bars: 2 },
  low: { box: "border-green-300 bg-green-50 text-green-900", bars: 1 },
};

/** Schweregrad als Text + Balken-Symbol (nie nur Farbe). */
export function SeverityBadge({ severity, className = "" }: { severity: Severity; className?: string }) {
  const s = styles[severity];
  return (
    <span className={`print-colors inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${s.box} ${className}`}>
      <span aria-hidden="true" className="flex items-end gap-px">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`w-[3px] rounded-sm bg-current ${n <= s.bars ? "opacity-100" : "opacity-25"}`} style={{ height: 4 + n * 2 }} />
        ))}
      </span>
      <span className="sr-only">Schweregrad: </span>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "blue" }) {
  return (
    <span
      className={`print-colors inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium ${
        tone === "blue" ? "border-primary-100 bg-primary-50 text-primary-800" : "border-navy-200 bg-navy-50 text-navy-800"
      }`}
    >
      {children}
    </span>
  );
}
