"use client";

// Commerce-specific shared UI (badges, tabs, toolbar buttons, saved views).
// Apple premium treatment: pill controls, soft badges, segmented tabs.

import Link from "next/link";
import { useState } from "react";
import { IconRefresh, IconWarning } from "@/components/dashboard/icons";
import { useSavedViews } from "@/lib/saved-views";

export function RefreshButton({
  onRefresh,
  loading,
  label = "Refresh",
}: {
  onRefresh: () => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow hover:bg-neutral-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
    >
      <IconRefresh size={14} className={loading ? "animate-spin" : ""} /> {label}
    </button>
  );
}

/** Amber banner for partial failures: some sections loaded, others did not. */
export function PartialBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl bg-amber-50/80 backdrop-blur-xl border border-amber-200/60 px-4 py-3 flex items-start gap-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <span className="flex items-center justify-center size-6 rounded-full bg-amber-100 shrink-0 mt-0.5" aria-hidden>
        <IconWarning size={13} className="text-amber-800" />
      </span>
      <span className="text-[13px] leading-relaxed text-amber-900">
        {message}
      </span>
    </div>
  );
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
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-black/[0.06] p-1" role="tablist" aria-label="Filters">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`h-8 px-4 rounded-full text-[13px] font-medium transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
            active === t.key
              ? "bg-white shadow-sm text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 tabular-nums text-[12px] opacity-70">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function StockBadge({ stock, threshold }: { stock: number; threshold: number }) {
  if (stock <= 0)
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none bg-red-50 text-red-700">
        Out of stock
      </span>
    );
  if (stock <= threshold)
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none bg-amber-50 text-amber-800">
        Low stock
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none bg-green-50 text-green-700">
      In stock
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: "human_chat" | "agent_to_agent" }) {
  const isAi = channel === "agent_to_agent";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${
        isAi ? "bg-[#fff4e5] text-[#b25e00]" : "bg-neutral-100 text-neutral-600"
      }`}
    >
      {isAi ? "AI buyer" : "Human"}
    </span>
  );
}

export function AiBadge({ available }: { available: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${
        available ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-500"
      }`}
    >
      <span className={`size-1.5 rounded-full ${available ? "bg-green-600" : "bg-neutral-400"}`} />
      {available ? "AI available" : "Not available"}
    </span>
  );
}

export function ViewStoreLink() {
  return (
    <Link
      href="/dashboard/storefront"
      className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-[#0071e3] text-[13px] font-semibold text-white shadow-sm hover:bg-[#0077ed] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
    >
      View store
    </Link>
  );
}

/**
 * Named filter presets persisted to localStorage (UI prefs only).
 * Rendered next to a toolbar; onApply receives the stored state.
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
  // Keep the legacy "mc-views:" prefix so views saved before the
  // canonical lib/saved-views.ts landed continue to load.
  const { getViews, saveView, deleteView } = useSavedViews<T>(`mc-views:${storageKey}`);
  const views = getViews();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((v) => (
        <span
          key={v.name}
          className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 shadow-sm pl-3.5 pr-1 py-1"
        >
          <button
            onClick={() => onApply(v.value)}
            className="text-[13px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
            title={`Apply saved view "${v.name}"`}
          >
            {v.name}
          </button>
          <button
            onClick={() => deleteView(v.name)}
            className="flex items-center justify-center size-6 rounded-full text-neutral-400 hover:text-red-600 hover:bg-black/[0.05] transition-colors cursor-pointer"
            aria-label={`Delete saved view ${v.name}`}
          >
            ×
          </button>
        </span>
      ))}
      {saving ? (
        <span className="inline-flex items-center gap-2">
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
            className="h-9 w-[160px] rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
          />
          <button
            onClick={() => {
              if (name.trim()) saveView(name.trim(), current);
              setName("");
              setSaving(false);
            }}
            className="h-9 px-4 rounded-full bg-neutral-900 text-[13px] font-medium text-white hover:bg-black transition-colors cursor-pointer active:scale-[0.98]"
          >
            Save
          </button>
        </span>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="text-[13px] font-medium text-neutral-400 hover:text-neutral-900 border border-dashed border-black/15 hover:border-black/25 rounded-full px-3.5 py-1.5 transition-colors cursor-pointer"
        >
          + Save view
        </button>
      )}
    </div>
  );
}
