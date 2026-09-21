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
        <h1 className="text-[24px] sm:text-[28px] font-bold leading-tight tracking-[-0.02em] text-neutral-900">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-[46rem] text-[15px] leading-relaxed text-neutral-500">
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
