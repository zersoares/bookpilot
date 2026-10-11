import { HeroPanel, Agencies, Boundaries, Deliverables, Faq, HowItWorks, Integrations } from "@/components/landing/sections";
import { UrlForm } from "@/components/url-form";
import { ButtonLink } from "@/components/ui/button";

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="hero-h" className="border-b border-navy-100 bg-gradient-to-b from-primary-50/60 to-white">
        <div className="container-page grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">Barrierefreiheit nachweisbar machen</p>
            <h1 id="hero-h" className="mt-3 text-4xl sm:text-5xl">
              BFSG-Check für Websites und Online-Shops
            </h1>
            <p className="mt-5 max-w-prose text-lg text-navy-700 sm:text-xl">
              Prüfen Sie, ob Ihr Angebot wahrscheinlich betroffen ist, erkennen Sie technische Barrieren und erhalten Sie einen priorisierten Maßnahmenplan.
            </p>
            <div className="mt-8 max-w-xl rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-6">
              <UrlForm />
            </div>
          </div>
          <HeroPanel />
        </div>
      </section>

      <HowItWorks />
      <Deliverables />
      <Boundaries />
      <Agencies />
      <Integrations />
      <Faq />

      <section aria-labelledby="cta-h" className="py-16">
        <div className="container-page text-center">
          <h2 id="cta-h" className="text-3xl">Bereit für den ersten Überblick?</h2>
          <p className="mx-auto mt-3 max-w-prose text-navy-700">Der Check dauert wenige Minuten und braucht keine Registrierung.</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/check" size="lg">Kostenlosen Check starten</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
