/**
 * Schützt die API vor Aufrufen von fremden Webseiten (CSRF/Missbrauch als Scan-Proxy).
 * Browser senden bei POST immer einen Origin-Header; fehlt er (z. B. curl), lassen
 * wir die Anfrage zu – dagegen schützen Rate-Limit und Zielprüfung.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  return !!host && host.toLowerCase() === originHost.toLowerCase();
}
