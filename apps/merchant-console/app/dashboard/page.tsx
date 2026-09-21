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
    <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-5 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]">
      <div className="text-[13px] font-medium text-neutral-500 mb-2 truncate">
        {label}
      </div>
      <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-neutral-900">
        {value}
      </div>
      {sub && (
        <div className="text-[12px] text-neutral-400 mt-2 normal-case tracking-normal">
          {sub.charAt(0) + sub.slice(1).toLowerCase()}
        </div>
      )}
    </div>
  );
}

function SectionLabel({
  title,
  children,
}: {
  index?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">
        {title}
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
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
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
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
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
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      {/* Greeting header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-neutral-900">
            {greeting()}
            {store && !storeFailed ? `, ${store.name}` : ""}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {!storeFailed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[12px] font-medium text-green-700">
                <span className="size-1.5 rounded-full bg-green-600" /> Active
              </span>
            )}
            {paymentLabel && (
              <span className="text-[13px] text-neutral-500">
                {paymentLabel}
              </span>
            )}
            {!paymentLabel && !statusError && (
              <span className="text-[13px] text-neutral-400">
                Checking payments…
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
        <SectionLabel title="Sales overview" />
        <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-6 relative overflow-hidden">
          {revenue !== null && ordersCount !== null ? (
            <>
              <div className="text-[15px] text-neutral-900 leading-relaxed">
                {formatPaiseDecimal(revenue)} across {ordersCount} order{ordersCount === 1 ? "" : "s"}
                {assisted !== null && assistedPct !== null
                  ? `, with ${formatPaiseDecimal(assisted)} (${assistedPct}%) assisted by your AI Seller.`
                  : "."}
              </div>
              {assisted !== null && assistedPct !== null && (
                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-[#0071e3]" style={{ width: `${assistedPct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <span className="font-medium text-[#0071e3]">{assistedPct}% AI-assisted</span>
                    <span className="text-neutral-400">{100 - assistedPct}% direct</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-neutral-400">
              Sales figures are unavailable — the insights service did not respond. Retry to reload.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-8">
          {/* Needs attention */}
          <div>
            <SectionLabel title="Needs attention" />
            {needsAttention.length === 0 ? (
              <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-6 py-10 text-center text-[14px] text-neutral-400">
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
                    <span className="text-[13px] font-medium text-[#0071e3] shrink-0">
                      Review →
                    </span>
                  </Link>
                ))}
              </DataTable>
            )}
          </div>

          {/* Recent orders */}
          <div>
            <SectionLabel title="Recent orders">
              <Link
                href="/dashboard/transactions"
                className="text-[13px] font-medium text-[#0071e3] hover:underline"
              >
                View all →
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
            <SectionLabel title="Recent activity">
              <Link
                href="/dashboard/activity"
                className="text-[13px] font-medium text-[#0071e3] hover:underline"
              >
                View all →
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
                          ? "bg-[#1f9d55]"
                          : event.type === "error"
                            ? "bg-[#d92d20]"
                            : event.type === "warning"
                              ? "bg-[#b25e00]"
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

        <div className="space-y-8">
          {/* Store health */}
          <div>
            <SectionLabel title="Store health" />
            {statusError ? (
              <ErrorBanner message={`Store health is unavailable: ${statusError.message}`} onRetry={reloadStatus} />
            ) : health.length === 0 ? (
              <TableSkeleton rows={5} />
            ) : (
              <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] px-6 py-4">
                {health.map((h) => (
                  <div key={h.label} className="flex items-center justify-between gap-3 py-2.5 border-b border-black/[0.05] last:border-b-0">
                    <span className="text-[13px] text-neutral-500">
                      {h.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${
                          h.ready === null ? "bg-neutral-300" : h.ready ? "bg-[#1f9d55]" : "bg-[#b25e00]"
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
                ))}
              </div>
            )}
          </div>

          {/* AI sales snapshot */}
          <div>
            <SectionLabel title="AI sales snapshot" />
            {growthFailed || !growth ? (
              <ErrorBanner
                message="AI sales figures could not be loaded."
                onRetry={() => void fetchData()}
              />
            ) : (
              <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] px-6 py-4">
                <div className="flex items-center justify-between py-2.5 border-b border-black/[0.05]">
                  <span className="text-[13px] text-neutral-500">
                    AI-assisted revenue
                  </span>
                  <span className="text-[15px] font-semibold text-[#0071e3] tabular-nums">
                    {formatPaiseDecimal(growth.agent_assisted_revenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-black/[0.05]">
                  <span className="text-[13px] text-neutral-500">
                    Negotiations
                  </span>
                  <span className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                    {growth.negotiations}
                    <span className="text-neutral-400 font-normal text-[13px]"> · {growth.negotiated_accepted} accepted</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[13px] text-neutral-500">
                    Upsell offers
                  </span>
                  <span className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                    {growth.upsell_offers}
                    <span className="text-neutral-400 font-normal text-[13px]">
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
