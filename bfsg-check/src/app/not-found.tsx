import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">Fehler 404</p>
        <h1 className="mt-2 text-3xl">Seite nicht gefunden</h1>
        <p className="mt-3 text-navy-700">Die angeforderte Seite gibt es nicht (mehr). Prüfen Sie die Adresse oder kehren Sie zur Startseite zurück.</p>
        <div className="mt-6 flex justify-center gap-3">
          <ButtonLink href="/">Zur Startseite</ButtonLink>
          <ButtonLink href="/check" variant="secondary">Check starten</ButtonLink>
        </div>
      </div>
    </div>
  );
}
