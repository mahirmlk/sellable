import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Sparkline } from "@/components/dashboard/charts";

export interface MetricDelta {
  /** Percentage change vs the comparison period (unrounded). */
  pct: number;
  /** Which direction is healthy for this metric. */
  goodDirection: "up" | "down";
  /** Comparison window, e.g. "vs prior 7 days". */
  label?: string;
}

/**
 * ▲/▼ + pct for a metric delta. The glyph (plus a screen-reader sentence)
 * carries the meaning — colour never stands alone. Green/red only reflect
 * whether the move is healthy for this metric's goodDirection.
 */
export function DeltaBadge({ delta }: { delta: MetricDelta }) {
  const rising = delta.pct >= 0;
  const good = delta.goodDirection === "up" ? rising : !rising;
  const pct = Math.abs(delta.pct);
  const versus = delta.label ?? "versus the previous period";
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span
        aria-hidden="true"
        className={`tabular-nums text-[12px] font-medium ${good ? "text-green-700" : "text-red-700"}`}
      >
        {rising ? "▲" : "▼"} {pct.toFixed(1)}%
      </span>
      <span className="sr-only">
        {pct === 0
          ? `No change ${versus}`
          : `${rising ? "Up" : "Down"} ${pct.toFixed(1)} percent ${versus}`}
      </span>
      {delta.label ? (
        <span className="truncate text-[11px] text-faint">{delta.label}</span>
      ) : null}
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  highlight?: boolean;
  // Decimal places for money cards — paise-exact instead of whole rupees.
  decimals?: number;
  sub?: string;
  /** Period-over-period change from real order history (omit when unknown). */
  delta?: MetricDelta;
  /** Daily trend points (current + previous period) for the sparkline. */
  spark?: number[];
}

export function MetricCard({
  label,
  value,
  prefix = "",
  suffix = "",
  highlight = false,
  decimals = 0,
  sub,
  delta,
  spark,
}: MetricCardProps) {
  return (
    <div className="group rounded-[18px] bg-card text-card-foreground border border-hairline shadow-card p-5 transition-all duration-200 hover:-translate-y-px hover:shadow-lift focus-within:outline-2 focus-within:outline-ink">
      <div className="text-[13px] font-medium text-muted mb-2 truncate">
        {label}
      </div>
      <div
        aria-live="polite"
        className={`font-semibold text-[28px] leading-none tracking-tight tabular-nums ${
          highlight ? "text-accent-strong" : "text-ink"
        }`}
      >
        {prefix}
        <AnimatedCounter target={value} duration={600} decimals={decimals} />
        {suffix}
      </div>
      {delta || (spark && spark.length > 0) ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          {delta ? <DeltaBadge delta={delta} /> : <span aria-hidden="true" />}
          {spark && spark.length > 0 ? (
            <div className={`w-[92px] shrink-0 ${highlight ? "text-accent-strong" : "text-ink-2"}`}>
              <Sparkline points={spark} ariaLabel={`${label} trend, previous and current period`} />
            </div>
          ) : null}
        </div>
      ) : null}
      {sub ? (
        <div className="mt-1.5 text-[13px] text-faint truncate">{sub}</div>
      ) : null}
    </div>
  );
}
