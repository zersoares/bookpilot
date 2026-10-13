import { describe, expect, it } from "vitest";
import { rateLimitKey } from "./client-ip";
import { ConcurrencyGate, SlidingWindowLimiter } from "./rate-limit";
import { isSameOrigin } from "./same-origin";

describe("SlidingWindowLimiter", () => {
  it("erlaubt bis zum Limit und blockiert danach mit Wartezeit", () => {
    let now = 1_000_000;
    const l = new SlidingWindowLimiter(3, 60_000, () => now);
    expect(l.check("a").allowed).toBe(true);
    expect(l.check("a").allowed).toBe(true);
    expect(l.check("a")).toMatchObject({ allowed: true, remaining: 0 });
    now += 10_000;
    const blocked = l.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });
  it("gibt nach Ablauf des Fensters wieder frei und trennt Schlüssel", () => {
    let now = 0;
    const l = new SlidingWindowLimiter(1, 1000, () => now);
    expect(l.check("a").allowed).toBe(true);
    expect(l.check("b").allowed).toBe(true);
    expect(l.check("a").allowed).toBe(false);
    now = 1001;
    expect(l.check("a").allowed).toBe(true);
  });
  it("begrenzt den Speicher", () => {
    const l = new SlidingWindowLimiter(1, 60_000, () => 0, 3);
    for (const k of ["a", "b", "c", "d", "e"]) l.check(k);
    expect((l as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(3);
  });
});

describe("ConcurrencyGate", () => {
  it("begrenzt parallele Scans und gibt Plätze frei (idempotent)", () => {
    const g = new ConcurrencyGate(2);
    const a = g.tryAcquire();
    const b = g.tryAcquire();
    expect(a && b).toBeTruthy();
    expect(g.tryAcquire()).toBeNull();
    a!();
    a!(); // doppeltes Freigeben darf keinen zusätzlichen Platz schaffen
    expect(g.tryAcquire()).toBeTruthy();
    expect(g.tryAcquire()).toBeNull();
  });
});

describe("rateLimitKey", () => {
  const h = (xff: string) => new Headers({ "x-forwarded-for": xff });
  it("ignoriert X-Forwarded-For ohne ausdrückliches Vertrauen (nicht fälschbar)", () => {
    expect(rateLimitKey(h("1.2.3.4"), {})).toBe("shared");
    expect(rateLimitKey(h("9.9.9.9"), {})).toBe("shared");
  });
  it("nimmt mit Vertrauen den letzten (vom eigenen Proxy angehängten) Eintrag", () => {
    expect(rateLimitKey(h("6.6.6.6, 1.2.3.4"), { BFSG_TRUST_PROXY: "1" })).toBe("ip:1.2.3.4");
  });
});

describe("isSameOrigin", () => {
  it("akzeptiert gleiche Herkunft und fehlenden Origin-Header", () => {
    expect(isSameOrigin(new Headers({ origin: "https://app.example", host: "app.example" }))).toBe(true);
    expect(isSameOrigin(new Headers({ host: "app.example" }))).toBe(true);
  });
  it("lehnt fremde Herkunft ab und beachtet x-forwarded-host", () => {
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", host: "app.example" }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "https://app.example", host: "internal:3000", "x-forwarded-host": "app.example" }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "null", host: "app.example" }))).toBe(false);
  });
});
