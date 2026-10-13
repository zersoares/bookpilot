/**
 * IP-Klassifikation für den SSRF-Schutz. Reine Funktionen, kein Node-Import,
 * damit sie auch im Browser (frühes Formular-Feedback) laufen.
 */

/** Parst einen dezimalen IPv4-Literal ("a.b.c.d") in vier Oktette. */
export function parseIPv4(input: string): [number, number, number, number] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

/** Expandiert einen IPv6-Literal (ohne eckige Klammern/Zone) auf acht 16-Bit-Gruppen. */
export function parseIPv6(input: string): number[] | null {
  let addr = input.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(addr)) return null;

  // Eingebettetes IPv4 am Ende (z. B. ::ffff:1.2.3.4) in zwei Gruppen umwandeln.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + rest.length > 7) return null;

  const fill = halves.length === 2 ? new Array<string>(8 - head.length - rest.length).fill("0") : [];
  const groups = [...head, ...fill, ...rest];
  if (groups.length !== 8) return null;

  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    nums.push(parseInt(g, 16));
  }
  return nums;
}

/** true, wenn die IPv4-Adresse NICHT global routbar/öffentlich ist. */
export function isNonPublicIPv4(ip: [number, number, number, number]): boolean {
  const [a, b, c] = ip;
  return (
    a === 0 || // "dieses Netz"
    a === 10 || // privat
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 || // Loopback
    (a === 169 && b === 254) || // Link-Local inkl. Cloud-Metadaten 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // privat
    (a === 192 && b === 0 && c === 0) || // IETF-Protokollzuweisungen
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4-Relay (veraltet)
    (a === 192 && b === 168) || // privat
    (a === 198 && (b === 18 || b === 19)) || // Benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // Multicast, reserviert, Broadcast
  );
}

/** true, wenn die IPv6-Adresse NICHT global routbar/öffentlich ist. */
export function isNonPublicIPv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = (hi: number, lo: number): boolean =>
    isNonPublicIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);

  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (firstFiveZero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: und ::1
  if (firstFiveZero && g5 === 0xffff) return embedded(g6, g7); // IPv4-mapped ::ffff:a.b.c.d
  if (firstFiveZero && g5 === 0) return true; // IPv4-kompatibel (veraltet) ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7); // NAT64
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // Dokumentation
  if ((g0 & 0xfe00) === 0xfc00) return true; // Unique Local fc00::/7 (u. a. fd00:ec2::254)
  if ((g0 & 0xffc0) === 0xfe80) return true; // Link-Local
  if ((g0 & 0xffc0) === 0xfec0) return true; // Site-Local (veraltet)
  if ((g0 & 0xff00) === 0xff00) return true; // Multicast
  // Global-Unicast liegt in 2000::/3 – alles andere ist (noch) nicht vergeben.
  if ((g0 & 0xe000) !== 0x2000) return true;
  return false;
}

/** Klassifiziert einen IP-Literal (v4 oder v6, ohne Klammern). null = kein IP-Literal. */
export function classifyIp(literal: string): "public" | "non-public" | null {
  const v4 = parseIPv4(literal);
  if (v4) return isNonPublicIPv4(v4) ? "non-public" : "public";
  if (literal.includes(":")) {
    const v6 = parseIPv6(literal);
    if (v6) return isNonPublicIPv6(v6) ? "non-public" : "public";
    return "non-public"; // unparsbar → vorsichtshalber blockieren
  }
  return null;
}
