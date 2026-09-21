"use client";

import type { ReactNode } from "react";

export { PartialBanner } from "./commerce-ui";

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
    <section className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden">
      <div className="px-6 py-4 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">
          {title}
        </div>
        {hint && (
          <div className="text-[13px] text-neutral-500 text-right">
            {hint}
          </div>
        )}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
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
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-black/[0.06] p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const idx = options.findIndex((x) => x.value === value);
            const next = e.key === "ArrowRight" ? (idx + 1) % options.length : (idx - 1 + options.length) % options.length;
            onChange(options[next].value);
          }}
          className={`h-8 px-4 rounded-full text-[13px] font-medium transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
            value === o.value
              ? "bg-white shadow-sm text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
