"use client";

import { useState } from "react";
import { Archive, History, Plus, Trash2 } from "lucide-react";
import { formatPaise, formatTimeAgo } from "@/lib/formatters";
import type { CheckoutSessionListItem } from "@/lib/api";

/** Human title for a lightweight row: stored title, else the buyer request, else a short id. */
export function historyTitle(s: CheckoutSessionListItem): string {
  const stored = (s.title ?? "").trim();
  if (stored) return stored;
  const msg = (s.message ?? "").trim();
  if (msg) return msg.length > 52 ? `${msg.slice(0, 52)}…` : msg;
  return `Session ${s.session_id.slice(0, 8)}`;
}

type ChipTone = "green" | "amber" | "red" | "grey" | "orange";

/** Status chip derived from session status + linked order state (both optional). */
export function historyChip(s: CheckoutSessionListItem): { label: string; tone: ChipTone } {
  const order = (s.order_status ?? "").toUpperCase();
  if (order === "PAID" || order === "FULFILLED") return { label: order, tone: "green" };
  if (order === "REFUNDED") return { label: "REFUNDED", tone: "green" };
  if (order === "PAYMENT_FAILED") return { label: "FAILED", tone: "red" };
  if (order === "ABORTED") return { label: "ABORTED", tone: "red" };
  if (order === "PAYMENT_PENDING" || order === "CONSENTED" || order === "AWAITING_CONSENT") {
    return { label: "IN PAYMENT", tone: "amber" };
  }
  switch (s.status) {
    case "COMPLETED":
      return { label: "DONE", tone: "green" };
    case "ORDER_PLACED":
      return { label: "ORDER", tone: "amber" };
    case "ABANDONED":
      return { label: "CLOSED", tone: "grey" };
    default:
      return { label: "ACTIVE", tone: "orange" };
  }
}

const CHIP_TONES: Record<ChipTone, string> = {
  green: "text-green-600 border-green-600/20 bg-green-50",
  amber: "text-amber-600 border-amber-600/20 bg-amber-50",
  red: "text-red-600 border-red-600/20 bg-red-50",
  grey: "text-neutral-600 border-black/[0.06] bg-neutral-100",
  orange: "text-ink border-hairline bg-ink/5",
};

/**
 * One history row. The wrapper classes here are the canonical row dimensions —
 * HistorySkeletonRow below reuses this exact shell so loading and loaded rows
 * are pixel-identical (no layout shift when the list resolves).
 */
export const HISTORY_ROW_CLASS =
  "group relative w-full text-left px-4 py-3 border-b border-black/[0.05] transition-colors";

function HistoryChip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span
      className={`inline-flex items-center h-5 px-2 rounded-full border text-[11px] font-medium ${CHIP_TONES[tone]}`}
    >
      {label}
    </span>
  );
}

function HistorySkeletonRow() {
  // Mirrors the real row block (two-line clamped title + time/chip row) so
  // rows do not shift when the list resolves.
  return (
    <div className={`${HISTORY_ROW_CLASS} animate-pulse`} aria-hidden="true">
      <div className="mb-1.5 pr-14 space-y-1.5">
        <div className="h-[13px] w-11/12 rounded-md bg-neutral-100 border border-black/[0.05]" />
        <div className="h-[13px] w-2/3 rounded-md bg-neutral-100 border border-black/[0.05]" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-[12px] w-24 rounded-md bg-neutral-100 border border-black/[0.05]" />
        <div className="h-5 w-14 rounded-full bg-neutral-100 border border-black/[0.05]" />
      </div>
    </div>
  );
}

export interface ChatHistoryProps {
  sessions: CheckoutSessionListItem[];
  loading: boolean;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onArchive: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
}

export default function ChatHistory({
  sessions,
  loading,
  activeSessionId,
  onSelect,
  onNew,
  onArchive,
  onDelete,
  showArchived,
  onToggleArchived,
}: ChatHistoryProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const archivedCount = sessions.filter((s) => s.archived).length;
  const visible = showArchived ? sessions : sessions.filter((s) => !s.archived);

  const runAction = async (id: string, fn: (sid: string) => void | Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="hidden lg:flex w-[300px] shrink-0 flex-col min-h-0 border-r border-black/[0.06] bg-white">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-black/[0.06] flex items-center justify-between flex-shrink-0">
        <span className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.52rem] tracking-[0.16em] uppercase text-neutral-600">
          <History size={11} /> HISTORY
        </span>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 bg-ink text-white text-[13px] hover:bg-ink-2 transition-colors cursor-pointer font-medium rounded-full"
        >
          <Plus size={11} /> NEW SESSION
        </button>
      </div>

      {/* Session list — independently scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <HistorySkeletonRow key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-neutral-600 mb-2">
              No previous chats
            </div>
            <div className="font-[var(--font-sans)] text-[0.72rem] text-neutral-400 leading-relaxed">
              {archivedCount > 0 && !showArchived
                ? "All sessions are archived. Toggle below to reveal them."
                : "Your checkout sessions will appear here."}
            </div>
          </div>
        ) : (
          visible.map((s) => {
            const chip = historyChip(s);
            const amount = s.amount_paise ?? s.budget_paise ?? null;
            const isActive = s.session_id === activeSessionId;
            const isBusy = busyId === s.session_id;
            return (
              <div key={s.session_id} className="relative group">
                <button
                  onClick={() => {
                    if (!isActive && !busyId) onSelect(s.session_id);
                  }}
                  disabled={isBusy}
                  className={`${HISTORY_ROW_CLASS} cursor-pointer disabled:cursor-wait ${
                    isActive
                      ? "bg-ink/5 border-l-2 border-l-ink"
                      : "hover:bg-neutral-50 border-l-2 border-l-transparent"
                  }`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5 pr-14">
                    <span className="text-[14px] text-neutral-900 leading-snug line-clamp-2">
                      {historyTitle(s)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-[var(--font-mono)] text-[0.55rem] text-neutral-600 tabular-nums">
                      {formatTimeAgo(s.updated_at)}
                      {amount !== null && amount > 0 ? ` · ${formatPaise(amount)}` : ""}
                    </span>
                    <HistoryChip label={chip.label} tone={chip.tone} />
                  </div>
                </button>
                {/* Hover actions */}
                <span className="absolute top-2.5 right-2.5 hidden group-hover:inline-flex group-focus-within:inline-flex items-center gap-1">
                  <button
                    onClick={() => void runAction(s.session_id, onArchive)}
                    disabled={isBusy}
                    title="Archive session"
                    aria-label={`Archive ${historyTitle(s)}`}
                    className="inline-flex items-center justify-center size-6 border border-black/[0.06] bg-white text-neutral-600 hover:text-neutral-900 hover:border-black/[0.12] transition-colors cursor-pointer disabled:opacity-50 rounded-full"
                  >
                    <Archive size={11} />
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this chat from history? The order and ledger entries are kept — only the chat entry is hidden."
                        )
                      ) {
                        void runAction(s.session_id, onDelete);
                      }
                    }}
                    disabled={isBusy}
                    title="Delete session"
                    aria-label={`Delete ${historyTitle(s)}`}
                    className="inline-flex items-center justify-center size-6 border border-black/[0.06] bg-white text-neutral-600 hover:text-red-600 hover:border-red-600/30 transition-colors cursor-pointer disabled:opacity-50 rounded-full"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Archived toggle */}
      {!loading && archivedCount > 0 && (
        <div className="px-4 py-2.5 border-t border-black/[0.06] flex-shrink-0">
          <button
            onClick={onToggleArchived}
            className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            {showArchived ? "HIDE ARCHIVED" : `SHOW ARCHIVED (${archivedCount})`}
          </button>
        </div>
      )}
    </aside>
  );
}
