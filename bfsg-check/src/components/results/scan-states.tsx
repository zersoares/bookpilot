"use client";
import { useEffect, useState } from "react";
import type { ScanErrorBody, ScanErrorCode } from "@/lib/scan/types";
import { Alert } from "../ui/alert";
import { Button, ButtonLink } from "../ui/button";
import { Card } from "../ui/card";
import { Spinner } from "../ui/spinner";

export function ScanLoading({ onCancel, url }: { onCancel: () => void; url: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card aria-busy="true">
      <div className="flex items-start gap-4">
        <Spinner className="mt-1 !h-7 !w-7" />
        <div className="min-w-0 flex-1">
          <p role="status" className="text-lg font-semibold">
            Die Seite wird geprüft …
          </p>
          <p className="mt-1 break-all text-sm text-navy-600">{url}</p>
          <p className="mt-3 max-w-prose text-navy-700">
            Unser Server lädt die Seite in einem Browser, wartet auf nachladende Inhalte und führt dann die Prüfregeln aus. Das dauert meist 10 bis 40 Sekunden. Bitte lassen Sie dieses Fenster geöffnet.
          </p>
          <p className="mt-2 text-sm text-navy-600" aria-hidden="true">
            Läuft seit {seconds} s
          </p>
          <Button variant="secondary" className="mt-4" onClick={onCancel}>
            Prüfung abbrechen
          </Button>
        </div>
      </div>
      <div className="mt-6 space-y-3" aria-hidden="true">
        {[70, 90, 55].map((w, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-navy-100" style={{ width: `${w}%` }} />
        ))}
      </div>
    </Card>
  );
}

const TITLES: Partial<Record<ScanErrorCode, string>> = {
  SCANNER_UNAVAILABLE: "Der Scanner ist hier nicht verfügbar",
  RATE_LIMITED: "Zu viele Prüfungen",
  BUSY: "Der Scanner ist ausgelastet",
  TIMEOUT: "Zeitüberschreitung",
  TOO_LARGE: "Seite zu groß",
  BLOCKED_TARGET: "Adresse kann nicht geprüft werden",
  INVALID_URL: "Ungültige Adresse",
  HTTP_ERROR: "Die Seite meldet einen Fehler",
  NOT_HTML: "Keine HTML-Seite",
  NAVIGATION_FAILED: "Seite nicht erreichbar",
};

const CLIENT_ERRORS: Record<string, ScanErrorBody> = {
  network: { code: "INTERNAL", message: "Der Scan-Dienst ist nicht erreichbar. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut." },
  timeout: { code: "TIMEOUT", message: "Der Scan-Dienst hat nicht rechtzeitig geantwortet. Bitte versuchen Sie es erneut." },
};
export const clientError = (kind: keyof typeof CLIENT_ERRORS): ScanErrorBody => CLIENT_ERRORS[kind]!;

export function ScanFailure({ error, onRetry, onDemo }: { error: ScanErrorBody; onRetry: () => void; onDemo?: () => void }) {
  const retryable = !["INVALID_URL", "BLOCKED_TARGET", "NOT_HTML", "TOO_LARGE"].includes(error.code);
  return (
    <div className="space-y-4">
      <Alert tone="error" title={TITLES[error.code] ?? "Der Scan konnte nicht durchgeführt werden"} role="alert" headingLevel={3}>
        <p>{error.message}</p>
        {error.retryAfterSeconds && <p className="mt-1">Bitte warten Sie etwa {Math.ceil(error.retryAfterSeconds / 60)} Minute(n).</p>}
        <p className="mt-2 font-medium">Es werden keine Ersatz- oder Beispielergebnisse als Scan ausgegeben.</p>
      </Alert>
      {error.code === "SCANNER_UNAVAILABLE" && (
        <p className="max-w-prose text-sm text-navy-700">
          Hinweis für Betreiber: Der Scanner benötigt einen installierten Chromium-Browser (siehe README, Abschnitt „Deployment“). Auf reinen Serverless-Plattformen ohne Browser ist kein echter Scan möglich.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {retryable && <Button onClick={onRetry}>Erneut versuchen</Button>}
        <ButtonLink href="/check" variant="secondary">
          Eingaben ändern
        </ButtonLink>
        {onDemo && (
          <Button variant="ghost" onClick={onDemo}>
            Demo-Daten laden (nur Entwicklung)
          </Button>
        )}
      </div>
    </div>
  );
}
