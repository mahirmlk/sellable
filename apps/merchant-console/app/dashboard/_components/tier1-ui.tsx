"use client";

// Tier-1 local fallback UI kit.
//
// A parallel agent owns components/dashboard/{page-header,empty-state,
// loading-skeleton,error-banner,data-table}.tsx, lib/csv.ts and
// lib/saved-views.ts. Those files were missing when these pages were built,
// so this module provides contract-compatible fallbacks with the exact prop
// shapes the task specifies:
//
//   PageHeader({title, subtitle?, actions?})
//   EmptyState({title, message, action?})
//   TableSkeleton({rows?})
//   ErrorBanner({message, onRetry?})
//   DataTable({children})
//   exportToCsv(filename, rows)          (in ./tier1-data)
//   useSavedViews(key)                   (in ./tier1-data)
//
// When the owned files land, swap these imports to those paths. The extra
// exports here (PartialBanner, FilterTabs, SavedViewsBar, StockBadge,
// ChannelBadge, AiBadge, RefreshButton) are tier-1-local helpers.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconRefresh, IconWarning } from "@/components/dashboard/icons";
import { SkeletonLine } from "@/components/dashboard/skeleton";
import { useSavedViews } from "./tier1-data";

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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">
          {title}
        </h1>
        {subtitle && (
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function RefreshButton({
  onRefresh,
  loading,
  label = "REFRESH",
}: {
  onRefresh: () => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50"
    >
      <IconRefresh size={12} className={loading ? "animate-spin" : ""} /> {label}
    </button>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-[var(--bb-line)] px-5 py-12 text-center">
      <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">
        {title}
      </div>
      <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)] leading-relaxed mt-2 max-w-[420px] mx-auto">
        {message}
      </div>
      {action && <div className="mt-5 flex items-center justify-center gap-3">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="border border-[var(--bb-line)] overflow-hidden" aria-label="Loading">
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
        <SkeletonLine className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`px-5 py-4 ${i < rows - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}
        >
          <div className="flex items-center gap-4">
            <SkeletonLine className="h-3 w-20" />
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-3 w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-red-400/30 bg-red-400/5 px-5 py-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-2.5">
        <IconWarning size={14} className="text-red-400 mt-0.5 shrink-0" />
        <span className="font-[var(--font-mono)] text-[0.62rem] text-red-400 leading-relaxed">
          {message}
        </span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-red-400 border border-red-400/40 px-3 py-1.5 hover:bg-red-400/10 transition-colors cursor-pointer"
        >
          RETRY
        </button>
      )}
    </div>
  );
}

/** Amber banner for partial failures: some sections loaded, others did not. */
export function PartialBanner({ message }: { message: string }) {
  return (
    <div className="border border-amber-400/30 bg-amber-400/[0.04] px-5 py-3 flex items-start gap-2.5">
      <IconWarning size={14} className="text-amber-400 mt-0.5 shrink-0" />
      <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400 leading-relaxed">
        {message}
      </span>
    </div>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return <div className="border border-[var(--bb-line)] overflow-hidden">{children}</div>;
}

export function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count?: number }>;
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all cursor-pointer ${
            active === t.key
              ? "border-[var(--bb-orange)] bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]"
              : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)]"
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 tabular-nums opacity-80">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function StockBadge({ stock, threshold }: { stock: number; threshold: number }) {
  if (stock <= 0)
    return (
      <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 text-red-400 bg-red-400/10 rounded-sm">
        OUT OF STOCK
      </span>
    );
  if (stock <= threshold)
    return (
      <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 text-amber-400 bg-amber-400/10 rounded-sm">
        LOW STOCK
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 text-green-400 bg-green-400/10 rounded-sm">
        IN STOCK
      </span>
  );
}

export function ChannelBadge({ channel }: { channel: "human_chat" | "agent_to_agent" }) {
  const isAi = channel === "agent_to_agent";
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 rounded-sm ${
        isAi ? "text-[var(--bb-orange)] bg-[var(--bb-orange-wash-2)]" : "text-[var(--bb-grey-2)] bg-[var(--bb-panel-2)]"
      }`}
    >
      {isAi ? "AI BUYER" : "HUMAN"}
    </span>
  );
}

export function AiBadge({ available }: { available: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${
        available ? "text-green-400" : "text-[var(--bb-grey-4)]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${available ? "bg-green-400" : "bg-[var(--bb-grey-4)]"}`} />
      {available ? "AI AVAILABLE" : "NOT AVAILABLE"}
    </span>
  );
}

export function ViewStoreLink() {
  return (
    <Link
      href="/dashboard/storefront"
      className="inline-flex items-center gap-2 h-[32px] px-3.5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
    >
      VIEW STORE
    </Link>
  );
}

/**
 * Local fallback for useSavedViews(key): named filter presets persisted to
 * localStorage. Rendered next to a toolbar; onApply receives the stored
 * state for the page to set.
 */
export function SavedViewsBar<T>({
  storageKey,
  current,
  onApply,
}: {
  storageKey: string;
  current: T;
  onApply: (state: T) => void;
}) {
  const { views, saveView, deleteView } = useSavedViews<T>(storageKey);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((v) => (
        <span
          key={v.name}
          className="inline-flex items-center gap-1 border border-[var(--bb-line)] bg-[var(--bb-panel)] pl-2.5 pr-1 py-1"
        >
          <button
            onClick={() => onApply(v.state)}
            className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] transition-colors cursor-pointer"
            title={`Apply saved view "${v.name}"`}
          >
            {v.name}
          </button>
          <button
            onClick={() => deleteView(v.name)}
            className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] hover:text-red-400 px-1 transition-colors cursor-pointer"
            aria-label={`Delete saved view ${v.name}`}
          >
            ×
          </button>
        </span>
      ))}
      {saving ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                saveView(name.trim(), current);
                setName("");
                setSaving(false);
              }
              if (e.key === "Escape") {
                setName("");
                setSaving(false);
              }
            }}
            className="h-[28px] w-[140px] font-[var(--font-mono)] text-[0.62rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
          />
          <button
            onClick={() => {
              if (name.trim()) saveView(name.trim(), current);
              setName("");
              setSaving(false);
            }}
            className="h-[28px] px-2.5 bg-[var(--bb-orange)] font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-black)] font-semibold hover:bg-[var(--bb-orange-bright)] transition-colors cursor-pointer"
          >
            SAVE
          </button>
        </span>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.08em] uppercase text-[var(--bb-grey-4)] hover:text-[var(--bb-white)] border border-dashed border-[var(--bb-grey-4)] px-2.5 py-1 transition-colors cursor-pointer"
        >
          + SAVE VIEW
        </button>
      )}
    </div>
  );
}
