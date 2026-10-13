import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]";
const variants: Record<Variant, string> = {
  primary: "bg-primary-700 text-white hover:bg-primary-800 active:bg-primary-800",
  secondary: "border border-navy-300 bg-white text-navy-900 hover:bg-navy-50",
  ghost: "text-primary-700 hover:bg-primary-50",
};
const sizes: Record<Size, string> = { md: "px-4 py-2 text-base", lg: "px-6 py-3 text-lg" };

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra = "") =>
  [base, variants[variant], sizes[size], extra].filter(Boolean).join(" ");

interface Common {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({ variant, size, className, children, type = "button", ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, className, children, href, ...rest }: Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
