"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-[var(--font-sans)] text-[1.5rem] leading-tight tracking-[-0.02em] text-[var(--bb-white)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-[46rem] font-[var(--font-sans)] text-[0.875rem] leading-relaxed text-[var(--bb-grey-2)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
