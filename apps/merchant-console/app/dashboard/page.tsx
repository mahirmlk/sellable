"use client";

// Home (route /dashboard): greeting header, real sales figures, store health,
// needs-attention aggregation, recent orders, recent activity, AI snapshot.
// Every figure is derived from loaded API records; on load failure the metric
// shows "—" with a partial-failure banner instead of a fabricated zero.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  type ConsoleGrowthMetrics,
  type LedgerEvent,
  type Product,
  type StoreInfo,
} from "@/lib/api";
import { IconWarning } from "@/components/dashboard/icons";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  PartialBanner,
  RefreshButton,
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

function paymentModeLabel(provider: string, mode: string): string {
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
  return `${cap(provider)} ${cap(mode)} Mode`;
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border border-[var(--bb-line)] p-4 bg-[var(--bb-panel)]">
      <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-3">
        {label}
      </div>
      <div className="font-[var(--font-mono)] text-[1.35rem] leading-none tabular-nums tracking-tight text-[var(--bb-white)]">
        {value}
      </div>
      {sub && (
        <div className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)] mt-2">
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionLabel({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-orange)] tabular-nums">
          {index}
        </span>
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function OverviewPage() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [storeFailed, setStoreFailed] = useState(false);
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [growthFailed, setGrowthFailed] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txFailed, setTxFailed] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<
    Array<{ orderId: string; amountPaise: number }>
  >([]);
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
      setTxFailed(false);
    } else {
      setTransactions([]);
      setTxFailed(true);
      failures += 1;
    }
    if (apprRes.status === "fulfilled") {
      setPendingApprovals(
        apprRes.value.filter((a) => a.status === "PENDING").map((a) => ({
          orderId: a.order_id,
          amountPaise: a.amount_paise,
        }))
      );
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
  const lowStock = catalogFailed ? null : catalog.filter((p) => stockState(p.stock) === "low").length;

  const needsAttention: Array<{ label: string; detail: string; href: string }> = [];
  if (!approvalsFailed && pendingApprovals.length > 0)
    needsAttention.push({
      label: `${pendingApprovals.length} order${pendingApprovals.length > 1 ? "s" : ""} awaiting approval`,
      detail: `Highest ${formatPaise(Math.max(...pendingApprovals.map((a) => a.amountPaise)))}`,
      href: "/dashboard/approvals",
    });
  if (failedPayments !== null && failedPayments > 0)
    needsAttention.push({
      label: `${failedPayments} failed payment${failedPayments > 1 ? "s" : ""}`,
      detail: "Review and retry from the order",
      href: "/dashboard/transactions",
    });
  if (lowStock !== null && lowStock > 0)
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

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-[1440px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">
              {greeting()}
              {store ? `, ${store.name}` : ""}
            </h1>
            <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">
              LOADING YOUR STORE…
            </p>
          </div>
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (allFailed) {
    return (
      <div className="p-6 space-y-6 max-w-[1440px]">
        <PageHeader title={`${greeting()}${store ? `, ${store.name}` : ""}`} subtitle="YOUR STORE AT A GLANCE" />
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
    <div className="p-6 space-y-6 max-w-[1440px]">
      {/* Greeting header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">
            {greeting()}
            {store && !storeFailed ? `, ${store.name}` : ""}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {!storeFailed && (
              <span className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> ACTIVE
              </span>
            )}
            {paymentLabel && (
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
                · {paymentLabel}
              </span>
            )}
            {!paymentLabel && !statusError && (
              <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">
                · CHECKING PAYMENTS…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
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

      {/* Main metrics from insights */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Sales" value={revenue !== null ? formatPaiseDecimal(revenue) : "—"} sub={ordersCount !== null ? `ACROSS ${ordersCount} ORDERS` : undefined} />
        <Metric label="Orders" value={ordersCount !== null ? String(ordersCount) : "—"} />
        <Metric label="Average order value" value={aov !== null ? formatPaise(Math.round(aov)) : "—"} />
        <Metric label="AI-assisted sales" value={assisted !== null ? formatPaiseDecimal(assisted) : "—"} sub={assistedPct !== null ? `${assistedPct}% OF SALES` : undefined} />
      </div>

      {/* Sales overview with real figures */}
      <div>
        <SectionLabel index="01" title="Sales overview" />
        <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--bb-orange)]" />
          {revenue !== null && ordersCount !== null ? (
            <>
              <div className="font-[var(--font-sans)] text-[0.95rem] text-[var(--bb-white)] leading-relaxed">
                {formatPaiseDecimal(revenue)} across {ordersCount} order{ordersCount === 1 ? "" : "s"}
                {assisted !== null && assistedPct !== null
                  ? `, with ${formatPaiseDecimal(assisted)} (${assistedPct}%) assisted by your AI Seller.`
                  : "."}
              </div>
              {assisted !== null && assistedPct !== null && (
                <div className="mt-4">
                  <div className="h-[6px] bg-[var(--bb-black)] border border-[var(--bb-line-soft)] overflow-hidden">
                    <div className="h-full bg-[var(--bb-orange)]" style={{ width: `${assistedPct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase">
                    <span className="text-[var(--bb-orange)]">{assistedPct}% AI-ASSISTED</span>
                    <span className="text-[var(--bb-grey-4)]">{100 - assistedPct}% DIRECT</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
              Sales figures are unavailable — the insights service did not respond. Retry to reload.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          {/* Needs attention */}
          <div>
            <SectionLabel index="02" title="Needs attention" />
            {needsAttention.length === 0 ? (
              <div className="border border-[var(--bb-line)] px-5 py-8 text-center font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-4)]">
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
                    className={`px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--bb-panel)] transition-colors group ${
                      i < needsAttention.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <IconWarning size={14} className="text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-1)] group-hover:text-[var(--bb-white)] transition-colors">
                          {item.label}
                        </div>
                        <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mt-0.5">
                          {item.detail}
                        </div>
                      </div>
                    </div>
                    <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] shrink-0">
                      REVIEW →
                    </span>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>

          {/* Recent orders */}
          <div>
            <SectionLabel index="03" title="Recent orders">
              <Link
                href="/dashboard/transactions"
                className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] transition-colors"
              >
                VIEW ALL →
              </Link>
            </SectionLabel>
            {txFailed ? (
              <ErrorBanner message="Recent orders could not be loaded." onRetry={() => void fetchData()} />
            ) : recentOrders.length === 0 ? (
              <EmptyState
                title="No orders yet"
                message="No orders yet. Orders created through your store will appear here."
                action={
                  <Link
                    href="/dashboard/storefront"
                    className="inline-flex items-center h-[32px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all"
                  >
                    VIEW STOREFRONT
                  </Link>
                }
              />
            ) : (
              <DataTable>
                {recentOrders.map((tx, i) => (
                  <Link
                    key={tx.id}
                    href={`/dashboard/transactions/${tx.id}`}
                    className={`px-5 py-3 flex items-center justify-between gap-3 hover:bg-[var(--bb-panel)] transition-colors group ${
                      i < recentOrders.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-2)] group-hover:text-[var(--bb-white)] transition-colors truncate">
                        #{tx.id}
                      </div>
                      <div className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] mt-0.5">
                        {formatTimeAgo(tx.updatedAt)} · {tx.channel === "agent_to_agent" ? "AI Buyer" : "Human"}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="font-[var(--font-mono)] text-[0.82rem] text-[var(--bb-white)] tabular-nums">
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
            <SectionLabel index="04" title="Recent activity">
              <Link
                href="/dashboard/activity"
                className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] transition-colors"
              >
                VIEW ALL →
              </Link>
            </SectionLabel>
            {eventsFailed ? (
              <ErrorBanner message="Recent activity could not be loaded." onRetry={() => void fetchData()} />
            ) : recentEvents.length === 0 ? (
              <EmptyState
                title="No activity yet"
                message="Store activity will appear here once buyers and your AI Seller start transacting."
              />
            ) : (
              <DataTable>
                {recentEvents.map((event, i) => (
                  <Link
                    key={event.id}
                    href="/dashboard/activity"
                    className={`px-5 py-[11px] flex items-center gap-4 hover:bg-[var(--bb-panel)] transition-colors group ${
                      i < recentEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                    }`}
                  >
                    <span className="font-[var(--font-mono)] text-[0.58rem] text-[var(--bb-grey-4)] w-[58px] flex-shrink-0 tabular-nums">
                      {event.time}
                    </span>
                    <span
                      className={`w-[5px] h-[5px] rotate-45 flex-shrink-0 ${
                        event.type === "success"
                          ? "bg-green-400"
                          : event.type === "error"
                            ? "bg-red-400"
                            : event.type === "warning"
                              ? "bg-yellow-400"
                              : "bg-[var(--bb-grey-3)]"
                      }`}
                    />
                    <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-2)] group-hover:text-[var(--bb-white)] transition-colors">
                      {event.label}
                    </span>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Store health */}
          <div>
            <SectionLabel index="05" title="Store health" />
            {statusError ? (
              <ErrorBanner message={`Store health is unavailable: ${statusError.message}`} onRetry={reloadStatus} />
            ) : health.length === 0 ? (
              <TableSkeleton rows={5} />
            ) : (
              <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] px-5 py-4 space-y-3">
                {health.map((h) => (
                  <div key={h.label} className="flex items-center justify-between gap-3">
                    <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                      {h.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-[5px] h-[5px] rounded-full ${
                          h.ready === null ? "bg-[var(--bb-grey-4)]" : h.ready ? "bg-green-400" : "bg-amber-400"
                        }`}
                      />
                      <span
                        className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase ${
                          h.ready === null
                            ? "text-[var(--bb-grey-4)]"
                            : h.ready
                              ? "text-green-400"
                              : "text-amber-400"
                        }`}
                      >
                        {h.ready === null ? "—" : h.ready ? "READY" : h.state?.replace(/_/g, " ") ?? "NOT READY"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI sales snapshot */}
          <div>
            <SectionLabel index="06" title="AI sales snapshot" />
            {growthFailed || !growth ? (
              <ErrorBanner
                message="AI sales figures could not be loaded."
                onRetry={() => void fetchData()}
              />
            ) : (
              <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                    AI-assisted revenue
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-orange)] tabular-nums">
                    {formatPaiseDecimal(growth.agent_assisted_revenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                    Negotiations
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)] tabular-nums">
                    {growth.negotiations}
                    <span className="text-[var(--bb-grey-4)] text-[0.62rem]"> · {growth.negotiated_accepted} accepted</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
                    Upsell offers
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)] tabular-nums">
                    {growth.upsell_offers}
                    <span className="text-[var(--bb-grey-4)] text-[0.62rem]">
                      {" "}· {growth.upsell_accepted} accepted{upsellRate !== null ? ` · ${upsellRate}%` : ""}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
