import Link from "next/link";
import { Logo } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="no-print mt-20 border-t border-navy-200 bg-navy-50">
      <div className="container-page py-10">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-prose text-sm text-navy-600">
              BFSG Check unterstützt Sie bei der Dokumentation digitaler Barrierefreiheit. Das Werkzeug liefert technische Hinweise und Orientierung – keine Rechtsberatung, keine Zertifizierung und keine Garantie für Konformität.
            </p>
          </div>
          <nav aria-label="Produkt">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-600">Produkt</h2>
            <ul className="mt-3 space-y-1 text-sm">
              <li><Link className="link" href="/check">Kostenloser Check</Link></li>
              <li><Link className="link" href="/methodik">Methodik und Grenzen</Link></li>
              <li><Link className="link" href="/#agenturen">Für Agenturen</Link></li>
            </ul>
          </nav>
          <nav aria-label="Rechtliches">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-600">Rechtliches</h2>
            <ul className="mt-3 space-y-1 text-sm">
              <li><Link className="link" href="/datenschutz">Datenschutz</Link></li>
              <li><Link className="link" href="/impressum">Impressum</Link></li>
            </ul>
          </nav>
        </div>
        <p className="mt-8 border-t border-navy-200 pt-6 text-sm text-navy-600">
          Keine Rechtsberatung. Automatisierte Tests erkennen nur einen Teil möglicher Barrieren; manuelle Prüfungen bleiben erforderlich.
        </p>
      </div>
    </footer>
  );
}
