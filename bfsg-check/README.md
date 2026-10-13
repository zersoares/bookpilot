# BFSG Check (MVP)

Deutschsprachiges Werkzeug für Online-Shops und Agenturen: (1) Orientierung, ob das BFSG / der European Accessibility Act das Angebot betreffen könnte, (2) automatischer Barrierefreiheits-Scan einer URL mit axe-core, (3) priorisierter Maßnahmenplan mit Statusverfolgung, druckbarer Bericht und Entwurf einer Barrierefreiheitserklärung.

**Grenzen:** keine Rechtsberatung, keine Zertifizierung, nie „vollständig konform“. Kein Overlay, keine Auto-Korrektur. Automatisierte Tests finden nur einen Teil der Barrieren.

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 3, axe-core, playwright-core (Chromium), Vitest.

## Lokal starten

```bash
cd bfsg-check
npm install
# Chromium: entweder Playwright-Browser installieren …
npx playwright-core install chromium
# … oder vorhandenen Browser angeben:
cp .env.example .env.local   # CHROMIUM_EXECUTABLE_PATH setzen
npm run dev                  # http://localhost:3000
```

Ohne Browser zeigt die App einen klaren Fehlerzustand („Scanner nicht verfügbar“) – nie erfundene Ergebnisse. Im Entwicklungsmodus gibt es dann die Schaltfläche „Demo-Daten laden“; diese Daten sind überall als **Demo-Daten** gekennzeichnet und im Produktions-Build nicht enthalten.

Befehle: `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`

Integrationstest mit echtem Chromium (lokale Testserver, prüft u. a. Redirect-Blockade und Größenlimit):

```bash
BFSG_INTEGRATION=1 CHROMIUM_EXECUTABLE_PATH=/pfad/chrome BFSG_CHROMIUM_NO_SANDBOX=1 npm test
```

Lokal gegen `localhost` scannen (nur Entwicklung, nur Loopback): `BFSG_ALLOW_PRIVATE_TARGETS=1`; in Produktion wirkungslos.

## Deployment

Der Scan braucht einen echten Browser-Prozess. Empfohlen: Container (siehe `Dockerfile`, Playwright-Basis-Image, Next „standalone“) auf einer Plattform mit Dauerprozess (Fly.io, Render, Cloud Run, eigener Server). Reine Serverless-Umgebungen ohne Chromium können nicht scannen und zeigen den Fehlerzustand. Das Dockerfile wurde hier nicht gebaut/getestet.

Betriebsempfehlungen:
- **Egress-Firewall**: Container nur ins öffentliche Internet lassen (kein Zugriff auf private Netze/Metadaten) – zweite Verteidigungslinie hinter dem eingebauten Schutz.
- **Reverse-Proxy**: nur dahinter `BFSG_TRUST_PROXY=1` setzen, damit das Rate-Limit je Client-IP (letzter `X-Forwarded-For`-Eintrag) greift. Ohne Vertrauen gilt ein gemeinsamer Zähler.
- Speicher-/CPU-Limits setzen; `BFSG_MAX_CONCURRENT_SCANS` passend wählen.
- Platzhalter in `/datenschutz` und `/impressum` ausfüllen und rechtlich prüfen lassen.

Konfiguration: siehe `.env.example`.

## Sicherheit & Datenschutz

- Nur `http`/`https`, nur Ports 80/443/8080/8443, keine Zugangsdaten in URLs, max. 2048 Zeichen.
- Blockiert: localhost, private/Loopback/Link-Local-Bereiche, Cloud-Metadaten, verschleierte IPv4-Formen (dezimal/hex/oktal), IPv6-Varianten (IPv4-mapped, NAT64, 6to4), interne Suffixe (`.local`, `.internal` …), `file:` u. a.
- **Egress-Proxy pro Scan** (`src/lib/scan/egress-proxy.ts`): Chromium läuft ausschließlich durch einen lokalen Proxy, der Hostnamen selbst auflöst, jede Adresse prüft und nur mit den geprüften IPs verbindet. Das deckt Weiterleitungen, Unterressourcen und WebSockets ab und verhindert DNS-Rebinding. (Ein Browser-seitiger `route`-Handler reichte nicht, er sieht Weiterleitungen nicht; der Integrationstest sichert das ab.)
- Limits: Navigation 25 s, axe 25 s, Gesamtdauer 60 s, Datenmenge 25 MB (`BFSG_MAX_PAGE_MB`), max. 60 000 DOM-Elemente, Rate-Limit 5 Scans / 10 min, 2 parallele Scans, Same-Origin-Prüfung, 4-KB-Body-Limit.
- Nichts wird dauerhaft gespeichert. Ergebnisse, Status und Texteingaben liegen nur im `sessionStorage` des Tabs. Rate-Limit-Zähler nur im Arbeitsspeicher. Logs enthalten nur Fehlercodes, keine URLs.
- Security-Header inkl. CSP (`next.config.ts`). `script-src` enthält `'unsafe-inline'` (Next-Bootstrap); strengere CSP erfordert Nonces per Middleware.

## Bekannte Einschränkungen

- Nur die eingegebene Seite, Desktop-Viewport 1280×800, Zustand nach dem Laden; keine Logins, keine mehrstufigen Abläufe.
- Seiten mit Bot-Schutz können scheitern. Rate-Limit gilt je Instanz.
- Regelsatz: WCAG 2.1 A/AA + Best Practices (Orientierung an EN 301 549); WCAG-2.2-Regeln sind nicht aktiv.
- Für Regeln ohne kuratierten deutschen Text erscheint ein gekennzeichneter generischer Text; neue Texte in `src/lib/scan/rule-content.ts` ergänzen.
- PDF über den Druckdialog des Browsers („Als PDF speichern“, Druck-CSS vorhanden). Kein serverseitiges PDF.
- Der Browser-Durchlauf der UI wurde manuell geprüft, ist aber keine automatisierte Suite im Repo.
- Die Scope-Texte (BFSG-Auslegung, Kleinstunternehmen) und die Entwurfs-Platzhalter zur Marktüberwachung sind nicht juristisch geprüft.

## Deutschland-spezifische Regeln aktualisieren

Alle rechtlichen Inhalte der Einschätzung liegen in **`src/lib/scope/rules.ts`** (Texte, Ergebnis-Labels, Definition Kleinstunternehmen, Datum/Version). Der Entscheidungsfluss steht in `src/lib/scope/evaluate.ts` (Reihenfolge im Kommentar).

1. Inhalte in `rules.ts` ändern (bei Logikänderung zusätzlich `evaluate.ts`).
2. `RULES_VERSION` und `REVIEWED_ON` setzen.
3. Tests in `src/lib/scope/evaluate.test.ts` anpassen, `npm test`.
4. Methodik-Seite gegenlesen (zeigt Version und Prüfdatum automatisch an).

Empfohlen: Überprüfung mindestens alle 6 Monate und bei Gesetzes-/Behördenänderungen, mit juristischer Begleitung.

## Struktur

```
src/app/            Seiten (/, /check, /ergebnis, /bericht, /methodik, /datenschutz, /impressum) + /api/scan
src/components/     UI-Bausteine, Landing, Ergebnisse, Bericht
src/lib/scope/      Anwendungsbereich (Regeln + Logik + Tests)
src/lib/scan/       Scanner, Egress-Proxy, axe-Normalisierung, Plan, deutsche Regeltexte
src/lib/url/        URL-Validierung und DNS/IP-Guard
src/lib/security/   Rate-Limit, Client-IP, Same-Origin, Limits
src/lib/demo/       Demo-Daten (nur Entwicklung)
```

Nicht enthalten (bewusst): Login, Abrechnung, Datenbank, Mehr-Kunden-Berichte, WordPress-/Shopify-Integration (nur Platzhalter auf der Startseite).
