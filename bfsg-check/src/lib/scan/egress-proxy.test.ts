import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startEgressProxy, type EgressProxy } from "./egress-proxy";

let proxy: EgressProxy | undefined;
let origin: http.Server | undefined;
afterEach(async () => {
  await proxy?.close();
  origin?.close();
  proxy = origin = undefined;
});

async function startOrigin(): Promise<number> {
  origin = http.createServer((_, res) => res.writeHead(200, { "content-type": "text/plain" }).end("ok"));
  await new Promise<void>((r) => origin!.listen(0, "127.0.0.1", r));
  return (origin.address() as AddressInfo).port;
}

function viaProxy(port: number, targetUrl: string): Promise<{ status: number; blocked: boolean; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const req = http.request({ host: "127.0.0.1", port: proxy!.port, method: "GET", path: targetUrl, headers: { host: url.host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, blocked: !!res.headers["x-bfsg-blocked"], body }));
    });
    req.on("error", reject);
    req.end();
    void port;
  });
}

describe("Egress-Proxy", () => {
  it("leitet erlaubte Ziele durch und zählt Bytes", async () => {
    const port = await startOrigin();
    proxy = await startEgressProxy({ resolve: async () => ["127.0.0.1"], allowedPorts: new Set([port]), maxBytes: 1_000_000 });
    const res = await viaProxy(port, `http://erlaubt.example:${port}/`);
    expect(res).toMatchObject({ status: 200, body: "ok", blocked: false });
    expect(proxy.stats.bytes).toBeGreaterThan(0);
  });

  it("lehnt Ziele ab, deren Auflösung der Guard verweigert – ohne den Origin zu kontaktieren", async () => {
    let hits = 0;
    const port = await startOrigin();
    origin!.on("request", () => hits++);
    proxy = await startEgressProxy({
      resolve: async () => {
        throw new Error("privat");
      },
      allowedPorts: new Set([port]),
      maxBytes: 1_000_000,
    });
    const res = await viaProxy(port, `http://intern.example:${port}/`);
    expect(res).toMatchObject({ status: 403, blocked: true });
    expect(proxy.stats.denied).toBe(1);
    expect(hits).toBe(0);
  });

  it("lehnt nicht erlaubte Ports ab", async () => {
    const port = await startOrigin();
    proxy = await startEgressProxy({ resolve: async () => ["127.0.0.1"], allowedPorts: new Set([443]), maxBytes: 1_000_000 });
    expect((await viaProxy(port, `http://x.example:${port}/`)).status).toBe(403);
  });

  it("verbindet nur mit den geprüften Adressen (DNS-Pinning)", async () => {
    const port = await startOrigin();
    // Guard gibt 127.0.0.1 zurück; der Hostname würde sonst nicht auflösbar sein.
    proxy = await startEgressProxy({ resolve: async () => ["127.0.0.1"], allowedPorts: new Set([port]), maxBytes: 1_000_000 });
    expect((await viaProxy(port, `http://gibt-es-nicht.invalid:${port}/`)).status).toBe(200);
  });

  it("verweigert CONNECT-Tunnel zu blockierten Zielen", async () => {
    proxy = await startEgressProxy({
      resolve: async () => {
        throw new Error("privat");
      },
      allowedPorts: new Set([443]),
      maxBytes: 1_000_000,
    });
    const answer = await new Promise<string>((resolve) => {
      const s = net.connect(proxy!.port, "127.0.0.1", () => s.write("CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: 169.254.169.254:443\r\n\r\n"));
      let data = "";
      s.on("data", (c) => (data += c));
      s.on("close", () => resolve(data));
    });
    expect(answer).toMatch(/^HTTP\/1\.1 403/);
    expect(proxy.stats.denied).toBe(1);
  });

  it("ruft onLimit auf, wenn das Datenlimit überschritten wird", async () => {
    const port = await startOrigin();
    let limited = false;
    proxy = await startEgressProxy({ resolve: async () => ["127.0.0.1"], allowedPorts: new Set([port]), maxBytes: 1, onLimit: () => (limited = true) });
    await viaProxy(port, `http://x.example:${port}/`).catch(() => undefined);
    expect(limited).toBe(true);
    expect(proxy.stats.tooLarge).toBe(true);
  });
});
