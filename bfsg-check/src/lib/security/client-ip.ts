/**
 * Ermittelt den Schlüssel für das Rate-Limiting.
 *
 * X-Forwarded-For ist vom Client fälschbar. Wir vertrauen ihm nur, wenn der
 * Betreiber das ausdrücklich bestätigt (BFSG_TRUST_PROXY=1) – dann gilt der
 * RECHTESTE Eintrag, den der eigene Proxy angehängt hat. Ohne Vertrauen gibt
 * es nur einen gemeinsamen Bucket: lieber zu streng als umgehbar.
 */
export function rateLimitKey(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (env.BFSG_TRUST_PROXY === "1") {
    const xff = headers.get("x-forwarded-for");
    const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return `ip:${last.slice(0, 64)}`;
    const real = headers.get("x-real-ip")?.trim();
    if (real) return `ip:${real.slice(0, 64)}`;
  }
  return "shared";
}
