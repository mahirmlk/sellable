"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/dashboard/charts";
import { DeltaBadge, type MetricDelta } from "@/components/dashboard/metric-card";

/* KPI card — shadcn Card composition with a restrained hierarchy: 13px muted
   label, 26px semibold tabular value, delta + sparkline row, muted caption.
   Values stay neutral ink; only the delta glyph carries good/bad color (plus
   a screen-reader sentence), so four cards scan without shouting. */
export function KpiCard({
  label,
  value,
  caption,
  delta,
  spark,
}: {
  label: string;
  value: string;
  caption?: string;
  /** Period-over-period change from real order history (omit when unknown). */
  delta?: MetricDelta;
  /** Daily trend points for the sparkline (omit when too thin). */
  spark?: number[];
}) {
  return (
    <Card size="sm" className="shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-lift">
      <CardContent>
        <div className="text-[13px] font-medium text-muted mb-2 truncate">{label}</div>
        <div className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {value}
        </div>
        {delta || (spark && spark.length > 0) ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            {delta ? <DeltaBadge delta={delta} /> : <span aria-hidden="true" />}
            {spark && spark.length > 0 ? (
              <div className="w-[92px] shrink-0 text-ink-2">
                <Sparkline points={spark} ariaLabel={`${label} trend, previous and current period`} />
              </div>
            ) : null}
          </div>
        ) : null}
        {caption ? (
          <div className="text-[12px] text-faint mt-2 truncate">{caption}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
