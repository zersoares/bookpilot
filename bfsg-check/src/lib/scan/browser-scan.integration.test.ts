/**
 * Integrationstest mit echtem Chromium und lokalen Test-Servern.
 * Läuft nur, wenn BFSG_INTEGRATION=1 und CHROMIUM_EXECUTABLE_PATH gesetzt sind:
 *   BFSG_INTEGRATION=1 CHROMIUM_EXECUTABLE_PATH=/pfad/zu/chrome BFSG_CHROMIUM_NO_SANDBOX=1 npm test
 * 127.0.0.1 gilt hier als „öffentlich“, 127.0.0.2 als blockiert (Test-Hostguard).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runScan } from "./browser-scan";
import { ScanError } from "./errors";

const enabled = process.env.BFSG_INTEGRATION === "1" && !!process.env.CHROMIUM_EXECUTABLE_PATH;
/** 127.0.0.1 gilt hier als „öffentlich“, alles andere (u. a. 127.0.0.2) als blockiert. */
const resolveHost = async (host: string): Promise<string[]> => {
  if (host !== "127.0.0.1") throw new Error("blocked");
  return [host];
};
// Testserver laufen auf zufälligen Ports.
const opts = { resolveHost, allowedPorts: { has: () => true } as unknown as ReadonlySet<number> };

const BAD_PAGE = `<!doctype html><html><head><title>Testseite</title></head><body>
<header><button class="cart"><svg width="10" height="10"></svg></button></header>
<main><h1>Test</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<p style="color:#bbb;background:#fff">Hellgrauer Text mit zu wenig Kontrast</p>
<form><input type="text" id="x"></form></main></body></html>`;

let server: http.Server;
let base: string;
const hits = { blockedTarget: 0 };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/bad") return void res.writeHead(200, { "content-type": "text/html" }).end(BAD_PAGE);
    if (path === "/good")
      return void res
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html><html lang="de"><head><title>Gut</title></head><body><main><h1>Hallo</h1><p>Text</p></main></body></html>`);
    if (path === "/redirect-internal") return void res.writeHead(302, { location: `http://127.0.0.2:${(server.address() as AddressInfo).port}/secret` }).end();
    if (path === "/secret") {
      hits.blockedTarget += 1;
      return void res.writeHead(200, { "content-type": "text/html" }).end("<html><body>secret</body></html>");
    }
    if (path === "/js-redirect") return void res.writeHead(200, { "content-type": "text/html" }).end(`<html lang="de"><head><title>x</title></head><body><script>location.href="file:///etc/passwd"</script></body></html>`);
    if (path === "/pdf") return void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
    if (path === "/missing") return void res.writeHead(404, { "content-type": "text/html" }).end("nope");
    if (path === "/slow") return void setTimeout(() => res.writeHead(200, { "content-type": "text/html" }).end("<html></html>"), 60_000);
    if (path === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html lang=de><body>");
      const chunk = "x".repeat(1024 * 1024);
      let n = 0;
      const timer = setInterval(() => {
        if (res.destroyed || n++ > 60) {
          clearInterval(timer);
          return void res.end();
        }
        res.write(chunk);
      }, 5);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  vi.unstubAllEnvs();
  server?.close();
});

describe.skipIf(!enabled)("runScan (echtes Chromium)", () => {
  it("findet echte Verstöße und erfindet keine", async () => {
    const result = await runScan(`${base}/bad`, opts);
    const ids = result.issues.filter((i) => i.kind === "violation").map((i) => i.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["button-name", "image-alt", "color-contrast", "label", "html-has-lang"]));
    expect(result.isDemo).toBe(false);
    expect(result.engine.version).toMatch(/^\d+\.\d+/);
    const cart = result.issues.find((i) => i.ruleId === "button-name");
    expect(cart?.severity).toBe("critical");
    expect(cart?.nodes[0]?.area).toBe("Kopfbereich");
    expect(cart?.wcag[0]?.criterion).toBe("4.1.2");
    expect(result.counts.passedRules).toBeGreaterThan(5);
    expect(result.pageTitle).toBe("Testseite");
  }, 60_000);

  it("meldet bei einer sauberen Seite keine Verstöße", async () => {
    const result = await runScan(`${base}/good`, opts);
    expect(result.issues.filter((i) => i.kind === "violation")).toEqual([]);
  }, 60_000);

  it("blockiert Weiterleitungen auf interne Adressen und ruft sie nie ab", async () => {
    await expect(runScan(`${base}/redirect-internal`, opts)).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
    expect(hits.blockedTarget).toBe(0);
  }, 60_000);

  it("blockiert file:-Navigation per JavaScript", async () => {
    const result = await runScan(`${base}/js-redirect`, opts).catch((e) => e);
    // Entweder wird der Scan abgebrochen oder die Seite bleibt unverändert – nie wird file: geladen.
    if (result instanceof ScanError) expect(["BLOCKED_TARGET", "NAVIGATION_FAILED"]).toContain(result.code);
    else expect(result.finalUrl.startsWith("http://127.0.0.1")).toBe(true);
  }, 60_000);

  it("weist Nicht-HTML und Fehlerstatus ab", async () => {
    await expect(runScan(`${base}/pdf`, opts)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_HTML|NAVIGATION_FAILED/) });
    await expect(runScan(`${base}/missing`, opts)).rejects.toMatchObject({ code: "HTTP_ERROR" });
  }, 60_000);

  it("bricht zu große Seiten ab", async () => {
    vi.stubEnv("BFSG_MAX_PAGE_MB", "3");
    await expect(runScan(`${base}/huge`, opts)).rejects.toMatchObject({ code: "TOO_LARGE" });
  }, 60_000);

  it("verweigert nicht öffentliche Start-Hosts", async () => {
    await expect(runScan(`http://127.0.0.2:1/`, opts)).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
  });
});
