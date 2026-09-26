"use client";

// Analytics (route /dashboard/growth): real sales-over-time chart, top
// products, and the growth tabs (Overview / AI Sales / Negotiation /
// Upsells). The chart, top products, and every KPI delta/sparkline are
// derived from real order records returned by getConsoleTransactions() —
// when there is not enough history the section renders the existing empty
// states instead of invented numbers.

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { MetricCard, type MetricDelta } from "@/components/dashboard/metric-card";
import {
  comparePeriods,
  dailySeries,
  periodWindow,
  sparkSeries,
  statusBuckets,
  topProducts,
  totalsForPeriod,
  type MetricKey,
} from "@/components/dashboard/charts";
import {
  OrdersStatusDonut,
  SalesTimeChart,
} from "@/components/dashboard/sales-charts";
import { formatPaise } from "@/lib/formatters";
import {
  getConsoleCatalog,
  getConsoleInsights,
  getConsoleTransactions,
  type ConsoleGrowthMetrics,
  type ConsoleTransaction,
  type Product,
} from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  Section,
  Tabs,
} from "@/components/dashboard/tier-fallbacks";
import { RefreshButton } from "@/components/dashboard/commerce-ui";
import { exportToCsv } from "@/lib/csv";
import { toast } from "@/components/dashboard/toasts";

type Tab = "overview" | "ai" | "negotiation" | "upsells";
type PeriodKey = "7" | "30" | "90";
type ChartMetric = "revenue" | "orders";

const PERIOD_OPTIONS: Array<{ label: string; value: PeriodKey }> = [
  { label: "7d", value: "7" },
  { label: "30d", value: "30" },
  { label: "90d", value: "90" },
];

const CHART_OPTIONS: Array<{ label: string; value: ChartMetric }> = [
  { label: "Revenue", value: "revenue" },
  { label: "Orders", value: "orders" },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-panel-2 border border-black/[0.05] p-4">
      <div className="text-[13px] font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums text-neutral-900">{value}</div>
    </div>
  );
}

/** Compact pill switch (theme-aware classes only). */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ label: string; value: T }>;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-full bg-panel-3 border border-hairline p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent ${
            value === o.value ? "bg-ink text-panel" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function GrowthPage() {
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [orders, setOrders] = useState<ConsoleTransaction[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const requestGen = useRef(0);

  const fetchData = useCallback(async () => {
    const gen = ++requestGen.current;
    const alive = () => requestGen.current === gen;
    setLoading(true);
    setLoadError(null);
    const [insightsRes, txRes, catRes] = await Promise.allSettled([
      getConsoleInsights(),
      getConsoleTransactions(),
      getConsoleCatalog(),
    ]);
    if (!alive()) return;
    if (insightsRes.status === "fulfilled") {
      setGrowth(insightsRes.value);
    } else {
      setGrowth(null);
      setLoadError(
        insightsRes.reason instanceof TypeError
          ? "Backend unreachable — analytics could not be loaded."
          : "Analytics could not be loaded from the backend."
      );
    }
    // Sales history drives the chart, top products, and KPI deltas. On
    // failure those simply omit themselves — never zeros or fake trends.
    if (txRes.status === "fulfilled") {
      setOrders(txRes.value);
      setOrdersFailed(false);
    } else {
      setOrders([]);
      setOrdersFailed(true);
    }
    // Catalog only resolves SKU → title for top products; a failure falls
    // back to SKU labels and is not surfaced as a page error.
    setCatalog(catRes.status === "fulfilled" ? catRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      requestGen.current += 1;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const hasData = growth !== null && growth.total_orders > 0;
  const attachRate =
    growth && growth.upsell_offers > 0
      ? ((growth.upsell_accepted / growth.upsell_offers) * 100).toFixed(1)
      : "0";
  const aiShare =
    growth && growth.revenue > 0
      ? ((growth.agent_assisted_revenue / growth.revenue) * 100).toFixed(1)
      : "0";

  // --- Derived views (from real order records only) ---
  const days = Number(period);
  const win = periodWindow(days);
  const rangeLabel = `${new Date(win.startMs).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} – ${new Date(win.endMs - 1).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
  const series = ordersFailed ? [] : dailySeries(orders, { days, metric: chartMetric });
  const windowTotals = ordersFailed ? null : totalsForPeriod(orders, win.startMs, win.endMs);
  const hasRangeData = series.some((p) => p.value > 0);
  // Donut buckets from real order statuses in the same window. Rendered only
  // when the window holds at least one order — never an empty donut.
  const buckets = ordersFailed ? null : statusBuckets(orders, win.startMs, win.endMs);
  const statusTotal = buckets ? buckets.paid + buckets.open + buckets.failed : 0;
  const hasStatusData = statusTotal > 0;

  const top = ordersFailed
    ? []
    : topProducts(orders, { startMs: win.startMs, endMs: win.endMs, limit: 5 });
  const titleBySku = new Map(catalog.map((p) => [p.sku, p.title]));

  // CSV exports over the selected period's real daily series (both metrics,
  // regardless of the chart toggle) plus the top-products ranking.
  const handleExportSeries = useCallback(() => {
    if (ordersFailed) return;
    const revenue = dailySeries(orders, { days, metric: "revenue" });
    const counts = dailySeries(orders, { days, metric: "orders" });
    const rows = revenue.map((p, i) => ({
      date: new Date(p.dateMs).toLocaleDateString("en-CA"),
      revenue_inr: (p.value / 100).toFixed(2),
      orders: counts[i]?.value ?? 0,
    }));
    exportToCsv("analytics.csv", rows);
    toast({ tone: "success", title: "Exported analytics.csv", description: `${rows.length} rows` });
  }, [orders, ordersFailed, days]);

  const handleExportProducts = useCallback(() => {
    const rows = top.map((p) => ({
      sku: p.sku,
      title: titleBySku.get(p.sku) ?? p.sku,
      units: p.units,
      revenue_inr: (p.revenuePaise / 100).toFixed(2),
    }));
    exportToCsv("products_performance.csv", rows);
    toast({ tone: "success", title: "Exported products_performance.csv", description: `${rows.length} rows` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, catalog]);

  // KPI deltas: last 7 days vs the 7 before, computed from order history.
  // comparePeriods returns null without comparable history, which omits the
  // delta entirely (no zero-change arrows).
  const delta7 = (metric: MetricKey): MetricDelta | undefined => {
    const cmp = ordersFailed ? null : comparePeriods(orders, metric, 7);
    return cmp ? { pct: cmp.pct, goodDirection: "up", label: "vs prior 7 days" } : undefined;
  };
  const spark7 = (metric: MetricKey): number[] | undefined =>
    ordersFailed ? undefined : (sparkSeries(orders, metric, 7) ?? undefined);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Analytics"
        subtitle="Revenue analytics from your sales"
        actions={
          <>
            <button
              onClick={handleExportSeries}
              disabled={ordersFailed || series.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
            >
              <Download size={14} /> Export
            </button>
            <button
              onClick={handleExportProducts}
              disabled={top.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
              title="Export the top-products ranking for the selected period"
            >
              <Download size={14} /> Products
            </button>
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
          </>
        }
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {/* Sales over time — daily revenue (area) / orders (bars) from real
          order records, plus an orders-by-status donut from real statuses */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Sales over time" hint={rangeLabel}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-[13px] text-muted">
            Daily {chartMetric === "revenue" ? "revenue" : "orders"} · {PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? `${days} days`}
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              value={chartMetric}
              onChange={setChartMetric}
              options={CHART_OPTIONS}
              ariaLabel="Chart metric"
            />
            <Segmented
              value={period}
              onChange={setPeriod}
              options={PERIOD_OPTIONS}
              ariaLabel="Chart period in days"
            />
          </div>
        </div>
        {loading ? (
          <TableSkeleton rows={3} />
        ) : ordersFailed ? (
          <ErrorBanner
            message="Sales history could not be loaded — the chart needs order records."
            onRetry={() => void fetchData()}
          />
        ) : !hasRangeData ? (
          <EmptyState
            title={
              windowTotals && windowTotals.orders > 0
                ? "No sales recorded in this range."
                : "Not enough transaction data yet."
            }
            message={
              windowTotals && windowTotals.orders > 0
                ? `Orders exist in ${rangeLabel} but none are paid yet — switch to Orders or widen the range.`
                : "Analytics appear here once orders flow through your store — run a checkout in AI Sales or wait for AI buyers to purchase."
            }
          />
        ) : (
          <SalesTimeChart points={series} metric={chartMetric} rangeLabel={rangeLabel} />
        )}
      </Section>

      {!loading && !ordersFailed && buckets && hasStatusData ? (
        <Section title="Orders by status" hint={`${statusTotal} in range`}>
          <OrdersStatusDonut buckets={buckets} />
        </Section>
      ) : null}
      </div>

      {/* Top products — real line items of paid orders in the selected range */}
      <Section title="Top products" hint={`Top 5 by revenue · ${rangeLabel}`}>
        {loading ? (
          <TableSkeleton rows={3} />
        ) : ordersFailed ? (
          <ErrorBanner
            message="Sales history could not be loaded — product rankings need order records."
            onRetry={() => void fetchData()}
          />
        ) : top.length === 0 ? (
          <EmptyState
            title="Not enough transaction data yet."
            message="Units sold and revenue per product appear here once paid orders with line items land in the selected range."
          />
        ) : (
          <div>
            {top.map((p, i) => {
              const title = titleBySku.get(p.sku) ?? p.sku;
              return (
                <Link
                  key={p.sku}
                  href={`/dashboard/catalog/${p.sku}`}
                  className={`flex items-center justify-between gap-4 px-1 py-3 hover:bg-panel-2 transition-colors ${
                    i < top.length - 1 ? "border-b border-hairline" : ""
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="text-[13px] tabular-nums text-faint w-5 shrink-0" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="inline-flex items-center justify-center rounded-[14px] bg-panel-2 border border-hairline text-ink-2 font-medium overflow-hidden size-10 text-[15px] shrink-0" aria-hidden>
                      {title.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-ink truncate">{title}</div>
                      <div className="text-[12px] text-faint mt-0.5 tabular-nums truncate">
                        {p.units} unit{p.units === 1 ? "" : "s"} · {p.sku}
                      </div>
                    </div>
                  </div>
                  <div className="text-[14px] font-semibold text-ink tabular-nums shrink-0">
                    {formatPaise(p.revenuePaise)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { label: "Overview", value: "overview" },
          { label: "AI Sales", value: "ai" },
          { label: "Negotiation", value: "negotiation" },
          { label: "Upsells", value: "upsells" },
        ]}
      />

      {loading ? (
        <TableSkeleton rows={4} />
      ) : !hasData ? (
        <EmptyState
          title="Not enough transaction data yet."
          message="Analytics appear here once orders flow through your store — run a checkout in AI Sales or wait for AI buyers to purchase."
        />
      ) : (
        growth && (
          <>
            {tab === "overview" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="Revenue"
                  value={growth.revenue / 100}
                  prefix="₹"
                  decimals={2}
                  delta={delta7("revenue")}
                  spark={spark7("revenue")}
                />
                <MetricCard
                  label="Orders"
                  value={growth.total_orders}
                  delta={delta7("orders")}
                  spark={spark7("orders")}
                />
                <MetricCard
                  label="Avg order value"
                  value={growth.avg_order_value / 100}
                  prefix="₹"
                  decimals={2}
                  delta={delta7("aov")}
                  spark={spark7("aov")}
                />
                <MetricCard
                  label="AI-assisted revenue"
                  value={growth.agent_assisted_revenue / 100}
                  prefix="₹"
                  highlight
                  decimals={2}
                  delta={delta7("assisted")}
                  spark={spark7("assisted")}
                />
              </div>
            )}

            {tab === "ai" && (
              <Section title="AI sales" hint="Agent-assisted share of revenue">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Stat label="AI-assisted revenue" value={formatPaise(growth.agent_assisted_revenue)} />
                  <Stat label="Total revenue" value={formatPaise(growth.revenue)} />
                  <Stat label="AI share" value={`${aiShare}%`} />
                </div>
                <p className="mt-4 text-[14px] text-neutral-500 leading-relaxed">
                  Revenue from orders where the AI seller assisted discovery, quoting, negotiation, or checkout.
                </p>
              </Section>
            )}

            {tab === "negotiation" && (
              <Section title="Negotiation" hint="Accepted, countered and walked away">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Negotiations" value={String(growth.negotiations)} />
                  <Stat label="Accepted" value={String(growth.negotiated_accepted)} />
                  <Stat label="Countered" value={String(growth.countered)} />
                  <Stat label="Walked away" value={String(growth.walked_away)} />
                </div>
              </Section>
            )}

            {tab === "upsells" && (
              <Section title="Upsells" hint="Offers, accepted and attach rate">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Offers" value={String(growth.upsell_offers)} />
                  <Stat label="Accepted" value={String(growth.upsell_accepted)} />
                  <Stat label="Attach rate" value={`${attachRate}%`} />
                  <Stat label="Upsell revenue" value={formatPaise(growth.upsell_revenue)} />
                </div>
                <p className="mt-4 text-[12px] text-neutral-400">
                  Attach rate = accepted ÷ offers
                </p>
              </Section>
            )}
          </>
        )
      )}
    </div>
  );
}
