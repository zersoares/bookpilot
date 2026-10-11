import "server-only";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

/**
 * Lokaler Egress-Proxy, durch den Chromium ALLE Netzwerkanfragen eines Scans leitet.
 *
 * Warum ein Proxy? Prüfungen im Browser (route-Handler) sehen Weiterleitungen
 * nicht zuverlässig und lassen DNS-Rebinding zu. Hier wird auf Socket-Ebene
 *  - der Zielhost selbst aufgelöst und jede Adresse geprüft,
 *  - NUR mit den geprüften Adressen verbunden (DNS-Pinning),
 *  - jeder Weiterleitungsschritt, jede Unterressource und jeder WebSocket erfasst,
 *  - die übertragene Datenmenge begrenzt.
 */
export interface EgressProxyOptions {
  /** Liefert prüfbare Zieladressen oder wirft (= blockiert). */
  resolve: (hostname: string) => Promise<string[]>;
  allowedPorts: ReadonlySet<number>;
  /** Maximale Summe übertragener Bytes (beide Richtungen) */
  maxBytes: number;
  idleTimeoutMs?: number;
  /** Wird einmalig aufgerufen, sobald maxBytes überschritten wurde. */
  onLimit?: () => void;
}

export interface EgressProxy {
  port: number;
  stats: { bytes: number; denied: number; tooLarge: boolean };
  close(): Promise<void>;
}

export const BLOCKED_HEADER = "x-bfsg-blocked";

function pinnedLookup(addresses: string[]) {
  return (_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void): void => {
    const entries = addresses.map((address) => ({ address, family: net.isIP(address) }));
    if (options?.all) callback(null, entries);
    else callback(null, entries[0]?.address, entries[0]?.family);
  };
}

const HOP_BY_HOP = ["proxy-connection", "proxy-authorization", "connection", "keep-alive", "te", "trailer", "upgrade"];

export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const idle = options.idleTimeoutMs ?? 30_000;
  const stats = { bytes: 0, denied: 0, tooLarge: false };
  const sockets = new Set<Duplex>();

  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  const destroyAll = () => {
    for (const s of sockets) s.destroy();
  };
  const count = (chunk: Buffer | string) => {
    stats.bytes += chunk.length;
    if (stats.bytes > options.maxBytes && !stats.tooLarge) {
      stats.tooLarge = true;
      destroyAll();
      options.onLimit?.();
    }
  };

  async function authorize(hostname: string, port: number): Promise<string[] | null> {
    if (!options.allowedPorts.has(port) || stats.tooLarge) {
      stats.denied += 1;
      return null;
    }
    try {
      return await options.resolve(hostname);
    } catch {
      stats.denied += 1;
      return null;
    }
  }

  const server = http.createServer(async (req, res) => {
    track(req.socket);
    try {
      const target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new Error("not-http");
      const port = Number(target.port || 80);
      const addresses = await authorize(target.hostname, port);
      if (!addresses) {
        res.writeHead(403, { [BLOCKED_HEADER]: "1", "content-type": "text/plain" }).end("Blocked");
        return;
      }
      const headers = { ...req.headers };
      for (const h of HOP_BY_HOP) delete headers[h];
      const upstream = http.request({
        host: target.hostname.replace(/^\[|\]$/g, ""),
        port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
        lookup: pinnedLookup(addresses) as never,
        timeout: idle,
      });
      upstream.on("socket", (s) => track(s));
      upstream.on("response", (up) => {
        up.on("data", count);
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502).end();
        else res.destroy();
      });
      req.on("data", count);
      req.pipe(upstream);
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });

  // HTTPS und WebSockets: CONNECT-Tunnel (TLS bleibt Ende-zu-Ende zwischen Browser und Ziel).
  server.on("connect", async (req, clientSocket: Duplex) => {
    track(clientSocket);
    clientSocket.on("error", () => clientSocket.destroy());
    const deny = () => clientSocket.end("HTTP/1.1 403 Forbidden\r\nx-bfsg-blocked: 1\r\nConnection: close\r\n\r\n");
    try {
      const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(req.url ?? "");
      if (!m) return deny();
      const hostname = (m[1] ?? m[2]) as string;
      const port = Number(m[3]);
      const addresses = await authorize(hostname, port);
      if (!addresses) return deny();

      const upstream = track(net.connect({ host: hostname, port, lookup: pinnedLookup(addresses) as never, timeout: idle }));
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      });
      upstream.on("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.on("data", count);
        clientSocket.on("data", count);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      clientSocket.on("close", () => upstream.destroy());
      upstream.on("close", () => clientSocket.destroy());
    } catch {
      deny();
    }
  });

  server.on("clientError", (_e, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        destroyAll();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
