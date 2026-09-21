"use client";

// Commerce-specific shared UI (badges, tabs, toolbar buttons, saved views).
// Built on the canonical primitives in ./page-header, ./empty-state,
// ./loading-skeleton, ./error-banner, ./data-table and the lib helpers in
// @/lib/csv and @/lib/saved-views — anything generic lives there, not here.

import Link from "next/link";
import { useState } from "react";
import { IconRefresh, IconWarning } from "@/components/dashboard/icons";
import { useSavedViews } from "@/lib/saved-views";

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
          className="inline-flex items-center gap-1 border border-[var(--bb-line)] bg-[var(--bb-panel)] pl-2.5 pr-1 py-1"
        >
          <button
            onClick={() => onApply(v.value)}
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

