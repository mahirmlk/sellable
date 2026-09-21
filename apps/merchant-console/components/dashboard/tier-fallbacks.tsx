"use client";

import type { ReactNode } from "react";

/**
 * Local section/tab helpers for the Tier-2/3 dashboard work.
 *
 * Shared primitives (PageHeader, EmptyState, TableSkeleton, ErrorBanner,
 * DataTable, exportToCsv, useSavedViews) are imported from their canonical
 * owner paths — components/dashboard/{page-header,empty-state,
 * loading-skeleton,error-banner,data-table} and lib/{csv,saved-views}.
 * Only Section/Tabs/PartialBanner live here; they have no canonical owner.
 */

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-[var(--bb-line)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between gap-3">
        <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          {title}
        </div>
        {hint && (
          <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] text-right">
            {hint}
          </div>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Non-blocking notice: part of the data failed while the rest rendered. */
export function PartialBanner({ message }: { message: string }) {
  return (
    <div className="border border-amber-400/30 bg-amber-400/5 px-5 py-3">
      <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{message}</span>
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all cursor-pointer ${
            value === o.value
              ? "border-[var(--bb-orange)] bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]"
              : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
