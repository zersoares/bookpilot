import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan/browser-scan";
import { ERROR_STATUS, ScanError } from "@/lib/scan/errors";
import type { ScanResponse } from "@/lib/scan/types";
import { rateLimitKey } from "@/lib/security/client-ip";
import { LIMITS } from "@/lib/security/limits";
import { ConcurrencyGate, SlidingWindowLimiter } from "@/lib/security/rate-limit";
import { isSameOrigin } from "@/lib/security/same-origin";
import { assertPublicTarget, BlockedTargetError, parseScanTarget } from "@/lib/url/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Singletons überleben Hot-Reload; Zustand liegt nur im Arbeitsspeicher.
const g = globalThis as unknown as { __bfsgLimiter?: SlidingWindowLimiter; __bfsgGate?: ConcurrencyGate };
const limiter = (g.__bfsgLimiter ??= new SlidingWindowLimiter(LIMITS.rateMax(), LIMITS.rateWindowMs()));
const gate = (g.__bfsgGate ??= new ConcurrencyGate(LIMITS.maxConcurrent()));

function fail(code: ScanError["code"], status?: number, message?: string, retryAfterSeconds?: number): NextResponse<ScanResponse> {
  const error = new ScanError(code, message, retryAfterSeconds);
  const res = NextResponse.json<ScanResponse>({ ok: false, error: error.toBody() }, { status: status ?? ERROR_STATUS[code] });
  if (retryAfterSeconds) res.headers.set("Retry-After", String(retryAfterSeconds));
  return res;
}

export async function POST(request: Request): Promise<NextResponse<ScanResponse>> {
  if (!isSameOrigin(request.headers)) return fail("BAD_REQUEST", 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("BAD_REQUEST", 415);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > LIMITS.maxBodyBytes) return fail("BAD_REQUEST", 413);
    body = JSON.parse(text);
  } catch {
    return fail("BAD_REQUEST");
  }
  const rawUrl = typeof body === "object" && body !== null ? (body as { url?: unknown }).url : undefined;

  // Zuerst billige Prüfungen (Syntax), dann Rate-Limit, dann DNS und Browser.
  const syntax = parseScanTarget(rawUrl);
  if (!syntax.ok) return fail("INVALID_URL", 400, syntax.message);

  const decision = limiter.check(rateLimitKey(request.headers));
  if (!decision.allowed) return fail("RATE_LIMITED", 429, undefined, decision.retryAfterSeconds);

  try {
    await assertPublicTarget(rawUrl);
  } catch (error) {
    return fail("BLOCKED_TARGET", 400, error instanceof BlockedTargetError ? error.message : undefined);
  }

  const release = gate.tryAcquire();
  if (!release) return fail("BUSY");

  try {
    const result = await runScan(syntax.normalized);
    return NextResponse.json<ScanResponse>({ ok: true, result });
  } catch (error) {
    if (error instanceof ScanError) {
      console.error(`[scan] fehlgeschlagen: ${error.code}`); // bewusst ohne URL
      return fail(error.code, undefined, error.message);
    }
    console.error("[scan] unerwarteter Fehler");
    return fail("INTERNAL");
  } finally {
    release();
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } });
}
