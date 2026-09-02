"use client";

// Renders a real backend component state. Colors are derived from the state the
// backend actually reports; a missing state (loading/unknown) is never shown as
// green, and failures are never collapsed into a hardcoded "Offline".

import type { ComponentState } from "@/lib/api";

const STATE_META: Record<ComponentState, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-green-500", text: "text-green-400" },
  UNCONFIGURED: { label: "Unconfigured", dot: "bg-yellow-400", text: "text-yellow-400" },
  DEGRADED: { label: "Degraded", dot: "bg-amber-400", text: "text-amber-400" },
  ERROR: { label: "Error", dot: "bg-red-400", text: "text-red-400" },
  OFFLINE: { label: "Offline", dot: "bg-red-400", text: "text-red-400" },
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
      <div className="flex items-center justify-between py-2 border-b border-[var(--bb-line-soft)] last:border-b-0">
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">{label}</span>
        <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">…</span>
      </div>
    );
  }
  const meta = STATE_META[state];
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--bb-line-soft)] last:border-b-0">
      <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">{label}</span>
      <span className="flex items-center gap-2" title={detail || undefined}>
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        <span className={`font-[var(--font-mono)] text-[0.65rem] ${meta.text}`}>
          {meta.label}
          {mode ? ` · ${mode}` : ""}
        </span>
      </span>
    </div>
  );
}