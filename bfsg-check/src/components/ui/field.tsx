import type { InputHTMLAttributes, ReactNode } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function TextField({ id, label, hint, error, className = "", ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-base font-semibold text-navy-900">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-navy-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-800">
          <span aria-hidden="true">⚠</span>
          <span>
            <span className="sr-only">Fehler: </span>
            {error}
          </span>
        </p>
      )}
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={`mt-2 block min-h-[44px] w-full rounded-lg border bg-white px-3 py-2 text-base text-navy-900 placeholder:text-navy-500 ${
          error ? "border-red-700 ring-1 ring-red-700" : "border-navy-500"
        } ${className}`}
        {...rest}
      />
    </div>
  );
}

interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface RadioGroupProps<T extends string> {
  name: string;
  legend: string;
  hint?: ReactNode;
  options: Option<T>[];
  value: T | "";
  onChange: (value: T) => void;
  error?: string;
  /** Sichtbare Zahl vor der Frage, z. B. „1“ */
  number?: number;
  columns?: boolean;
}

export function RadioGroup<T extends string>({ name, legend, hint, options, value, onChange, error, number, columns }: RadioGroupProps<T>) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  return (
    <fieldset
      className="rounded-xl border border-navy-200 bg-white p-4 sm:p-5"
      aria-describedby={[hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
    >
      <legend className="px-1 text-base font-semibold text-navy-900">
        {number !== undefined && <span className="mr-2 text-primary-700">{number}.</span>}
        {legend}
      </legend>
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-navy-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-800">
          <span aria-hidden="true">⚠</span>
          <span>
            <span className="sr-only">Fehler: </span>
            {error}
          </span>
        </p>
      )}
      <div className={`mt-3 grid gap-2 ${columns ? "sm:grid-cols-2" : ""}`}>
        {options.map((opt) => {
          const id = `${name}-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-700 ${
                value === opt.value ? "border-primary-700 bg-primary-50" : "border-navy-200 hover:bg-navy-50"
              }`}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                className="mt-1 h-5 w-5 shrink-0 accent-primary-700"
              />
              <span>
                <span className="block font-medium text-navy-900">{opt.label}</span>
                {opt.description && <span className="block text-sm text-navy-600">{opt.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
