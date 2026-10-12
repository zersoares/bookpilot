import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// Optionaler Unterpfad (z. B. "/bfsg-check" hinter gdprgard.eu). Zur BUILD-Zeit setzen.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

// Content-Security-Policy. Next.js injects small inline bootstrap scripts, so
// 'unsafe-inline' is required for script-src unless a per-request nonce is
// minted (see README, "Härtung"). Everything else is locked to same-origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  poweredByHeader: false,
  reactStrictMode: true,
  // Loaded from node_modules at runtime (Chromium driver + axe source file).
  serverExternalPackages: ["playwright-core", "axe-core"],
  // Das Datei-Tracing der Standalone-Ausgabe übersieht Dateien wie playwright-core/browsers.json.
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/playwright-core/**/*", "./node_modules/axe-core/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
