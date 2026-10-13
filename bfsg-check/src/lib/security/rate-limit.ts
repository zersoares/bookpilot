/**
 * Einfacher In-Memory-Sliding-Window-Limiter.
 * Zustand liegt nur im Arbeitsspeicher der Instanz (nichts wird persistiert).
 * Bei mehreren Instanzen gilt das Limit je Instanz – für strenge Limits
 * ein gemeinsames Limit am Reverse-Proxy/CDN ergänzen (siehe README).
 */
export interface LimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string): LimitDecision {
    const now = this.now();
    this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.max) {
      const oldest = recent[0] ?? now;
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }

    // Speicher begrenzen: bei zu vielen Schlüsseln den ältesten verwerfen.
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.max - recent.length, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Begrenzt gleichzeitige Scans (Chromium ist speicherhungrig). */
export class ConcurrencyGate {
  private active = 0;
  constructor(private readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
