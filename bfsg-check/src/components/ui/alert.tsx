import type { ReactNode } from "react";
import { AlertIcon, ErrorIcon, InfoIcon, CheckIcon } from "../icons";

type Tone = "info" | "warning" | "error" | "success";

const styles: Record<Tone, { box: string; icon: ReactNode }> = {
  info: { box: "border-primary-100 bg-primary-50 text-navy-900", icon: <InfoIcon className="text-primary-700" /> },
  warning: { box: "border-yellow-300 bg-yellow-50 text-yellow-950", icon: <AlertIcon className="text-yellow-800" /> },
  error: { box: "border-red-300 bg-red-50 text-red-950", icon: <ErrorIcon className="text-red-800" /> },
  success: { box: "border-green-300 bg-green-50 text-green-950", icon: <CheckIcon className="text-green-800" /> },
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  /** role="alert" für dringende Fehler, "status" für Hinweise, none = statisch */
  role?: "alert" | "status" | "none";
  className?: string;
  id?: string;
  tabIndex?: number;
  headingLevel?: 2 | 3 | 4;
}

export function Alert({ tone = "info", title, children, role = "none", className = "", headingLevel = 3, ...rest }: AlertProps) {
  const s = styles[tone];
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div
      {...(role === "none" ? {} : { role })}
      className={`flex gap-3 rounded-xl border p-4 ${s.box} ${className}`}
      {...rest}
    >
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <Heading className="text-base font-semibold !text-current">{title}</Heading>}
        {children && <div className={`text-[0.95rem] ${title ? "mt-1" : ""}`}>{children}</div>}
      </div>
    </div>
  );
}
