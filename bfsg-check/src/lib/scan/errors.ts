import type { ScanErrorBody, ScanErrorCode } from "./types";

/** Nutzerverständliche Standardtexte. Enthalten nie interne Details. */
export const ERROR_MESSAGES: Record<ScanErrorCode, string> = {
  INVALID_URL: "Das ist keine gültige Web-Adresse.",
  BLOCKED_TARGET: "Diese Adresse kann aus Sicherheitsgründen nicht geprüft werden. Bitte geben Sie eine öffentlich erreichbare Website an.",
  RATE_LIMITED: "Es wurden zu viele Prüfungen in kurzer Zeit gestartet. Bitte versuchen Sie es später erneut.",
  BUSY: "Der Scanner ist gerade ausgelastet. Bitte versuchen Sie es in einer Minute erneut.",
  SCANNER_UNAVAILABLE:
    "Der automatische Scanner ist in dieser Umgebung nicht verfügbar (Browser konnte nicht gestartet werden). Es werden bewusst keine Ersatzergebnisse angezeigt.",
  NAVIGATION_FAILED: "Die Seite konnte nicht geladen werden. Prüfen Sie, ob die Adresse korrekt und öffentlich erreichbar ist.",
  HTTP_ERROR: "Die Seite hat mit einem Fehlerstatus geantwortet und kann so nicht geprüft werden.",
  NOT_HTML: "Unter dieser Adresse liegt keine HTML-Seite (z. B. ein Dokument oder Bild). Geprüft werden können nur Webseiten.",
  TIMEOUT: "Die Prüfung hat zu lange gedauert und wurde abgebrochen. Die Seite lädt möglicherweise sehr langsam oder blockiert automatisierte Zugriffe.",
  TOO_LARGE: "Die Seite ist für die automatische Prüfung zu groß und wurde abgebrochen.",
  BAD_REQUEST: "Die Anfrage war ungültig.",
  INTERNAL: "Beim Scan ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es später erneut.",
};

export const ERROR_STATUS: Record<ScanErrorCode, number> = {
  INVALID_URL: 400,
  BLOCKED_TARGET: 400,
  BAD_REQUEST: 400,
  RATE_LIMITED: 429,
  BUSY: 503,
  SCANNER_UNAVAILABLE: 503,
  NAVIGATION_FAILED: 502,
  HTTP_ERROR: 502,
  NOT_HTML: 422,
  TIMEOUT: 504,
  TOO_LARGE: 413,
  INTERNAL: 500,
};

export class ScanError extends Error {
  constructor(
    readonly code: ScanErrorCode,
    message?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "ScanError";
  }

  toBody(): ScanErrorBody {
    return { code: this.code, message: this.message, ...(this.retryAfterSeconds ? { retryAfterSeconds: this.retryAfterSeconds } : {}) };
  }
}
