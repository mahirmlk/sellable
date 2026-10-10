"use client";

import { Progress } from "@/components/ui/progress";

/* Labeled proportion rows built on the shadcn Progress primitive: pipeline
   stages, negotiation outcomes, channel mix. Single-accent restraint: the
   lead row may use the brand accent, every other row renders neutral ink.
   Widths are shares of the row's own total from real records. */

export interface FunnelRow {
  label: string;
  /** Formatted value, e.g. "₹1,240.00" or "12". */
  value: string;
  /** 0–100 share of the row total. */
  pct: number;
  caption?: string;
  /** First/primary row highlight. Only one accent per group. */
  accent?: boolean;
}

export function FunnelBars({ rows }: { rows: FunnelRow[] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, row.pct));
        return (
          <div
            key={row.label}
            className={row.accent ? "[&_[data-slot=progress-indicator]]:bg-accent-strong" : undefined}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted truncate">{row.label}</span>
              <span className="text-[14px] font-semibold tabular-nums text-ink shrink-0">
                {row.value}
              </span>
            </div>
            <Progress
              value={pct}
              aria-label={`${row.label}: ${row.value}`}
              className="mt-1.5"
            />
            {row.caption ? (
              <div className="mt-1 text-[12px] text-faint">{row.caption}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
