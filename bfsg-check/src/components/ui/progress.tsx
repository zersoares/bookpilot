interface ProgressProps {
  value: number;
  max: number;
  label: string;
  /** Sichtbarer Text neben der Leiste, z. B. „3 von 12“ */
  valueText?: string;
  className?: string;
}

/** Native <progress> mit sichtbarer Beschriftung – kein erfundener Score, nur Bearbeitungsstand. */
export function Progress({ value, max, label, valueText, className = "" }: ProgressProps) {
  const id = `progress-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={id} className="font-medium text-navy-800">
          {label}
        </label>
        <span className="tabular-nums text-navy-600">{valueText ?? `${value} von ${max}`}</span>
      </div>
      <progress id={id} value={value} max={Math.max(max, 1)} className="progress-bar h-2.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary-700 [&::-webkit-progress-bar]:bg-navy-100 [&::-webkit-progress-value]:bg-primary-700">
        {valueText ?? `${value} von ${max}`}
      </progress>
    </div>
  );
}
