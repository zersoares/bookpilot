"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPlan } from "@/lib/scan/plan";
import type { Issue, IssueStatus, ScanErrorBody, ScanResponse } from "@/lib/scan/types";
import { updateSession, useCheckSession } from "@/lib/session";
import { ArrowRightIcon, PrinterIcon } from "../icons";
import { ScopeResultCard } from "../scope-result";
import { Button, ButtonLink } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Alert } from "../ui/alert";
import { ScanSummary } from "./dashboard";
import { DemoBanner } from "./demo-banner";
import { RemediationPlanView } from "./remediation-plan";
import { clientError, ScanFailure, ScanLoading } from "./scan-states";
import { StatementDraftSection } from "./statement-draft";

type Phase = "idle" | "loading" | "error";
const CLIENT_TIMEOUT_MS = 100_000;

/** Nur in der Entwicklung vorhanden – in Produktion wird dieser Zweig vom Bundler entfernt. */
const DEMO_AVAILABLE = process.env.NODE_ENV !== "production";

function SectionHeading({ id, step, title, children }: { id: string; step: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">{step}</p>
      <h2 id={id} className="mt-1 text-2xl sm:text-3xl">
        {title}
      </h2>
      {children && <p className="mt-2 max-w-prose text-navy-700">{children}</p>}
    </div>
  );
}

export function ResultsView() {
  const { session, hydrated } = useCheckSession();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ScanErrorBody | null>(null);
  const controller = useRef<AbortController | null>(null);
  const startedFor = useRef<string | null>(null);
  const cancelled = useRef(false);

  const { url, answers, scan, scope } = session;
  const plan = useMemo(() => (scan ? buildPlan(scan) : null), [scan]);

  const runScan = useCallback(async (target: string) => {
    cancelled.current = false;
    setPhase("loading");
    setError(null);
    const ctl = new AbortController();
    controller.current = ctl;
    const timer = setTimeout(() => ctl.abort("timeout"), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
        signal: ctl.signal,
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as ScanResponse | null;
      if (!body) throw new Error("bad-response");
      if (body.ok) {
        updateSession({ scan: body.result, statuses: {} });
        setPhase("idle");
      } else {
        setError(body.error);
        setPhase("error");
      }
    } catch (e) {
      if (cancelled.current) {
        setPhase("idle");
        return;
      }
      setError(clientError(ctl.signal.aborted ? "timeout" : "network"));
      setPhase("error");
      void e;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Scan genau einmal automatisch starten, wenn Angaben vorliegen.
  useEffect(() => {
    if (!hydrated || !url || !answers || scan) return;
    if (startedFor.current === url) return;
    startedFor.current = url;
    void runScan(url);
  }, [hydrated, url, answers, scan, runScan]);

  function cancel() {
    cancelled.current = true;
    controller.current?.abort();
  }

  const loadDemo = DEMO_AVAILABLE
    ? async () => {
        const { buildDemoScan } = await import("@/lib/demo/demo-scan");
        updateSession({ scan: buildDemoScan(), statuses: {} });
        setPhase("idle");
        setError(null);
      }
    : undefined;

  const setStatus = (issue: Issue, status: IssueStatus) => updateSession((c) => ({ statuses: { ...c.statuses, [issue.id]: status } }));

  if (!hydrated) {
    return (
      <div className="container-page py-14" role="status">
        <p className="text-navy-600">Ergebnisse werden geladen …</p>
      </div>
    );
  }

  if (!url || !answers || !scope) {
    return (
      <div className="container-page py-14">
        <div className="mx-auto max-w-2xl">
          <EmptyState
            title="Noch kein Check gestartet"
            action={<ButtonLink href="/check">Kostenlosen Check starten</ButtonLink>}
          >
            Ergebnisse werden nur in diesem Browser-Tab gehalten und nicht auf dem Server gespeichert. Starten Sie einen neuen Check, um einen Bericht zu erhalten.
          </EmptyState>
        </div>
      </div>
    );
  }

  const shownUrl = scan?.url ?? url;
  const dateText = scan ? new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(scan.scannedAt)) : null;

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto max-w-4xl space-y-14">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">Schritt 2 von 3 · Ergebnisse</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">Ihr BFSG-Check</h1>
          <p className="mt-3 break-all text-lg text-navy-700">
            <span className="font-semibold">{shownUrl}</span>
            {dateText && <span className="block text-base text-navy-600">Gescannt am {dateText} Uhr</span>}
          </p>
          <div className="no-print mt-5 flex flex-wrap gap-3">
            {scan && (
              <ButtonLink href="/bericht">
                <PrinterIcon />
                Bericht ansehen und drucken
              </ButtonLink>
            )}
            <ButtonLink href="/check" variant="secondary">
              Neuen Check starten
            </ButtonLink>
          </div>
        </header>

        {scan?.isDemo && <DemoBanner />}

        <section aria-labelledby="scope-h">
          <SectionHeading id="scope-h" step="Anwendungsbereich" title="Gilt das BFSG für Ihr Angebot?" />
          <ScopeResultCard result={scope} headingLevel={3} />
        </section>

        <section aria-labelledby="scan-h">
          <SectionHeading id="scan-h" step="Automatischer Scan" title="Technische Befunde">
            Ergebnis der automatischen Prüfung der eingegebenen Seite mit axe-core. Nur real erkannte Befunde werden angezeigt.
          </SectionHeading>

          {phase === "loading" && <ScanLoading onCancel={cancel} url={url} />}
          {phase === "error" && error && <ScanFailure error={error} onRetry={() => void runScan(url)} onDemo={loadDemo} />}
          {phase === "idle" && !scan && (
            <EmptyState
              title="Die Prüfung wurde nicht ausgeführt"
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button onClick={() => void runScan(url)}>Scan starten</Button>
                  {loadDemo && (
                    <Button variant="ghost" onClick={loadDemo}>
                      Demo-Daten laden (nur Entwicklung)
                    </Button>
                  )}
                </div>
              }
            >
              Starten Sie den Scan erneut, um technische Befunde zu erhalten.
            </EmptyState>
          )}
          {scan && phase !== "loading" && (
            <div className="space-y-6">
              {scan.finalUrl !== scan.url && !scan.isDemo && (
                <Alert tone="info" role="status">
                  Die Adresse wurde weitergeleitet. Geprüft wurde: <span className="break-all font-medium">{scan.finalUrl}</span>
                </Alert>
              )}
              <ScanSummary scan={scan} statuses={session.statuses} />
              {scan.counts.violationRules === 0 && scan.counts.needsReviewRules === 0 && (
                <Alert tone="info" title="Keine automatisch erkennbaren Verstöße gemeldet">
                  Das ist <strong>kein</strong> Nachweis der Barrierefreiheit. Prüfen Sie die Seite zusätzlich manuell (siehe „Manuell testen“).
                </Alert>
              )}
            </div>
          )}
        </section>

        {scan && plan && (
          <>
            <section aria-labelledby="plan-h">
              <SectionHeading id="plan-h" step="Maßnahmenplan" title="Was Sie zuerst beheben sollten">
                Nach Dringlichkeit geordnet. Setzen Sie bei jedem Punkt den Status, um Ihren Fortschritt zu dokumentieren.
              </SectionHeading>
              <RemediationPlanView plan={plan} statuses={session.statuses} onStatusChange={setStatus} />
            </section>

            <section aria-labelledby="statement-h">
              <SectionHeading id="statement-h" step="Dokumentation" title="Entwurf einer Erklärung zur Barrierefreiheit" />
              <StatementDraftSection scan={scan} fields={session.statement} onChange={(statement) => updateSession({ statement })} />
            </section>

            <section aria-labelledby="next-h" className="no-print rounded-xl border border-primary-100 bg-primary-50 p-6">
              <h2 id="next-h" className="text-xl">
                Schritt 3: Bericht erstellen
              </h2>
              <p className="mt-2 max-w-prose text-navy-700">Der Bericht fasst Einschätzung, Befunde, Maßnahmenplan und Methodik zusammen. Sie können ihn drucken oder als PDF speichern.</p>
              <div className="mt-4">
                <ButtonLink href="/bericht">
                  Zum Bericht
                  <ArrowRightIcon />
                </ButtonLink>
              </div>
            </section>
          </>
        )}

        <p className="text-sm text-navy-600">
          Hinweis: Dieses Werkzeug liefert technische Hinweise, keine Rechtsberatung und keine Zertifizierung. Mehr dazu in der{" "}
          <Link className="link" href="/methodik">
            Methodik
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
