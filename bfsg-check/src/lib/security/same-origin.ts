/**
 * Schützt die API vor Aufrufen von fremden Webseiten (CSRF/Missbrauch als Scan-Proxy).
 * Browser senden bei POST immer einen Origin-Header; fehlt er (z. B. curl), lassen
 * wir die Anfrage zu – dagegen schützen Rate-Limit und Zielprüfung.
 *
 * Hinter einem Reverse-Proxy (z. B. Netlify-Rewrite auf Cloud Run) stimmt der
 * Host-Header oft nicht mit der öffentlichen Domain überein. Dann die erlaubten
 * Herkünfte explizit angeben: BFSG_ALLOWED_ORIGINS="https://gdprgard.eu".
 */
export function isSameOrigin(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const allowed = (env.BFSG_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
  if (allowed.includes(parsed.origin.toLowerCase())) return true;

  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  return !!host && host.toLowerCase() === parsed.host.toLowerCase();
}
