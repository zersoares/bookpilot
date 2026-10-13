import "server-only";
import axe from "axe-core";
import { chromium, type Browser, type Page } from "playwright-core";
import { LIMITS } from "../security/limits";
import { assertPublicTarget, BlockedTargetError, resolvePublicAddresses } from "../url/guard";
import { browserAreaClassifier } from "./area";
import { BLOCKED_HEADER, startEgressProxy, type EgressProxy } from "./egress-proxy";
import { ScanError } from "./errors";
import { AXE_TAGS, RULESET_LABEL } from "./ruleset";
import { normalizeAxeResults, selectorOf, type RawAxeResults } from "./normalize";
import type { ScanResult } from "./types";


const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);
const USER_AGENT = "Mozilla/5.0 (compatible; BFSG-Check/0.1; automatisierter Barrierefreiheits-Scan einer einzelnen Seite)";
const BLOCKED_REDIRECT_MESSAGE =
  "Die Seite verweist auf eine nicht prüfbare oder nicht öffentliche Adresse. Der Scan wurde aus Sicherheitsgründen abgebrochen.";

export interface ScanOptions {
  /** Testbarkeit: ersetzt die DNS-/IP-Prüfung. Muss die erlaubten Zieladressen liefern oder werfen. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** Testbarkeit: erlaubt abweichende Ports (nur zusammen mit resolveHost sinnvoll). */
  allowedPorts?: ReadonlySet<number>;
}

function launchArgs(proxyPort: number): string[] {
  const args = [
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    "--proxy-bypass-list=<-loopback>", // auch Loopback-Ziele über den Proxy leiten (und dort ablehnen)
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--mute-audio",
    "--disable-features=Translate,MediaRouter,NetworkPrediction",
    "--dns-prefetch-disable",
  ];
  if (process.env.BFSG_CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox");
  return args;
}

async function launchBrowser(proxy: EgressProxy): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: launchArgs(proxy.port),
      timeout: 15_000,
    });
  } catch (error) {
    console.error("[scan] Browser-Start fehlgeschlagen:", error instanceof Error ? error.message.split("\n")[0] : "unbekannt");
    throw new ScanError("SCANNER_UNAVAILABLE");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Führt einen Scan der übergebenen Seite durch. Es wird ausschließlich diese
 * eine Seite geladen; es werden keine Links verfolgt und nichts gespeichert.
 */
export async function runScan(input: string, options: ScanOptions = {}): Promise<ScanResult> {
  const resolveHost = options.resolveHost ?? ((host: string) => resolvePublicAddresses(host));

  let target: URL;
  try {
    if (options.resolveHost) {
      target = new URL(input);
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new BlockedTargetError("Nur http und https sind erlaubt.");
      await options.resolveHost(target.hostname);
    } else {
      target = await assertPublicTarget(input);
    }
  } catch (error) {
    if (error instanceof BlockedTargetError) throw new ScanError("BLOCKED_TARGET", error.message);
    if (options.resolveHost && !(error instanceof TypeError)) throw new ScanError("BLOCKED_TARGET");
    throw new ScanError("INVALID_URL");
  }

  let browser: Browser | undefined;
  const proxy = await startEgressProxy({
    resolve: resolveHost,
    allowedPorts: options.allowedPorts ?? ALLOWED_PORTS,
    maxBytes: LIMITS.maxTotalBytes(),
    onLimit: () => {
      void browser?.close().catch(() => undefined);
    },
  });

  let timedOut = false;
  const overall = setTimeout(() => {
    timedOut = true;
    browser?.close().catch(() => undefined);
    proxy.close().catch(() => undefined);
  }, LIMITS.totalTimeoutMs);

  try {
    browser = await launchBrowser(proxy);
    const context = await browser.newContext({
      viewport: { ...LIMITS.viewport },
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      userAgent: USER_AGENT,
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(LIMITS.navigationTimeoutMs);

    // Netzwerkgrenzen setzt der Proxy. Hier nur: keine anderen Schemata (file:, ftp:, …) und keine Medien.
    await context.route("**/*", (route) => {
      const request = route.request();
      const protocol = request.url().split(":", 1)[0]?.toLowerCase();
      if (protocol !== "http" && protocol !== "https" && protocol !== "data" && protocol !== "blob" && protocol !== "about") {
        return route.abort("blockedbyclient");
      }
      if (request.resourceType() === "media") return route.abort("blockedbyclient");
      return route.continue();
    });

    const fail = (): never => {
      if (timedOut) throw new ScanError("TIMEOUT");
      if (proxy.stats.tooLarge) throw new ScanError("TOO_LARGE");
      throw new ScanError("NAVIGATION_FAILED");
    };

    let response;
    try {
      response = await page.goto(target.toString(), { waitUntil: "load", timeout: LIMITS.navigationTimeoutMs });
    } catch (error) {
      if (timedOut) throw new ScanError("TIMEOUT");
      if (proxy.stats.tooLarge) throw new ScanError("TOO_LARGE");
      if (proxy.stats.denied > 0) throw new ScanError("BLOCKED_TARGET", BLOCKED_REDIRECT_MESSAGE);
      if (error instanceof Error && error.name === "TimeoutError") throw new ScanError("TIMEOUT");
      return fail();
    }
    if (proxy.stats.tooLarge) throw new ScanError("TOO_LARGE");
    if (!response) return fail();
    if (response.headers()[BLOCKED_HEADER]) throw new ScanError("BLOCKED_TARGET", BLOCKED_REDIRECT_MESSAGE);
    if (response.status() >= 400) throw new ScanError("HTTP_ERROR", `Die Seite hat mit HTTP-Status ${response.status()} geantwortet und kann so nicht geprüft werden.`);
    const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
    if (contentType && !/(text\/html|application\/xhtml\+xml)/.test(contentType)) throw new ScanError("NOT_HTML");

    // Nachladende Inhalte kurz abwarten (best effort).
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
    if (proxy.stats.tooLarge) throw new ScanError("TOO_LARGE");

    const finalUrl = page.url();
    const domCount = await page.evaluate(() => document.getElementsByTagName("*").length);
    if (domCount > LIMITS.maxDomElements) throw new ScanError("TOO_LARGE");

    // axe-core in alle Frames laden (evaluate umgeht die Content-Security-Policy der Zielseite).
    for (const frame of page.frames()) {
      await frame.evaluate(axe.source).catch(() => undefined);
    }
    const raw = await withTimeout(
      page.evaluate(
        async (opts) => {
          const w = window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<unknown> } };
          return await w.axe.run(document, opts);
        },
        {
          runOnly: { type: "tag", values: [...AXE_TAGS] },
          resultTypes: ["violations", "incomplete"],
          reporter: "v1",
        },
      ) as Promise<RawAxeResults>,
      LIMITS.axeTimeoutMs,
      () => new ScanError("TIMEOUT"),
    );

    const areaBySelector = await classifyAreas(page, raw);
    const pageTitle = (await page.title().catch(() => "")).slice(0, 200);
    const pageLang = await page.evaluate(() => document.documentElement.getAttribute("lang") ?? "").catch(() => "");

    return normalizeAxeResults(raw, {
      url: target.toString(),
      finalUrl,
      scannedAt: new Date().toISOString(),
      axeVersion: axe.version,
      ruleset: RULESET_LABEL,
      viewport: { ...LIMITS.viewport },
      pageTitle,
      pageLang: pageLang.slice(0, 20),
      isDemo: false,
      areaBySelector,
    });
  } catch (error) {
    if (error instanceof ScanError) throw error;
    if (timedOut) throw new ScanError("TIMEOUT");
    if (proxy.stats.tooLarge) throw new ScanError("TOO_LARGE");
    console.error("[scan] unerwarteter Fehler:", error instanceof Error ? error.name : "unbekannt");
    throw new ScanError("INTERNAL");
  } finally {
    clearTimeout(overall);
    await browser?.close().catch(() => undefined);
    await proxy.close().catch(() => undefined);
  }
}

/** Ordnet Selektoren des Hauptframes einem Seitenbereich zu (Kopf, Navigation, …). */
async function classifyAreas(page: Page, raw: RawAxeResults): Promise<Map<string, string>> {
  const selectors = new Map<string, string | null>();
  for (const rule of [...raw.violations, ...raw.incomplete]) {
    for (const node of rule.nodes) {
      // Nur Knoten im Hauptframe mit einfachem Selektor (kein Frame-/Shadow-Pfad).
      const single = node.target.length === 1 && typeof node.target[0] === "string" ? node.target[0] : null;
      selectors.set(selectorOf(node.target), single);
    }
  }
  const keys = [...selectors.keys()];
  if (keys.length === 0) return new Map();
  try {
    const areas = await page.evaluate(browserAreaClassifier, keys.map((k) => selectors.get(k) ?? null));
    return new Map(keys.map((k, i) => [k, areas[i] ?? "unknown"]));
  } catch {
    return new Map();
  }
}
