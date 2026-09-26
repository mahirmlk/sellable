"use client";

import type { ReactNode } from "react";

/* Page masthead — editorial display serif title over a muted lede,
   matching the golden-hour reference. Assumes .dashboard-app scope. */
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
        <h1 className="font-display text-[32px] sm:text-[38px] leading-[1.08] tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-muted">
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
