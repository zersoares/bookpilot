"use client";
import { useState } from "react";
import type { ScanResult, StatementFields } from "@/lib/scan/types";
import { buildStatementDraft, splitPlaceholders, statementToText } from "@/lib/statement";
import { ClipboardIcon } from "../icons";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { TextField } from "../ui/field";

/** Lesbare Darstellung mit hervorgehobenen [Platzhaltern]. */
export function StatementPreview({ scan, fields, headingLevel = 4 }: { scan?: ScanResult; fields: StatementFields; headingLevel?: 3 | 4 }) {
  const Heading = `h${headingLevel}` as "h3" | "h4";
  const draft = buildStatementDraft(scan, fields);
  const Text = ({ children }: { children: string }) => (
    <>
      {splitPlaceholders(children).map((seg, i) =>
        seg.placeholder ? (
          <mark key={i} className="print-colors rounded bg-yellow-100 px-1 text-yellow-950">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
  return (
    <div className="space-y-5 text-navy-800">
      <p className="print-colors rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm font-semibold text-yellow-950">{draft.marker}</p>
      {draft.sections.map((s) => (
        <section key={s.heading} className="avoid-break">
          <Heading className="text-base font-semibold">{s.heading}</Heading>
          <div className="mt-1 space-y-2">
            {s.paragraphs.map((p, i) => (
              <p key={i}>
                <Text>{p}</Text>
              </p>
            ))}
            {s.items && (
              <ul className="list-disc space-y-1 pl-5">
                {s.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function StatementDraftSection({ scan, fields, onChange }: { scan?: ScanResult; fields: StatementFields; onChange: (f: StatementFields) => void }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(statementToText(buildStatementDraft(scan, fields)));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Entwurf – menschliche Prüfung erforderlich">
        Der Text ist bewusst vorsichtig formuliert und behauptet keine Konformität. Jede Aussage muss von einer verantwortlichen Person geprüft, ergänzt und – insbesondere zu Behörden, Fristen und Beschwerdewegen – rechtlich bewertet werden.
      </Alert>

      <Card>
        <h3 className="text-base font-semibold">Ihre Angaben (optional)</h3>
        <p className="mt-1 text-sm text-navy-600">Die Angaben bleiben in Ihrem Browser (Tab-Sitzung) und werden nicht gesendet.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <TextField id="st-org" label="Name der Organisation" value={fields.organisation} onChange={(e) => onChange({ ...fields, organisation: e.target.value })} autoComplete="organization" />
          <TextField id="st-addr" label="Kontaktanschrift" value={fields.address} onChange={(e) => onChange({ ...fields, address: e.target.value })} autoComplete="street-address" />
          <TextField id="st-fb" label="Feedback-Kanal" hint="z. B. E-Mail oder Formular" value={fields.feedback} onChange={(e) => onChange({ ...fields, feedback: e.target.value })} />
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Vorschau: Erklärung zur Barrierefreiheit (Entwurf)</h3>
          <Button variant="secondary" onClick={copy}>
            <ClipboardIcon />
            Text kopieren
          </Button>
        </div>
        <p role="status" className="mb-3 min-h-[1.25rem] text-sm text-navy-700">
          {copied === "ok" && "Der Entwurf wurde in die Zwischenablage kopiert."}
          {copied === "fail" && "Kopieren nicht möglich. Bitte markieren Sie den Text manuell."}
        </p>
        <StatementPreview scan={scan} fields={fields} />
      </Card>
    </div>
  );
}
