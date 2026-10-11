"use client";
import { Button, ButtonLink } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-xl text-center" role="alert">
        <h1 className="text-3xl">Etwas ist schiefgelaufen</h1>
        <p className="mt-3 text-navy-700">Die Seite konnte nicht angezeigt werden. Ihre Eingaben in diesem Tab sind nicht verloren. Bitte versuchen Sie es erneut.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Erneut versuchen</Button>
          <ButtonLink href="/" variant="secondary">Zur Startseite</ButtonLink>
        </div>
      </div>
    </div>
  );
}
