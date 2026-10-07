"use client";

// Home (route /dashboard): greeting header, real sales figures, order
// pipeline, buyer channels, store health, needs-attention aggregation, pending
// approvals, recent orders, recent activity, AI snapshot.
// Every figure is derived from loaded API records; on load failure the metric
// shows "—" with a partial-failure banner instead of a fabricated zero.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { formatPaise, formatPaiseDecimal, formatTimeAgo, formatTimestamp } from "@/lib/formatters";
import {
  getConsoleApprovals,
  getConsoleCatalog,
  getConsoleEvents,
  getConsoleInsights,
  getConsoleTransactions,
  getStore,
  type ConsoleApproval,
  type ConsoleGrowthMetrics,
  type ConsoleTransaction,
  type LedgerEvent,
  type Product,
  type StoreInfo,
} from "@/lib/api";
import { type MetricDelta } from "@/components/dashboard/metric-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { FunnelBars } from "@/components/dashboard/funnel-bar";
import { GettingStarted, type SetupStep } from "@/components/dashboard/getting-started";
import {
  channelSplit,
  comparePeriods,
  dailySeries,
  periodWindow,
  sparkSeries,
  type MetricKey,
} from "@/components/dashboard/charts";
import { SalesTimeChart } from "@/components/dashboard/sales-charts";
import { IconWarning } from "@/components/dashboard/icons";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  PartialBanner,
  RefreshButton,
  StockBadge,
  ViewStoreLink,
} from "@/components/dashboard/commerce-ui";
import {
  LOW_STOCK_THRESHOLD,
  isFailedPayment,
  isOpenOrder,
  mapConsoleTx,
  stockState,
} from "@/lib/commerce-view";
import type { Transaction } from "@/lib/types/domain";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function paymentModeLabel(provider: string, mode: string): string {
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
  return `${cap(provider)} ${cap(mode)} Mode`;
}

export default function OverviewPage() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [storeFailed, setStoreFailed] = useState(false);
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [growthFailed, setGrowthFailed] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Raw wire orders kept for the KPI delta/sparkline math (created_at + items).
  const [rawOrders, setRawOrders] = useState<ConsoleTransaction[]>([]);
  const [txFailed, setTxFailed] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ConsoleApproval[]>([]);
  const [approvalsFailed, setApprovalsFailed] = useState(false);
  const [recentEvents, setRecentEvents] = useState<
    Array<{ id: string; time: string; label: string; type: "info" | "success" | "error" | "warning" }>
  >([]);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);
  const { data: agentsStatus, error: statusError, reload: reloadStatus } = useSystemStatus();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setAllFailed(false);
    const [storeRes, growthRes, txRes, apprRes, eventRes, catRes] = await Promise.allSettled([
      getStore(),
      getConsoleInsights(),
      getConsoleTransactions(),
      getConsoleApprovals(),
      getConsoleEvents(8),
      getConsoleCatalog(),
    ]);
    let failures = 0;
    if (storeRes.status === "fulfilled") {
      setStore(storeRes.value);
      setStoreFailed(false);
    } else {
      setStore(null);
      setStoreFailed(true);
      failures += 1;
    }
    if (growthRes.status === "fulfilled") {
      setGrowth(growthRes.value);
      setGrowthFailed(false);
    } else {
      setGrowth(null);
      setGrowthFailed(true);
      failures += 1;
    }
    if (txRes.status === "fulfilled") {
      setTransactions(txRes.value.map(mapConsoleTx));
      setRawOrders(txRes.value);
      setTxFailed(false);
    } else {
      setTransactions([]);
      setRawOrders([]);
      setTxFailed(true);
      failures += 1;
    }
    if (apprRes.status === "fulfilled") {
      setPendingApprovals(apprRes.value.filter((a) => a.status === "PENDING"));
      setApprovalsFailed(false);
    } else {
      setPendingApprovals([]);
      setApprovalsFailed(true);
      failures += 1;
    }
    if (eventRes.status === "fulfilled" && eventRes.value.events) {
      setRecentEvents(
        eventRes.value.events.map((e: LedgerEvent) => {
          let type: "info" | "success" | "error" | "warning" = "info";
          if (e.action.includes("captured") || e.action.includes("paid") || e.action.includes("allowed"))
            type = "success";
          else if (e.action.includes("failed") || e.action.includes("aborted")) type = "error";
          else if (e.action.includes("rejected") || e.action.includes("denied")) type = "warning";
          return {
            id: e.event_id,
            time: formatTimestamp(e.timestamp),
            label: `${e.actor} — ${e.action}`,
            type,
          };
        })
      );
      setEventsFailed(false);
    } else {
      setRecentEvents([]);
      setEventsFailed(true);
      failures += 1;
    }
    if (catRes.status === "fulfilled") {
      setCatalog(catRes.value);
      setCatalogFailed(false);
    } else {
      setCatalog([]);
      setCatalogFailed(true);
      failures += 1;
    }
    setAllFailed(failures === 6);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const partialFailed = storeFailed || growthFailed || txFailed || approvalsFailed || eventsFailed || catalogFailed;

  // --- Derived views (presentation-only, from loaded records) ---
  const ordersCount = growth && !growthFailed ? growth.total_orders : txFailed ? null : transactions.length;
  const revenue = growth && !growthFailed ? growth.revenue : null;
  const assisted = growth && !growthFailed ? growth.agent_assisted_revenue : null;
  const aov =
    growth && !growthFailed
      ? growth.total_orders > 0
        ? growth.revenue / growth.total_orders
        : 0
      : null;
  const assistedPct = revenue !== null && revenue > 0 && assisted !== null ? Math.round((assisted / revenue) * 100) : null;

  const failedPayments = txFailed ? null : transactions.filter(isFailedPayment).length;
  const openOrders = txFailed ? null : transactions.filter(isOpenOrder);
  const paidCount = txFailed
    ? null
    : transactions.filter((t) => t.status === "PAID" || t.status === "FULFILLED").length;
  const lowStock = catalogFailed ? null : catalog.filter((p) => stockState(p.stock) === "low").length;
  const outOfStock = catalogFailed ? null : catalog.filter((p) => stockState(p.stock) === "out").length;

  const needsAttention: Array<{ label: string; detail: string; href: string }> = [];
  if (!approvalsFailed && pendingApprovals.length > 0)
    needsAttention.push({
      label: `${pendingApprovals.length} order${pendingApprovals.length > 1 ? "s" : ""} awaiting approval`,
      detail: `Highest ${formatPaise(Math.max(...pendingApprovals.map((a) => a.amount_paise)))}`,
      href: "/dashboard/approvals",
    });
  if (failedPayments !== null && failedPayments > 0)
    needsAttention.push({
      label: `${failedPayments} failed payment${failedPayments > 1 ? "s" : ""}`,
      detail: "Review and retry from the order",
      href: "/dashboard/transactions",
    });
  if (outOfStock !== null && outOfStock > 0)
    needsAttention.push({
      label: `${outOfStock} product${outOfStock > 1 ? "s" : ""} out of stock`,
      detail: "The AI Seller cannot sell these until restocked",
      href: "/dashboard/inventory",
    });
  else if (lowStock !== null && lowStock > 0)
    needsAttention.push({
      label: `${lowStock} product${lowStock > 1 ? "s" : ""} running low`,
      detail: `Stock at or below ${LOW_STOCK_THRESHOLD} units`,
      href: "/dashboard/inventory",
    });
  if (openOrders !== null && openOrders.length > 0)
    needsAttention.push({
      label: `${openOrders.length} open order${openOrders.length > 1 ? "s" : ""}`,
      detail: "Awaiting consent or payment",
      href: "/dashboard/transactions",
    });

  const recentOrders = [...transactions]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 5);

  const rail = agentsStatus?.payment_rail;
  const paymentLabel = rail
    ? rail.configured
      ? paymentModeLabel(rail.provider, rail.mode)
      : "Payments not set up"
    : null;

  const health: Array<{ label: string; state: string | null; ready: boolean | null }> = agentsStatus
    ? [
        { label: "AI Seller", state: agentsStatus.seller_agent.state, ready: agentsStatus.seller_agent.state === "CONNECTED" },
        { label: "Storefront", state: agentsStatus.agent_gateway.state, ready: agentsStatus.agent_gateway.state === "CONNECTED" },
        { label: "Payments", state: agentsStatus.payment_rail.state, ready: agentsStatus.payment_rail.state === "CONNECTED" },
        { label: "Policy", state: agentsStatus.policy_engine.state, ready: agentsStatus.policy_engine.state === "CONNECTED" },
        { label: "Ledger", state: agentsStatus.ledger.state, ready: agentsStatus.ledger.state === "CONNECTED" },
      ]
    : [];

  const upsellRate =
    growth && !growthFailed && growth.upsell_offers > 0
      ? Math.round((growth.upsell_accepted / growth.upsell_offers) * 100)
      : null;

  // KPI deltas: last 7 days vs the 7 before, computed from real order
  // history. comparePeriods returns null without comparable history, so the
  // delta is omitted entirely (no zeros, no fake arrows); the sparkline is
  // the daily trend over both periods.
  const metricDelta = (metric: MetricKey): MetricDelta | undefined => {
    const cmp = txFailed ? null : comparePeriods(rawOrders, metric, 7);
    return cmp ? { pct: cmp.pct, goodDirection: "up", label: "vs prior 7 days" } : undefined;
  };
  const metricSpark = (metric: MetricKey): number[] | undefined =>
    txFailed ? undefined : (sparkSeries(rawOrders, metric, 7) ?? undefined);

  // Compact 14-day revenue trend from real order records. Mounts the chart
  // only when at least one day sold — otherwise the EmptyState below.
  const trend14 = txFailed ? [] : dailySeries(rawOrders, { days: 14, metric: "revenue" });
  const hasTrend = trend14.some((p) => p.value > 0);

  // Buyer mix over the last 30 days from real order channels. Hidden when
  // the window holds no orders.
  const win30 = periodWindow(30);
  const mix = txFailed ? null : channelSplit(rawOrders, win30.startMs, win30.endMs);
  const mixTotal = mix ? mix.aiOrders + mix.humanOrders : 0;

  // Order pipeline counts from real transaction statuses.
  const txTotal = txFailed ? 0 : transactions.length;
  const openCount = openOrders?.length ?? 0;
  const approvalCount = approvalsFailed ? 0 : pendingApprovals.length;

  // Setup checklist from real state. Hidden once every step is done.
  const sellerReady = agentsStatus?.seller_agent.state === "CONNECTED";
  const setupSteps: SetupStep[] = [
    {
      id: "catalog",
      title: "Add products to your catalog",
      description:
        catalogFailed ? "Catalog could not be loaded — retry to check." : `${catalog.length} product${catalog.length === 1 ? "" : "s"} live`,
      href: "/dashboard/catalog",
      cta: "Open catalog",
      done: !catalogFailed && catalog.length > 0,
    },
    {
      id: "payments",
      title: "Connect payments",
      description: paymentLabel ?? "Checking payment rail…",
      href: "/dashboard/payments",
      cta: "Set up",
      done: !!rail?.configured,
    },
    {
      id: "seller",
      title: "Confirm the AI Seller is ready",
      description: sellerReady
        ? "Seller agent is online and follows your policy"
        : "Quotes and negotiates with buyers inside your policy limits",
      href: "/dashboard/selling-rules",
      cta: "Review rules",
      done: sellerReady,
    },
    {
      id: "first-sale",
      title: "Make your first sale",
      description:
        ordersCount !== null && ordersCount > 0
          ? `${ordersCount} order${ordersCount === 1 ? "" : "s"} so far`
          : "Run a checkout in AI Sales or wait for AI buyers",
      href: "/dashboard/chat",
      cta: "Open AI Sales",
      done: ordersCount !== null && ordersCount > 0,
    },
  ];

  // Negotiation + upsell funnels from real growth metrics.
  const negotiationRows =
    growth && !growthFailed && growth.negotiations > 0
      ? [
          {
            label: "Accepted",
            value: String(growth.negotiated_accepted),
            pct: (growth.negotiated_accepted / growth.negotiations) * 100,
            accent: true,
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

  if (loading) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            {todayLabel()}
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            {greeting()}
            {store ? `, ${store.name}` : ""}
          </h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-faint mt-1">
            LOADING YOUR STORE…
          </p>
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (allFailed) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
        <PageHeader title={`${greeting()}${store ? `, ${store.name}` : ""}`} subtitle="Your store at a glance" />
        <ErrorBanner
          message="The backend could not be reached — none of the store sections loaded."
          onRetry={() => {
            void fetchData();
            reloadStatus();
          }}
        />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
      {/* Compact greeting header — date eyebrow, 24px title, live summary lede */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            {todayLabel()}
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            {greeting()}
            {store && !storeFailed ? `, ${store.name}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {revenue !== null && ordersCount !== null && (ordersCount > 0 || revenue > 0)
              ? `${formatPaiseDecimal(revenue)} across ${ordersCount} order${ordersCount === 1 ? "" : "s"}${assistedPct !== null ? ` · ${assistedPct}% AI-assisted` : ""}`
              : "Track sales, open orders, and AI buyer activity"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
            {!storeFailed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 border border-hairline px-2.5 py-1 text-[12px] font-medium text-ink-2">
                <span className="size-1.5 rounded-full bg-green-600" /> Active
              </span>
            )}
            {paymentLabel && (
              <span className="text-[13px] text-muted">
                {paymentLabel}
              </span>
            )}
            {!paymentLabel && !statusError && (
              <span className="text-[13px] text-faint">
                Checking payments…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ViewStoreLink />
          <RefreshButton
            onRefresh={() => {
              void fetchData();
              reloadStatus();
            }}
            loading={loading}
          />
        </div>
      </div>

      {partialFailed && (
        <PartialBanner message="Some sections failed to load — figures below may be incomplete, and missing values are shown as — rather than zero." />
      )}

      {/* Setup checklist — only until the store is fully live */}
      <GettingStarted steps={setupSteps} />

      {/* Main metrics from insights */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Sales"
          value={revenue !== null ? formatPaiseDecimal(revenue) : "—"}
          caption={ordersCount !== null ? `Across ${ordersCount} order${ordersCount === 1 ? "" : "s"}` : undefined}
          delta={revenue !== null ? metricDelta("revenue") : undefined}
          spark={revenue !== null ? metricSpark("revenue") : undefined}
        />
        <KpiCard
          label="Orders"
          value={ordersCount !== null ? String(ordersCount) : "—"}
          delta={ordersCount !== null ? metricDelta("orders") : undefined}
          spark={ordersCount !== null ? metricSpark("orders") : undefined}
        />
        <KpiCard
          label="Average order value"
          value={aov !== null ? formatPaise(Math.round(aov)) : "—"}
          delta={aov !== null ? metricDelta("aov") : undefined}
          spark={aov !== null ? metricSpark("aov") : undefined}
        />
        <KpiCard
          label="AI-assisted sales"
          value={assisted !== null ? formatPaiseDecimal(assisted) : "—"}
          caption={assistedPct !== null ? `${assistedPct}% of sales` : undefined}
          delta={assisted !== null ? metricDelta("assisted") : undefined}
          spark={assisted !== null ? metricSpark("assisted") : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* Sales trend — 14-day revenue from real order records */}
          <Card className="shadow-card">
            <CardHeader className="border-b border-hairline bg-panel-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-[15px]">Sales trend</CardTitle>
                  <CardDescription className="mt-1 text-[13px]">
                    Paid revenue · last 14 days
                  </CardDescription>
                </div>
                <Link
                  href="/dashboard/growth"
                  className="shrink-0 text-[13px] font-medium text-accent-strong hover:underline"
                >
                  View analytics →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {txFailed ? (
                <ErrorBanner message="Sales trend could not be loaded." onRetry={() => void fetchData()} />
              ) : !hasTrend ? (
                <EmptyState
                  title="No sales in the last 14 days"
                  message="Paid orders from the last 14 days will plot here. Run a checkout in AI Sales to record the first one."
                  action={
                    <Link
                      href="/dashboard/chat"
                      className="inline-flex items-center h-9 px-5 rounded-full bg-panel border border-hairline shadow-sm text-[13px] font-medium text-ink-2 hover:text-ink hover:shadow transition-all"
                    >
                      Open AI Sales
                    </Link>
                  }
                />
              ) : (
                <SalesTimeChart points={trend14} metric="revenue" rangeLabel="the last 14 days" />
              )}
            </CardContent>
          </Card>

          {/* Order pipeline — where every order sits right now */}
          <div>
            <SectionHeading
              eyebrow="Pipeline"
              title="Orders in motion"
              description="Counts straight from your order book, updated on every load."
              action={
                <Link
                  href="/dashboard/transactions"
                  className="text-[13px] font-medium text-accent-strong hover:underline"
                >
                  View all →
                </Link>
              }
            />
            {txFailed ? (
              <ErrorBanner message="Order pipeline could not be loaded." onRetry={() => void fetchData()} />
            ) : txTotal === 0 ? (
              <EmptyState
                title="No orders yet"
                message="Orders created through your store or by AI buyers will move through this pipeline."
              />
            ) : (
              <Card className="shadow-card">
                <CardContent className="pt-5">
                  <FunnelBars
                    rows={[
                      {
                        label: "Paid",
                        value: `${paidCount ?? 0} order${(paidCount ?? 0) === 1 ? "" : "s"}`,
                        pct: txTotal > 0 ? ((paidCount ?? 0) / txTotal) * 100 : 0,
                        caption: "Captured and confirmed by the payment webhook",
                        accent: true,
                      },
                      {
                        label: "Open",
                        value: `${openCount} order${openCount === 1 ? "" : "s"}`,
                        pct: txTotal > 0 ? (openCount / txTotal) * 100 : 0,
                        caption: "Awaiting consent or payment",
                      },
                      {
                        label: "Awaiting approval",
                        value: `${approvalCount} order${approvalCount === 1 ? "" : "s"}`,
                        pct: txTotal > 0 ? (approvalCount / txTotal) * 100 : 0,
                        caption: "Held by policy for your review",
                      },
                      {
                        label: "Failed",
                        value: `${failedPayments ?? 0} order${(failedPayments ?? 0) === 1 ? "" : "s"}`,
                        pct: txTotal > 0 ? ((failedPayments ?? 0) / txTotal) * 100 : 0,
                        caption: "Payment failed or aborted",
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Product performance — catalog rows with stock */}
          <div>
            <SectionHeading
              eyebrow="Catalog"
              title="Product performance"
              description="Prices and stock for everything the AI Seller can sell."
              action={
                catalog.length > 0 ? (
                  <Link
                    href="/dashboard/catalog"
                    className="text-[13px] font-medium text-accent-strong hover:underline"
                  >
                    View all →
                  </Link>
                ) : undefined
              }
            />
            {catalogFailed ? (
              <ErrorBanner message="Product performance could not be loaded." onRetry={() => void fetchData()} />
            ) : catalog.length === 0 ? (
              <EmptyState
                title="No products yet"
                message="The AI Seller can only sell what is listed, so this stays empty until you add your first product."
                action={
                  <Link
                    href="/dashboard/catalog"
                    className="inline-flex items-center h-9 px-5 rounded-full bg-panel border border-hairline shadow-sm text-[13px] font-medium text-ink-2 hover:text-ink hover:shadow transition-all"
                  >
                    Add a product
                  </Link>
                }
              />
            ) : (
              <DataTable>
                <div className="px-6 py-3 flex items-center justify-between gap-4 border-b border-hairline bg-panel-2/60 text-[12px] font-medium text-muted">
                  <span>Product</span>
                  <span>Total stock</span>
                </div>
                {catalog.slice(0, 6).map((p, i) => (
                  <Link
                    key={p.id}
                    href={`/dashboard/catalog/${p.sku}`}
                    className={`px-6 py-4 flex items-center justify-between gap-4 hover:bg-ink/[0.02] transition-colors ${
                      i < Math.min(catalog.length, 6) - 1 ? "border-b border-hairline" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span className="inline-flex items-center justify-center rounded-[14px] bg-panel-2 border border-hairline text-ink-2 font-medium overflow-hidden size-11 text-[15px] shrink-0" aria-hidden>
                        {p.title.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-ink truncate">
                          {p.title}
                        </div>
                        <div className="text-[12px] text-faint mt-0.5 tabular-nums truncate">
                          {formatPaise(p.price_paise)} · {p.sku}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[13px] font-medium text-ink tabular-nums">
                        {p.stock}
                        <span className="text-faint font-normal"> in stock</span>
                      </span>
                      <StockBadge stock={p.stock} threshold={LOW_STOCK_THRESHOLD} />
                    </div>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>

          {/* Needs attention */}
          <div>
            <SectionHeading
              eyebrow="Operations"
              title="Needs attention"
              description="Everything waiting on a decision, in one list."
            />
            {needsAttention.length === 0 ? (
              <div className="rounded-[18px] bg-panel border border-hairline shadow-card px-6 py-10 text-center text-[14px] text-muted">
                {txFailed && approvalsFailed && catalogFailed
                  ? "Attention signals are unavailable — the backing services did not respond."
                  : "All clear. Nothing needs your attention right now."}
              </div>
            ) : (
              <DataTable>
                {needsAttention.map((item, i) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`px-6 py-4 flex items-center justify-between gap-4 hover:bg-black/[0.02] transition-colors ${
                      i < needsAttention.length - 1 ? "border-b border-black/[0.05]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center size-7 rounded-full bg-amber-100 shrink-0" aria-hidden>
                        <IconWarning size={14} className="text-amber-800" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-neutral-900 truncate">
                          {item.label}
                        </div>
                        <div className="text-[12px] text-neutral-400 mt-0.5 truncate">
                          {item.detail}
                        </div>
                      </div>
                    </div>
                    <span className="text-[13px] font-medium text-ink shrink-0">
                      Review →
                    </span>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>

          {/* Recent orders */}
          <div>
            <SectionHeading
              eyebrow="Sales"
              title="Recent orders"
              description="Your five most recently updated orders."
              action={
                <Link
                  href="/dashboard/transactions"
                  className="text-[13px] font-medium text-accent-strong hover:underline"
                >
                  View all →
                </Link>
              }
            />
            {txFailed ? (
              <ErrorBanner message="Recent orders could not be loaded." onRetry={() => void fetchData()} />
            ) : recentOrders.length === 0 ? (
              <EmptyState
                title="No orders yet"
                message="New orders show up here with their status and value."
                action={
                  <Link
                    href="/dashboard/storefront"
                    className="inline-flex items-center h-9 px-5 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all"
                  >
                    View storefront
                  </Link>
                }
              />
            ) : (
              <DataTable>
                {recentOrders.map((tx, i) => (
                  <Link
                    key={tx.id}
                    href={`/dashboard/transactions/${tx.id}`}
                    className={`px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.02] transition-colors ${
                      i < recentOrders.length - 1 ? "border-b border-black/[0.05]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] text-neutral-600 truncate">
                        #{tx.id}
                      </div>
                      <div className="text-[12px] text-neutral-400 mt-0.5">
                        {formatTimeAgo(tx.updatedAt)} · {tx.channel === "agent_to_agent" ? "AI buyer" : "Human"}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                        {formatPaise(tx.amountPaise)}
                      </div>
                      <div className="mt-1">
                        <StatusBadge status={tx.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>

          {/* Recent activity */}
          <div>
            <SectionHeading
              eyebrow="Ledger"
              title="Recent activity"
              description="Each entry links to its full ledger trace."
              action={
                <Link
                  href="/dashboard/activity"
                  className="text-[13px] font-medium text-accent-strong hover:underline"
                >
                  View all →
                </Link>
              }
            />
            {eventsFailed ? (
              <ErrorBanner message="Recent activity could not be loaded." onRetry={() => void fetchData()} />
            ) : recentEvents.length === 0 ? (
              <EmptyState
                title="No activity yet"
                message="Activity shows up here once buyers and your AI Seller start transacting."
              />
            ) : (
              <DataTable>
                {recentEvents.map((event, i) => (
                  <Link
                    key={event.id}
                    href="/dashboard/activity"
                    className={`px-6 py-3 flex items-center gap-3 hover:bg-black/[0.02] transition-colors ${
                      i < recentEvents.length - 1 ? "border-b border-black/[0.05]" : ""
                    }`}
                  >
                    <span className="text-[12px] text-neutral-400 w-[58px] flex-shrink-0 tabular-nums">
                      {event.time}
                    </span>
                    <span
                      className={`size-2 rounded-full flex-shrink-0 ${
                        event.type === "success"
                          ? "bg-green-600"
                          : event.type === "error"
                            ? "bg-red-600"
                            : event.type === "warning"
                              ? "bg-amber-600"
                              : "bg-neutral-300"
                      }`}
                    />
                    <span className="text-[14px] text-neutral-700 truncate">
                      {event.label}
                    </span>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Pending approvals preview */}
          {!approvalsFailed && pendingApprovals.length > 0 && (
            <Card className="shadow-card">
              <CardHeader className="border-b border-hairline bg-panel-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-[15px]">
                      Pending approvals
                    </CardTitle>
                    <CardDescription className="mt-1 text-[13px]">
                      Policy held these orders for your decision.
                    </CardDescription>
                  </div>
                  <Link
                    href="/dashboard/approvals"
                    className="shrink-0 text-[13px] font-medium text-accent-strong hover:underline"
                  >
                    Review →
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="px-6 py-2">
                {pendingApprovals.slice(0, 3).map((a) => (
                  <Link
                    key={a.order_id}
                    href="/dashboard/approvals"
                    className="flex items-center justify-between gap-3 py-3 border-b border-hairline last:border-b-0 hover:opacity-80 transition-opacity"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink truncate">
                        #{a.order_id}
                      </div>
                      <div className="text-[12px] text-faint mt-0.5 truncate">
                        {formatTimeAgo(a.requested_at)} · {a.buyer_agent_id}
                      </div>
                    </div>
                    <span className="text-[14px] font-semibold tabular-nums text-ink shrink-0">
                      {formatPaise(a.amount_paise)}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Store health */}
          <Card className="shadow-card">
            <CardHeader className="border-b border-hairline bg-panel-2">
              <CardTitle className="text-[15px]">Store health</CardTitle>
              <CardDescription className="mt-1 text-[13px]">
                The services your storefront needs to take orders.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 py-2">
              {statusError ? (
                <div className="py-3">
                  <ErrorBanner message={`Store health is unavailable: ${statusError.message}`} onRetry={reloadStatus} />
                </div>
              ) : health.length === 0 ? (
                <TableSkeleton rows={5} />
              ) : (
                health.map((h) => (
                  <div key={h.label} className="flex items-center justify-between gap-3 py-2.5 border-b border-black/[0.05] last:border-b-0">
                    <span className="text-[13px] text-neutral-500">
                      {h.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${
                          h.ready === null ? "bg-neutral-300" : h.ready ? "bg-green-600" : "bg-amber-600"
                        }`}
                      />
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${
                          h.ready === null
                            ? "bg-neutral-100 text-neutral-500"
                            : h.ready
                              ? "bg-green-50 text-green-700"
                              : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {h.ready === null ? "—" : h.ready ? "Ready" : h.state?.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Not ready"}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Buyer channels */}
          {mix && mixTotal > 0 && (
            <Card className="shadow-card">
              <CardHeader className="border-b border-hairline bg-panel-2">
                <CardTitle className="text-[15px]">Buyer channels</CardTitle>
                <CardDescription className="mt-1 text-[13px]">
                  Human chat and AI-buyer orders from the last 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
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
              </CardContent>
            </Card>
          )}

          {/* AI sales snapshot */}
          <Card className="shadow-card">
            <CardHeader className="border-b border-hairline bg-panel-2">
              <CardTitle className="text-[15px]">AI sales snapshot</CardTitle>
              <CardDescription className="mt-1 text-[13px]">
                Revenue and outcomes from AI-assisted selling.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {growthFailed || !growth ? (
                <ErrorBanner
                  message="AI sales figures could not be loaded."
                  onRetry={() => void fetchData()}
                />
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-muted">
                      AI-assisted revenue
                    </span>
                    <span className="text-[15px] font-semibold text-ink tabular-nums">
                      {formatPaiseDecimal(growth.agent_assisted_revenue)}
                    </span>
                  </div>
                  {negotiationRows ? (
                    <div>
                      <div className="text-[12px] font-medium text-muted mb-3">
                        Negotiations · {growth.negotiations} total
                      </div>
                      <FunnelBars rows={negotiationRows} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-muted">
                        Negotiations
                      </span>
                      <span className="text-[15px] font-semibold text-ink tabular-nums">
                        {growth.negotiations}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-muted">
                      Upsell offers
                    </span>
                    <span className="text-[15px] font-semibold text-ink tabular-nums">
                      {growth.upsell_offers}
                      <span className="text-muted font-normal text-[13px]">
                        {" "}· {growth.upsell_accepted} accepted{upsellRate !== null ? ` · ${upsellRate}%` : ""}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
