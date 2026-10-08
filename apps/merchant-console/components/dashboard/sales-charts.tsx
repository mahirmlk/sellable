"use client";

// Vercel-style interactive Recharts charts fed ONLY by the pure series math in
// ./charts (dailySeries / statusBuckets over real order records). No fake or
// mock data: zero-value days are real calendar days without sales, and when
// there is not enough real data the callers render the existing EmptyState /
// ErrorBanner instead of mounting these components.
//
// Design: shadcn Card header with an inline metric switcher (Revenue / Orders)
// like the shadcn interactive line chart, gradients + tooltip + legend from
// the ChartContainer family. Series colors resolve through var(--chart-1)
// via the config, gridlines through var(--c-hairline), and everything flips
// with [data-theme="light"|"dark"].

import * as React from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  /** ISO date for the axis (the chart reformats it per tick). */
  date: string;
  /** Full date for the tooltip title — real bucket identity, never invented. */
  fullDate: string;
  /** The series value the caller computed for this metric. */
  value: number;
}

function dailyFormatter(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function fullFormatter(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Daily sales chart in the shadcn interactive-card shape: header tile with the
 * live period total, area series when revenue is on display and bars when the
 * metric is order counts. Data comes straight from dailySeries over real
 * orders; the switcher only reshapes what is already in memory.
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
  const [activeMetric, setActiveMetric] = React.useState<TimeMetric>(metric);
  const isRevenue = activeMetric === "revenue";

  const series: TimeRow[] = React.useMemo(
    () =>
      points.map((p) => {
        const day = new Date(p.dateMs);
        return {
          date: day.toLocaleDateString("en-CA"),
          fullDate: day.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          value: p.value,
        };
      }),
    [points]
  );
  const periodTotal = series.reduce((sum, row) => sum + row.value, 0);

  const config = {
    value: { label: isRevenue ? "Revenue" : "Orders", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <Card className="py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pb-3 sm:pb-0">
          <CardTitle>{isRevenue ? "Revenue" : "Orders"}</CardTitle>
          <CardDescription>
            Daily {isRevenue ? "paid revenue" : "order counts"} for {rangeLabel}
          </CardDescription>
        </div>
        <div className="flex">
          {(
            [
              { key: "revenue" as const, label: "Revenue" },
              { key: "orders" as const, label: "Orders" },
            ]
          ).map((option) => {
            const isActive = activeMetric === option.key;
            return (
              <button
                key={option.key}
                data-active={isActive}
                className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-t-0 sm:border-l sm:px-8 sm:py-3"
                onClick={() => setActiveMetric(option.key)}
              >
                <span className="text-[12px] text-muted-foreground">{option.label}</span>
                <span className="text-[18px] leading-none font-semibold tabular-nums sm:text-[24px]">
                  {isActive
                    ? option.key === "revenue"
                      ? formatPaise(periodTotal)
                      : String(periodTotal)
                    : <span className="opacity-50">—</span>}
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer config={config} className="aspect-auto h-[250px] w-full">
          {activeMetric === "revenue" ? (
            <AreaChart accessibilityLayer data={series} margin={{ left: 12, right: 12 }}>
              <defs>
                <linearGradient id="fillSalesRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={dailyFormatter}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                tickFormatter={formatAxisPaise}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    className="w-[160px]"
                    indicator="dot"
                    labelFormatter={(value) => fullFormatter(String(value))}
                    formatter={(value) => formatPaise(Number(value))}
                  />
                }
              />
              <Area
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                strokeWidth={2}
                fill="url(#fillSalesRevenue)"
                fillOpacity={1}
              />
            </AreaChart>
          ) : (
            <BarChart accessibilityLayer data={series} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={dailyFormatter}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                allowDecimals={false}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    className="w-[140px]"
                    indicator="dot"
                    labelFormatter={(value) => fullFormatter(String(value))}
                    formatter={(value) => {
                      const n = Number(value);
                      return `${n} order${n === 1 ? "" : "s"}`;
                    }}
                  />
                }
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
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
