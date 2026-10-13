"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { evaluateScope, type ScopeAnswers } from "@/lib/scope/evaluate";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType, type Tri } from "@/lib/scope/rules";
import { updateSession, useCheckSession } from "@/lib/session";
import { validateScanUrl } from "@/lib/url/validate";
import { ArrowRightIcon } from "./icons";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { RadioGroup, TextField } from "./ui/field";
import { Card } from "./ui/card";

const TRI: Array<{ value: Tri; label: string }> = [
  { value: "yes", label: "Ja" },
  { value: "no", label: "Nein" },
  { value: "unsure", label: "Weiß ich nicht" },
];

type Draft = { [K in keyof ScopeAnswers]: ScopeAnswers[K] | "" };
const FIELD_ORDER: Array<keyof ScopeAnswers> = ["consumers", "serviceType", "microEnterprise", "germany", "publicActive"];

const QUESTION_ERRORS: Record<keyof ScopeAnswers, string> = {
  consumers: "Bitte wählen Sie eine Antwort zu Frage 1.",
  serviceType: "Bitte wählen Sie eine Antwort zu Frage 2.",
  microEnterprise: "Bitte wählen Sie eine Antwort zu Frage 3.",
  germany: "Bitte wählen Sie eine Antwort zu Frage 4.",
  publicActive: "Bitte wählen Sie eine Antwort zu Frage 5.",
};

const fieldId = (key: string) => (key === "url" ? "check-url" : `${key}-${key === "serviceType" ? "shop" : "yes"}`);

export function ScopeQuestionnaire() {
  const router = useRouter();
  const { session, hydrated } = useCheckSession();
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ScopeAnswers | "url", string>>>({});
  const summaryRef = useRef<HTMLDivElement>(null);

  const url = urlDraft ?? session.url;
  const current: Draft = answers ?? {
    consumers: session.answers?.consumers ?? "",
    serviceType: session.answers?.serviceType ?? "",
    microEnterprise: session.answers?.microEnterprise ?? "",
    germany: session.answers?.germany ?? "",
    publicActive: session.answers?.publicActive ?? "",
  };
  const set = <K extends keyof ScopeAnswers>(key: K, value: ScopeAnswers[K]) => {
    setAnswers({ ...current, [key]: value });
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const errorList = Object.entries(errors).filter(([, v]) => v) as Array<[string, string]>;
  useEffect(() => {
    if (errorList.length > 0) summaryRef.current?.focus();
    // Fokus nur setzen, wenn neue Fehler entstehen
  }, [errorList.length]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const parsed = validateScanUrl(url);
    if (!parsed.ok) next.url = parsed.message;
    for (const key of FIELD_ORDER) if (!current[key]) next[key] = QUESTION_ERRORS[key];
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok) return;

    const final = current as ScopeAnswers;
    const scope = evaluateScope(final);
    // Neue Eingaben → alte Ergebnisse verwerfen
    updateSession({ url: parsed.normalized, answers: final, scope, scan: undefined, statuses: {} });
    router.push("/ergebnis");
  }

  if (!hydrated) {
    return <p className="text-navy-600" role="status">Formular wird geladen …</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby="form-intro">
      {errorList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-950 outline-none">
          <h2 className="text-base font-semibold !text-current">Bitte korrigieren Sie folgende Angaben:</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errorList.map(([key, message]) => (
              <li key={key}>
                <a
                  className="font-medium underline"
                  href={`#${fieldId(key)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(fieldId(key))?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p id="form-intro" className="text-navy-700">
        Fünf kurze Fragen helfen bei der ersten Einordnung. Antworten Sie nach bestem Wissen – bei Unsicherheit wählen Sie „Weiß ich nicht“.
      </p>

      <Card>
        <TextField
          id="check-url"
          label="Zu prüfende Seite"
          hint="Es wird nur diese eine Seite geprüft (öffentliche http- oder https-Adresse)."
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://www.beispiel.de"
          value={url}
          error={errors.url}
          onChange={(e) => {
            setUrlDraft(e.target.value);
            setErrors((x) => ({ ...x, url: undefined }));
          }}
        />
      </Card>

      <RadioGroup
        number={1}
        name="consumers"
        legend="Verkaufen Sie Produkte oder Dienstleistungen an Verbraucher?"
        hint="Verbraucher sind Privatpersonen, die nicht für ihr Gewerbe einkaufen."
        options={TRI}
        value={current.consumers}
        onChange={(v) => set("consumers", v)}
        error={errors.consumers}
      />

      <RadioGroup<ServiceType>
        number={2}
        name="serviceType"
        legend="Um was für ein Angebot handelt es sich?"
        options={SERVICE_TYPES.map((value) => ({ value, label: SERVICE_TYPE_LABELS[value] }))}
        value={current.serviceType}
        onChange={(v) => set("serviceType", v)}
        error={errors.serviceType}
        columns
      />

      <RadioGroup
        number={3}
        name="microEnterprise"
        legend="Ist Ihr Unternehmen ein Kleinstunternehmen für Dienstleistungen (weniger als 10 Beschäftigte und weniger als 2 Mio. € Jahresumsatz)?"
        hint="Maßgeblich sind Beschäftigtenzahl sowie Jahresumsatz oder Bilanzsumme. Verbundene Unternehmen können mitzählen."
        options={TRI}
        value={current.microEnterprise}
        onChange={(v) => set("microEnterprise", v)}
        error={errors.microEnterprise}
      />

      <RadioGroup
        number={4}
        name="germany"
        legend="Wird das Angebot Kundinnen und Kunden in Deutschland angeboten?"
        options={TRI}
        value={current.germany}
        onChange={(v) => set("germany", v)}
        error={errors.germany}
      />

      <RadioGroup
        number={5}
        name="publicActive"
        legend="Ist die Website öffentlich erreichbar und aktuell in Betrieb?"
        hint="Der Scan kann nur öffentlich erreichbare Seiten ohne Anmeldung prüfen."
        options={TRI}
        value={current.publicActive}
        onChange={(v) => set("publicActive", v)}
        error={errors.publicActive}
      />

      <Alert tone="info">
        Mit „Einschätzung anzeigen und Scan starten“ ruft unser Server die oben genannte Seite einmalig auf. Es werden weder Adresse noch Seiteninhalt oder Bericht dauerhaft gespeichert.
      </Alert>

      <Button type="submit" size="lg" className="w-full sm:w-auto">
        Einschätzung anzeigen und Scan starten
        <ArrowRightIcon />
      </Button>
    </form>
  );
}
