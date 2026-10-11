import type { ReactNode } from "react";

export function PageShell({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">{eyebrow}</p>}
        <h1 className="mt-2 text-3xl sm:text-4xl">{title}</h1>
        {intro && <p className="mt-4 max-w-prose text-lg text-navy-700">{intro}</p>}
        <div className="prose-de mt-8">{children}</div>
      </div>
    </div>
  );
}
