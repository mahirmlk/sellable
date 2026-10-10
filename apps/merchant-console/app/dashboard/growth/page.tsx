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
import { MetricCard, DeltaBadge, type MetricDelta } from "@/components/dashboard/metric-card";
import { FunnelBars } from "@/components/dashboard/funnel-bar";
import { Sparkline } from "@/components/dashboard/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  channelSplit,
  comparePeriods,
  dailySeries,
  periodWindow,
  sparkSeries,
  statusBuckets,
  topProducts,
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-panel-2 border border-hairline p-4">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums text-ink">{value}</div>
    </div>
  );
}

export default function GrowthPage() {
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [orders, setOrders] = useState<ConsoleTransaction[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [period] = useState<PeriodKey>("30");
  const [chartMetric] = useState<ChartMetric>("revenue");
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
  })} – ${new Date(win.endMs - 1).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
  const series = ordersFailed ? [] : dailySeries(orders, { days, metric: chartMetric });
  // Donut buckets from real order statuses in the same window. Rendered only
  // when the window holds at least one order — never an empty donut.
  const buckets = ordersFailed ? null : statusBuckets(orders, win.startMs, win.endMs);
  const statusTotal = buckets ? buckets.paid + buckets.open + buckets.failed : 0;
  const hasStatusData = statusTotal > 0;

  const top = ordersFailed
    ? []
    : topProducts(orders, { startMs: win.startMs, endMs: win.endMs, limit: 5 });
  const titleBySku = new Map(catalog.map((p) => [p.sku, p.title]));

  // Buyer mix in the selected range from real order channels, plus the
  // all-time negotiation / upsell outcomes from growth metrics.
  const mix = ordersFailed ? null : channelSplit(orders, win.startMs, win.endMs);
  const mixTotal = mix ? mix.aiOrders + mix.humanOrders : 0;
  const negotiationRows =
    growth && growth.negotiations > 0
      ? [
          {
            label: "Accepted",
            value: String(growth.negotiated_accepted),
            pct: (growth.negotiated_accepted / growth.negotiations) * 100,
            accent: true as const,
          },
          {
            label: "Countered",
            value: String(growth.countered),
            pct: (growth.countered / growth.negotiations) * 100,
          },
          {
            label: "Walked away",
            value: String(growth.walked_away),
            pct: (growth.walked_away / growth.negotiations) * 100,
          },
        ]
      : null;
  const upsellRows =
    growth && growth.upsell_offers > 0
      ? [
          {
            label: "Accepted",
            value: `${growth.upsell_accepted} · ${attachRate}% attach`,
            pct: (growth.upsell_accepted / growth.upsell_offers) * 100,
            accent: true as const,
          },
          {
            label: "Declined",
            value: String(growth.upsell_offers - growth.upsell_accepted),
            pct:
              ((growth.upsell_offers - growth.upsell_accepted) / growth.upsell_offers) * 100,
          },
        ]
      : null;

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            Trends
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Analytics
          </h1>
          <p className="mt-1 max-w-[46rem] text-[13px] leading-relaxed text-muted">
            Revenue, order flow, and product performance, computed from your order history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {/* KPI row — same Card family as the interactive chart below */}
      {!loading && !loadError && growth && hasData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(
            [
              { key: "revenue" as const, label: "Revenue", tile: formatPaise(growth.revenue) },
              { key: "orders" as const, label: "Orders", tile: String(growth.total_orders) },
              {
                key: "aov" as const,
                label: "Avg order value",
                tile: formatPaise(growth.avg_order_value),
              },
              {
                key: "assisted" as const,
                label: "AI-assisted revenue",
                tile: formatPaise(growth.agent_assisted_revenue),
              },
            ]
          ).map((card) => (
            <Card key={card.key} className="py-0">
              <CardHeader className="flex flex-col items-stretch border-b !p-0">
                <div className="flex flex-1 flex-col justify-center gap-1 px-5 py-4">
                  <CardTitle className="text-[13px] font-medium text-muted">
                    {card.label}
                  </CardTitle>
                  <span className="text-[24px] leading-none font-semibold tabular-nums text-ink">
                    {card.tile}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-4 pt-3 pb-2">
                <div className="w-full text-ink-2">
                  <Sparkline
                    points={spark7(card.key) ?? []}
                    ariaLabel={`${card.label} trend, previous and current period`}
                  />
                </div>
                  {(() => {
                    const delta = delta7(card.key);
                    return delta ? (
                      <div className="pt-2">
                        <DeltaBadge delta={delta} />
                      </div>
                    ) : null;
                  })()}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Sales over time — daily revenue (area) / orders (bars) from real
          order records, plus an orders-by-status donut from real statuses */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
      <SalesTimeChart points={series} metric={chartMetric} rangeLabel={rangeLabel} />

      {!loading && !ordersFailed && buckets && hasStatusData ? (
        <Section title="Orders by status" hint={`${statusTotal} in range`}>
          <OrdersStatusDonut buckets={buckets} />
        </Section>
      ) : null}
      </div>

      {/* Top products — real line items of paid orders in the selected range */}
      <Section
        title="Top products"
        hint={`Top 5 by revenue · ${rangeLabel}`}
        description="Ranked by line-item revenue in paid orders."
      >
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

      {/* Buyer channels + outcome funnels — who buys and how deals close */}
      {!loading && !ordersFailed && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title="Buyer channels"
            hint={rangeLabel}
            description="Human chat vs AI-buyer orders in the selected range."
          >
            {mixTotal === 0 ? (
              <EmptyState
                title="No orders in this range."
                message="Channel mix appears here once orders land in the selected period."
              />
            ) : (
              mix && (
                <FunnelBars
                  rows={[
                    {
                      label: "AI buyers",
                      value: `${mix.aiOrders} order${mix.aiOrders === 1 ? "" : "s"}`,
                      pct: (mix.aiOrders / mixTotal) * 100,
                      caption: `${formatPaise(mix.aiRevenuePaise)} paid revenue`,
                      accent: true,
                    },
                    {
                      label: "Human chat",
                      value: `${mix.humanOrders} order${mix.humanOrders === 1 ? "" : "s"}`,
                      pct: (mix.humanOrders / mixTotal) * 100,
                      caption: `${formatPaise(mix.humanRevenuePaise)} paid revenue`,
                    },
                  ]}
                />
              )
            )}
          </Section>

          <Section
            title="Negotiation & upsell outcomes"
            hint="All-time"
            description="Where price talks and add-on offers ended."
          >
            {!growth || (growth.negotiations === 0 && growth.upsell_offers === 0) ? (
              <EmptyState
                title="No negotiations yet."
                message="Outcomes appear here once buyers negotiate or receive upsell offers."
              />
            ) : (
              <div className="space-y-6">
                {negotiationRows && (
                  <div>
                    <div className="text-[12px] font-medium text-muted mb-3">
                      Negotiations · {growth.negotiations} total
                    </div>
                    <FunnelBars rows={negotiationRows} />
                  </div>
                )}
                {upsellRows && (
                  <div>
                    <div className="text-[12px] font-medium text-muted mb-3">
                      Upsells · {growth.upsell_offers} offers
                    </div>
                    <FunnelBars rows={upsellRows} />
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

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
              <Section
                title="AI sales"
                hint="Agent-assisted share of revenue"
                description="Orders where the AI Seller helped with discovery, quoting, negotiation, or checkout."
              >
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
              <Section
                title="Negotiation"
                hint="Accepted, countered and walked away"
                description="Each negotiation and how it ended."
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Negotiations" value={String(growth.negotiations)} />
                  <Stat label="Accepted" value={String(growth.negotiated_accepted)} />
                  <Stat label="Countered" value={String(growth.countered)} />
                  <Stat label="Walked away" value={String(growth.walked_away)} />
                </div>
              </Section>
            )}

            {tab === "upsells" && (
              <Section
                title="Upsells"
                hint="Offers, accepted and attach rate"
                description="Add-on offers and how often buyers accepted."
              >
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
