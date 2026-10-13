import { describe, expect, it } from "vitest";
import { validateScanUrl } from "./validate";
import { classifyIp } from "./ip";

const ok = (input: string) => {
  const r = validateScanUrl(input);
  if (!r.ok) throw new Error(`expected ok for ${input}, got ${r.code}`);
  return r.normalized;
};
const code = (input: unknown) => {
  const r = validateScanUrl(input);
  return r.ok ? "OK" : r.code;
};

describe("validateScanUrl – erlaubte Adressen", () => {
  it("akzeptiert https und http", () => {
    expect(ok("https://www.beispiel.de/")).toBe("https://www.beispiel.de/");
    expect(ok("http://beispiel.de/shop?x=1")).toBe("http://beispiel.de/shop?x=1");
  });
  it("ergänzt https:// bei fehlendem Schema", () => {
    expect(ok("beispiel.de")).toBe("https://beispiel.de/");
    expect(ok("  www.beispiel.de/pfad  ")).toBe("https://www.beispiel.de/pfad");
    expect(ok("beispiel.de:8443/x")).toBe("https://beispiel.de:8443/x");
  });
  it("entfernt Fragmente", () => {
    expect(ok("https://beispiel.de/seite#abschnitt")).toBe("https://beispiel.de/seite");
  });
  it("akzeptiert öffentliche IP-Literale", () => {
    expect(ok("http://93.184.216.34/")).toBe("http://93.184.216.34/");
    expect(code("https://[2606:2800:220:1:248:1893:25c8:1946]/")).toBe("OK");
  });
  it("akzeptiert IDN-Domains", () => {
    expect(code("https://bücher-shop.de")).toBe("OK");
  });
});

describe("validateScanUrl – ungültige Eingaben", () => {
  it("lehnt leere und nicht-String-Eingaben ab", () => {
    expect(code("")).toBe("EMPTY");
    expect(code("   ")).toBe("EMPTY");
    expect(code(undefined)).toBe("INVALID");
    expect(code(42)).toBe("INVALID");
    expect(code({})).toBe("INVALID");
  });
  it("lehnt zu lange Adressen ab", () => {
    expect(code(`https://beispiel.de/${"a".repeat(2100)}`)).toBe("TOO_LONG");
  });
  it("lehnt Leerzeichen und Steuerzeichen ab", () => {
    expect(code("https://bei spiel.de")).toBe("INVALID");
    expect(code("https://beispiel.de/\r\nHost: evil")).toBe("INVALID");
  });
  it("lehnt Nicht-Web-Schemata ab", () => {
    expect(code("file:///etc/passwd")).toBe("PROTOCOL");
    expect(code("ftp://beispiel.de")).toBe("PROTOCOL");
    expect(code("javascript:alert(1)")).toBe("PROTOCOL");
    expect(code("data:text/html,<h1>x</h1>")).toBe("PROTOCOL");
    expect(code("gopher://beispiel.de")).toBe("PROTOCOL");
  });
  it("lehnt Zugangsdaten in der URL ab", () => {
    expect(code("https://user:pw@beispiel.de")).toBe("CREDENTIALS");
    expect(code("https://admin@beispiel.de")).toBe("CREDENTIALS");
  });
  it("lehnt ungewöhnliche Ports ab", () => {
    expect(code("https://beispiel.de:22")).toBe("PORT");
    expect(code("http://beispiel.de:6379")).toBe("PORT");
    expect(code("https://beispiel.de:8443")).toBe("OK");
  });
});

describe("validateScanUrl – interne Ziele (SSRF)", () => {
  it.each([
    "http://localhost",
    "http://localhost:8080",
    "https://LOCALHOST/",
    "http://app.localhost",
    "http://intranet",
    "http://router.local",
    "http://db.internal",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://printer.lan",
    "http://nas.home.arpa",
    "localhost:3000",
  ])("blockiert Hostname %s", (u) => {
    expect(code(u)).toMatch(/HOST_BLOCKED/);
  });

  it.each([
    "http://127.0.0.1",
    "http://127.1.2.3:8080",
    "http://0.0.0.0",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1",
    "http://192.0.0.192",
    "http://198.18.0.1",
    "http://224.0.0.1",
    "http://255.255.255.255",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[2001:db8::1]/",
  ])("blockiert IP-Literal %s", (u) => {
    expect(code(u)).toBe("HOST_NOT_PUBLIC");
  });

  it.each([
    ["http://2130706433/", "Dezimal-Schreibweise von 127.0.0.1"],
    ["http://0x7f000001/", "Hex-Schreibweise"],
    ["http://0177.0.0.1/", "Oktal-Schreibweise"],
    ["http://127.1/", "Kurzform"],
    ["http://0/", "0 = 0.0.0.0"],
    ["http://2852039166/", "Dezimal 169.254.169.254"],
  ])("blockiert verschleierte IPv4-Form %s (%s)", (u) => {
    expect(code(u)).toBe("HOST_NOT_PUBLIC");
  });

  it("blockiert Hostnamen mit abschließendem Punkt", () => {
    expect(code("http://localhost./")).toBe("HOST_BLOCKED");
  });
});

describe("classifyIp", () => {
  it("klassifiziert Grenzfälle der privaten Bereiche", () => {
    expect(classifyIp("172.15.255.255")).toBe("public");
    expect(classifyIp("172.32.0.0")).toBe("public");
    expect(classifyIp("100.63.255.255")).toBe("public");
    expect(classifyIp("100.128.0.0")).toBe("public");
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("2606:4700:4700::1111")).toBe("public");
    expect(classifyIp("::ffff:8.8.8.8")).toBe("public");
  });
  it("gibt null für Hostnamen zurück", () => {
    expect(classifyIp("beispiel.de")).toBeNull();
  });
  it("blockiert unparsbare IPv6-Literale", () => {
    expect(classifyIp("1::2::3")).toBe("non-public");
  });
});
