import Link from "next/link";
import { ButtonLink } from "./ui/button";

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold text-navy-900">
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-primary-700 text-sm font-bold text-white">
        B
      </span>
      BFSG&nbsp;Check
    </span>
  );
}

const links = [
  { href: "/#ablauf", label: "So funktioniert’s" },
  { href: "/#agenturen", label: "Für Agenturen" },
  { href: "/methodik", label: "Methodik" },
  { href: "/datenschutz", label: "Datenschutz" },
];

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-navy-200 bg-white/95 backdrop-blur">
      <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Link href="/">
          <Logo />
          <span className="sr-only"> – zur Startseite</span>
        </Link>
        <nav aria-label="Hauptnavigation" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-block py-2 text-[0.95rem] font-medium text-navy-800 hover:text-primary-700 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonLink href="/check" className="!min-h-[40px] !py-1.5 text-[0.95rem]">
          Check starten
        </ButtonLink>
      </div>
    </header>
  );
}
