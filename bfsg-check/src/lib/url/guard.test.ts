import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicHost, assertPublicTarget, BlockedTargetError } from "./guard";

afterEach(() => vi.unstubAllEnvs());

describe("assertPublicHost (DNS-Prüfung)", () => {
  it("erlaubt Hostnamen, die nur auf öffentliche IPs auflösen", async () => {
    await expect(assertPublicHost("beispiel.de", async () => ["93.184.216.34", "2606:2800:220:1::1"])).resolves.toBeUndefined();
  });
  it("blockiert, wenn irgendeine Auflösung privat ist (DNS-Rebinding-Mix)", async () => {
    await expect(assertPublicHost("evil.example", async () => ["93.184.216.34", "10.0.0.7"])).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("blockiert Hostnamen, die auf Loopback/Metadaten zeigen", async () => {
    await expect(assertPublicHost("a.example", async () => ["127.0.0.1"])).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("b.example", async () => ["169.254.169.254"])).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("c.example", async () => ["::1"])).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("blockiert bei Auflösungsfehlern und leeren Antworten", async () => {
    await expect(assertPublicHost("x.example", async () => { throw new Error("ENOTFOUND"); })).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("x.example", async () => [])).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("löst öffentliche IP-Literale nicht erneut auf", async () => {
    const resolver = vi.fn(async () => ["10.0.0.1"]);
    await assertPublicHost("93.184.216.34", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("blockiert localhost ohne DNS-Abfrage", async () => {
    const resolver = vi.fn(async () => ["93.184.216.34"]);
    await expect(assertPublicHost("localhost", resolver)).rejects.toBeInstanceOf(BlockedTargetError);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("assertPublicTarget", () => {
  it("gibt die normalisierte URL zurück", async () => {
    const url = await assertPublicTarget("beispiel.de/shop", async () => ["93.184.216.34"]);
    expect(url.toString()).toBe("https://beispiel.de/shop");
  });
  it("wirft bei ungültiger Eingabe", async () => {
    await expect(assertPublicTarget("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("Entwicklungsschalter wirkt in Produktion NICHT", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BFSG_ALLOW_PRIVATE_TARGETS", "1");
    await expect(assertPublicTarget("http://127.0.0.1:3000/")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("localhost")).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("Entwicklungsschalter erlaubt nur Loopback – nie Metadaten oder private Netze", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BFSG_ALLOW_PRIVATE_TARGETS", "1");
    const url = await assertPublicTarget("http://127.0.0.1:3000/");
    expect(url.hostname).toBe("127.0.0.1");
    await expect(assertPublicHost("localhost")).resolves.toBeUndefined();
    await expect(assertPublicHost("::1")).resolves.toBeUndefined();
    await expect(assertPublicHost("169.254.169.254")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("10.0.0.1")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("192.168.1.1")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHost("intern.example", async () => ["10.1.2.3"])).rejects.toBeInstanceOf(BlockedTargetError);
  });
});
