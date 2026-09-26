"use client";

// Recharts time + status charts fed ONLY by the pure series math in
// ./charts (dailySeries / statusBuckets over real order records). No fake or
// mock data: zero-value days are real calendar days without sales, and when
// there is no data the callers render the existing EmptyState / ErrorBanner
// instead of mounting these components.
//
// Theming: series colors resolve through var(--color-*) (set per-chart by
// <ChartStyle> from the ChartConfig) and var(--c-hairline) for gridlines, so
// every chart flips with [data-theme="light"|"dark"]. Solid fills only — no
// translucency or blur in dashboard scope.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatPaise } from "@/lib/formatters";
import type { SeriesPoint, StatusBuckets } from "@/components/dashboard/charts";

/** Compact ₹ axis ticks: ₹900 · ₹12k · ₹4.2L (paise in, label out). */
export function formatAxisPaise(paise: number): string {
  const rupees = paise / 100;
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (rupees >= 100000) return `₹${trim(rupees / 100000)}L`;
  if (rupees >= 1000) return `₹${trim(rupees / 1000)}k`;
  return `₹${Math.round(rupees)}`;
}

export type TimeMetric = "revenue" | "orders";

interface TimeRow {
  /** Short axis label, e.g. "24 Aug" (from SeriesPoint.label). */
  day: string;
  /** Full date for the tooltip title — real bucket identity, never invented. */
  fullDate: string;
  revenue: number;
  orders: number;
}

const timeConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  orders: { label: "Orders", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Daily revenue (AreaChart) or orders (BarChart) over real calendar days.
 * Mount only when at least one point is non-zero — empty ranges are the
 * caller's EmptyState.
 */
export function SalesTimeChart({
  points,
  metric,
  rangeLabel,
}: {
  points: SeriesPoint[];
  metric: TimeMetric;
  rangeLabel: string;
}) {
  const data: TimeRow[] = points.map((p) => ({
    day: p.label,
    fullDate: new Date(p.dateMs).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    revenue: metric === "revenue" ? p.value : 0,
    orders: metric === "orders" ? p.value : 0,
  }));

  return (
    <ChartContainer
      config={timeConfig}
      className="aspect-auto h-[280px] min-h-[260px] w-full"
      role="img"
      aria-label={`Daily ${metric === "revenue" ? "revenue" : "orders"} per day over ${rangeLabel}`}
    >
      {metric === "revenue" ? (
        <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="salesRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--c-hairline)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            tickFormatter={formatAxisPaise}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_label, payload) => {
                  const first = payload?.[0] as
                    | { payload?: { fullDate?: unknown } }
                    | undefined;
                  const full = first?.payload?.fullDate;
                  return typeof full === "string" ? full : _label;
                }}
                formatter={(value) => formatPaise(Number(value))}
              />
            }
          />
          <Area
            dataKey="revenue"
            type="monotone"
            stroke="var(--color-revenue)"
            strokeWidth={2}
            fill="url(#salesRevenueFill)"
            fillOpacity={1}
          />
        </AreaChart>
      ) : (
        <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--c-hairline)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            allowDecimals={false}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_label, payload) => {
                  const first = payload?.[0] as
                    | { payload?: { fullDate?: unknown } }
                    | undefined;
                  const full = first?.payload?.fullDate;
                  return typeof full === "string" ? full : _label;
                }}
                formatter={(value) => {
                  const n = Number(value);
                  return `${n} order${n === 1 ? "" : "s"}`;
                }}
              />
            }
          />
          <Bar
            dataKey="orders"
            fill="var(--color-orders)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      )}
    </ChartContainer>
  );
}

const donutConfig = {
  paid: { label: "Paid", color: "var(--chart-2)" },
  open: { label: "Open", color: "var(--chart-3)" },
  failed: { label: "Failed", color: "var(--chart-5)" },
} satisfies ChartConfig;

interface DonutRow {
  status: keyof StatusBuckets;
  value: number;
}

/**
 * Orders-by-status donut over real order records in the selected window.
 * Mount only when the window holds at least one order — zero-count buckets
 * are dropped from the pie so the legend never shows invented slices.
 */
export function OrdersStatusDonut({ buckets }: { buckets: StatusBuckets }) {
  const data: DonutRow[] = (
    Object.entries(buckets) as Array<[keyof StatusBuckets, number]>
  )
    .filter(([, value]) => value > 0)
    .map(([status, value]) => ({ status, value }));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ChartContainer
      config={donutConfig}
      className="relative aspect-auto h-[240px] min-h-[220px] w-full"
    >
      <PieChart accessibilityLayer>
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              hideLabel
              formatter={(value) => {
                const n = Number(value);
                return `${n} order${n === 1 ? "" : "s"}`;
              }}
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="status"
          innerRadius={58}
          outerRadius={86}
          strokeWidth={2}
          stroke="var(--c-panel)"
        >
          {data.map((d) => (
            <Cell key={d.status} fill={`var(--color-${d.status})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="status" />} />
      </PieChart>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8"
      >
        <div className="text-[24px] font-semibold leading-none tabular-nums text-ink">
          {total}
        </div>
        <div className="mt-1 text-[12px] text-faint">
          order{total === 1 ? "" : "s"}
        </div>
      </div>
    </ChartContainer>
  );
}
