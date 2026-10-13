"use client";
import { ISSUE_STATUSES, STATUS_LABELS, type IssueStatus } from "@/lib/scan/types";

export function StatusSelect({ id, issueTitle, value, onChange }: { id: string; issueTitle: string; value: IssueStatus; onChange: (v: IssueStatus) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-navy-800">
        Status<span className="sr-only"> für „{issueTitle}“</span>
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as IssueStatus)}
        className="min-h-[44px] rounded-lg border border-navy-500 bg-white px-3 py-2 text-base text-navy-900"
      >
        {ISSUE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
