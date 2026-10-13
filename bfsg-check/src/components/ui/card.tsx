import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "li";
  children: ReactNode;
  tone?: "default" | "muted" | "primary";
}

const tones = {
  default: "border-navy-200 bg-white",
  muted: "border-navy-200 bg-navy-50",
  primary: "border-primary-100 bg-primary-50",
};

export function Card({ as: Tag = "div", tone = "default", className = "", children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-xl border p-5 sm:p-6 ${tones[tone]} ${className}`} {...(rest as object)}>
      {children}
    </Tag>
  );
}
