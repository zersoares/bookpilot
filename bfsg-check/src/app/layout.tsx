import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SkipLink } from "@/components/skip-link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BFSG Check – Barrierefreiheits-Check für Websites und Online-Shops", template: "%s – BFSG Check" },
  description:
    "Prüfen Sie, ob Ihr Angebot wahrscheinlich vom BFSG betroffen ist, erkennen Sie technische Barrieren und erhalten Sie einen priorisierten Maßnahmenplan. Keine Rechtsberatung, keine Zertifizierung.",
  applicationName: "BFSG Check",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="flex min-h-screen flex-col">
        <SkipLink />
        <SiteHeader />
        <main id="inhalt" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
