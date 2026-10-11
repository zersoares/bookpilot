import "server-only";
import dns from "node:dns/promises";
import { checkHostname, type UrlValidation, validateScanUrl } from "./validate";
import { classifyIp, parseIPv4, parseIPv6 } from "./ip";

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/** Entwicklungs-/Testschalter. In Produktion immer wirkungslos. */
export function privateTargetsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.BFSG_ALLOW_PRIVATE_TARGETS === "1";
}

function isLoopback(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return v4[0] === 127;
  const v6 = parseIPv6(address);
  return !!v6 && v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1;
}

export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/**
 * Löst einen Hostnamen auf und liefert die Adressen, mit denen verbunden werden
 * darf. Wirft, wenn IRGENDEINE Auflösung nicht öffentlich ist. Der Egress-Proxy
 * verbindet anschließend genau mit diesen Adressen (DNS-Pinning, kein Rebinding).
 */
export async function resolvePublicAddresses(hostname: string, resolve: Resolver = defaultResolver): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const literal = classifyIp(host);

  if (privateTargetsAllowed()) {
    // Nur Entwicklung: Loopback (localhost, 127.0.0.0/8, ::1) darf gescannt werden –
    // Metadaten-Adressen und private Netze bleiben auch hier blockiert.
    const candidates = literal ? [host] : host === "localhost" ? ["127.0.0.1"] : await resolve(host).catch(() => []);
    if (candidates.length === 0) throw new BlockedTargetError("Der Hostname konnte nicht aufgelöst werden.");
    for (const address of candidates) {
      if (classifyIp(address) !== "public" && !isLoopback(address)) {
        throw new BlockedTargetError("Diese Adresse verweist auf ein nicht öffentliches Netzwerk und kann nicht geprüft werden.");
      }
    }
    return candidates;
  }

  const syntactic = checkHostname(host);
  if (syntactic && !syntactic.ok) throw new BlockedTargetError(syntactic.message);
  if (literal === "public") return [host];

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new BlockedTargetError("Der Hostname konnte nicht aufgelöst werden.");
  }
  if (addresses.length === 0) throw new BlockedTargetError("Der Hostname konnte nicht aufgelöst werden.");
  for (const address of addresses) {
    if (classifyIp(address) !== "public") {
      throw new BlockedTargetError("Diese Adresse verweist auf ein nicht öffentliches Netzwerk und kann nicht geprüft werden.");
    }
  }
  return addresses;
}

/** Wie resolvePublicAddresses, aber ohne Rückgabewert (reine Prüfung). */
export async function assertPublicHost(hostname: string, resolve: Resolver = defaultResolver): Promise<void> {
  await resolvePublicAddresses(hostname, resolve);
}

/**
 * Syntaxprüfung der Start-URL. Nur außerhalb von Produktion und nur mit
 * BFSG_ALLOW_PRIVATE_TARGETS=1 werden syntaktisch gültige private Ziele durchgelassen.
 */
export function parseScanTarget(input: unknown): UrlValidation {
  const result = validateScanUrl(input);
  if (!result.ok && privateTargetsAllowed() && typeof input === "string") {
    try {
      const u = new URL(input.trim());
      if (u.protocol === "http:" || u.protocol === "https:") return { ok: true, url: u, normalized: u.toString() };
    } catch {
      /* bleibt Fehler */
    }
  }
  return result;
}

/** Syntax- + DNS-Prüfung der vom Nutzer übergebenen Start-URL. */
export async function assertPublicTarget(input: unknown, resolve?: Resolver): Promise<URL> {
  const result = parseScanTarget(input);
  if (!result.ok) throw new BlockedTargetError(result.message);
  await assertPublicHost(result.url.hostname, resolve);
  return result.url;
}
