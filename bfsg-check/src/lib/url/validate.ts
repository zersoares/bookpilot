import { classifyIp } from "./ip";

export type UrlErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "INVALID"
  | "PROTOCOL"
  | "CREDENTIALS"
  | "PORT"
  | "HOST_BLOCKED"
  | "HOST_NOT_PUBLIC";

export type UrlValidation =
  | { ok: true; url: URL; normalized: string }
  | { ok: false; code: UrlErrorCode; message: string };

export const MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Hostnamen, die nie öffentlich sind (Suffix- bzw. Exakt-Treffer). */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".home.arpa",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
]);

const MESSAGES: Record<UrlErrorCode, string> = {
  EMPTY: "Bitte geben Sie die Adresse Ihrer Website ein.",
  TOO_LONG: "Die Adresse ist zu lang (maximal 2048 Zeichen).",
  INVALID: "Das ist keine gültige Web-Adresse. Beispiel: https://www.beispiel.de",
  PROTOCOL: "Es sind nur Adressen mit http:// oder https:// erlaubt.",
  CREDENTIALS: "Adressen mit Benutzername oder Passwort werden nicht unterstützt.",
  PORT: "Dieser Port wird nicht unterstützt. Erlaubt sind die Standard-Ports sowie 8080 und 8443.",
  HOST_BLOCKED: "Interne oder lokale Adressen können nicht geprüft werden. Bitte geben Sie eine öffentlich erreichbare Website an.",
  HOST_NOT_PUBLIC: "Diese Adresse verweist auf ein nicht öffentliches Netzwerk und kann nicht geprüft werden.",
};

function fail(code: UrlErrorCode): UrlValidation {
  return { ok: false, code, message: MESSAGES[code] };
}

export function urlErrorMessage(code: UrlErrorCode): string {
  return MESSAGES[code];
}

/** Prüft, ob ein (bereits kleingeschriebener, geparster) Hostname grundsätzlich scanbar ist. */
export function checkHostname(hostname: string): UrlValidation | null {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return fail("INVALID");

  const ip = classifyIp(host);
  if (ip === "non-public") return fail("HOST_NOT_PUBLIC");
  if (ip === "public") return null;

  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return fail("HOST_BLOCKED");
  // Einzelne Labels ("intranet", "router") sind nie öffentlich auflösbar.
  if (!host.includes(".")) return fail("HOST_BLOCKED");
  return null;
}

/**
 * Validiert und normalisiert eine Nutzereingabe.
 * Fehlt das Schema, wird https:// ergänzt. Läuft rein syntaktisch (ohne DNS);
 * die DNS-Prüfung erfolgt serverseitig in `assertPublicTarget`.
 */
export function validateScanUrl(input: unknown): UrlValidation {
  if (typeof input !== "string") return fail("INVALID");
  const raw = input.trim();
  if (!raw) return fail("EMPTY");
  if (raw.length > MAX_URL_LENGTH) return fail("TOO_LONG");
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return fail("INVALID");

  // Explizites Schema ("https://", "file://") oder bekannte Nicht-Web-Schemata ("javascript:").
  // "host:8080" ist KEIN Schema und bekommt https:// vorangestellt.
  const hasScheme =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|file|mailto|tel|ftp|blob|about|vbscript):/i.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("INVALID");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("PROTOCOL");
  if (url.username || url.password) return fail("CREDENTIALS");

  const hostCheck = checkHostname(url.hostname);
  if (hostCheck) return hostCheck;
  if (!ALLOWED_PORTS.has(url.port)) return fail("PORT");

  url.hash = ""; // Fragmente sind serverseitig irrelevant
  return { ok: true, url, normalized: url.toString() };
}
