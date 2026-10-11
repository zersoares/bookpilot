function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? Math.floor(raw) : fallback;
}

export const LIMITS = {
  /** Scans pro Schlüssel im Fenster */
  rateMax: () => intFromEnv("BFSG_RATE_LIMIT_MAX", 5, 1, 1000),
  rateWindowMs: () => intFromEnv("BFSG_RATE_LIMIT_WINDOW_SECONDS", 600, 10, 86_400) * 1000,
  maxConcurrent: () => intFromEnv("BFSG_MAX_CONCURRENT_SCANS", 2, 1, 16),
  /** Größe des Request-Bodys */
  maxBodyBytes: 4096,
  /** Navigation (Seite laden) */
  navigationTimeoutMs: 25_000,
  /** axe-core-Lauf */
  axeTimeoutMs: 25_000,
  /** Gesamtdauer eines Scans, danach wird der Browser beendet */
  totalTimeoutMs: 60_000,
  /** Summe aller übertragenen Daten einer Prüfung (Netzwerk-Bytes, beide Richtungen) */
  maxTotalBytes: () => intFromEnv("BFSG_MAX_PAGE_MB", 25, 1, 500) * 1024 * 1024,
  /** Maximale Anzahl DOM-Elemente */
  maxDomElements: 60_000,
  viewport: { width: 1280, height: 800 },
} as const;
