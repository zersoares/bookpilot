"use client";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { resetCheck, useCheckSession } from "@/lib/session";
import { validateScanUrl } from "@/lib/url/validate";
import { ArrowRightIcon } from "./icons";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";

/** Startformular (Landingpage). Validiert früh und übergibt die URL per Sitzungsspeicher – nicht per Adresszeile. */
export function UrlForm({ buttonLabel = "Kostenlosen Check starten", idPrefix = "hero" }: { buttonLabel?: string; idPrefix?: string }) {
  const router = useRouter();
  const { session } = useCheckSession();
  const uid = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const value = draft ?? session.url;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateScanUrl(value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(undefined);
    resetCheck(result.normalized);
    router.push("/check");
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby={`${uid}-title`} className="space-y-3">
      <h2 id={`${uid}-title`} className="sr-only">
        Kostenlosen Check starten
      </h2>
      <TextField
        id={`${idPrefix}-url`}
        label="Adresse Ihrer Website oder Ihres Online-Shops"
        hint="Zum Beispiel https://www.beispiel.de – geprüft wird genau diese eine Seite."
        placeholder="https://www.beispiel.de"
        type="text"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        error={error}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(undefined);
        }}
      />
      <Button type="submit" size="lg" className="w-full sm:w-auto">
        {buttonLabel}
        <ArrowRightIcon />
      </Button>
      <p className="text-sm text-navy-600">Keine Registrierung. Bitte keine vertraulichen Seiten eingeben: Die Adresse wird einmalig von unserem Server aufgerufen.</p>
    </form>
  );
}
