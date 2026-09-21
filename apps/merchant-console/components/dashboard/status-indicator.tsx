"use client";

// Renders a real backend component state. Colors are derived from the state the
// backend actually reports; a missing state (loading/unknown) is never shown as
// green, and failures are never collapsed into a hardcoded "Offline".

import type { ComponentState } from "@/lib/api";

const STATE_META: Record<ComponentState, { label: string; dot: string; classes: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-[#1f9d55]", classes: "bg-green-50 text-green-700" },
  UNCONFIGURED: { label: "Unconfigured", dot: "bg-[#b25e00]", classes: "bg-amber-50 text-amber-800" },
  DEGRADED: { label: "Degraded", dot: "bg-[#b25e00]", classes: "bg-amber-50 text-amber-800" },
  ERROR: { label: "Error", dot: "bg-[#d92d20]", classes: "bg-red-50 text-red-700" },
  OFFLINE: { label: "Offline", dot: "bg-[#d92d20]", classes: "bg-red-50 text-red-700" },
};

interface Props {
  label: string;
  state?: ComponentState | null;
  detail?: string | null;
  mode?: string | null;
  loading?: boolean;
}

export function StatusIndicator({ label, state, detail, mode, loading }: Props) {
  if (loading || !state) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-black/[0.05] last:border-b-0">
        <span className="text-[13px] text-neutral-500">{label}</span>
        <span className="h-2.5 w-16 rounded-full bg-black/[0.06] animate-pulse" aria-label="Loading" />
      </div>
    );
  }
  const meta = STATE_META[state];
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-black/[0.05] last:border-b-0">
      <span className="text-[13px] text-neutral-500">{label}</span>
      <span className="flex items-center gap-2" title={detail || undefined}>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium leading-none ${meta.classes}`}>
          <span className={`size-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
          {mode ? ` · ${mode}` : ""}
        </span>
      </span>
    </div>
  );
}
