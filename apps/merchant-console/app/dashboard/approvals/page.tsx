"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ShieldCheck, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { MoneyValue } from "@/components/dashboard/money-value";
import { RefreshButton } from "@/components/dashboard/commerce-ui";
import { formatTimestamp, formatPaise } from "@/lib/formatters";
import {
  getConsoleApprovals,
  approveConsoleOrder,
  rejectConsoleOrder,
  continueBuyerMission,
  getConsoleTransactions,
  getConsolePolicy,
  getConsoleCatalogItem,
  type ConsoleApproval,
  type ConsoleTransaction,
} from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  PartialBanner,
  Tabs,
} from "@/components/dashboard/tier-fallbacks";

interface ApprovalRow {
  orderId: string;
  buyerId: string;
  amountPaise: number;
  reason: string;
  requestedAt: string;
  status: string;
}

type Tab = "pending" | "reviewed";
type Filter = "all" | "ai" | "human" | "high";

function mapApproval(a: ConsoleApproval): ApprovalRow {
  return {
    orderId: a.order_id,
    buyerId: a.buyer_agent_id,
    amountPaise: a.amount_paise,
    reason: a.reason,
    requestedAt: a.requested_at,
    status: a.status,
  };
}

export default function ApprovalsPage() {
  // `approvals` mirrors the backend queue (always PENDING rows); `reviewed`
  // is this session's acted-upon record — the approval/rejection itself is
  // persisted on the order backend-side, and the refetch below reconciles
  // the pending list with backend truth.
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [reviewed, setReviewed] = useState<ApprovalRow[]>([]);
  const [transactions, setTransactions] = useState<ConsoleTransaction[]>([]);
  const [thresholdPaise, setThresholdPaise] = useState<number | null>(null);
  const [floors, setFloors] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>("pending");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Per-order busy flags: double-clicking approve/reject must not fire the
  // request twice (the second call 400s after the first one lands).
  const [busyOrders, setBusyOrders] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (silent = false) => {
    // Polls run silently: only the opening fetch may flip the full-page
    // loading state, otherwise the queue flickers every 12 seconds.
    if (!silent) {
      setLoading(true);
      setLoadError(null);
      setPartialError(null);
    }
    try {
      const [a, t, p] = await Promise.allSettled([
        getConsoleApprovals(),
        getConsoleTransactions(),
        getConsolePolicy(),
      ]);
      if (a.status === "fulfilled") setApprovals(a.value.map(mapApproval));
      else if (!silent) {
        setLoadError(
          a.reason instanceof TypeError
            ? "Backend unreachable — approvals could not be loaded."
            : "Approvals could not be loaded from the backend."
        );
      }
      if (t.status === "fulfilled") setTransactions(t.value);
      if (p.status === "fulfilled") setThresholdPaise(p.value.human_approval_threshold_paise);
      if (!silent && (t.status === "rejected" || p.status === "rejected")) {
        const missing: string[] = [];
        if (t.status === "rejected") missing.push("order context");
        if (p.status === "rejected") missing.push("approval threshold");
        setPartialError(`Enrichment unavailable (${missing.join(", ")}) — buyer type / high-value flags may be incomplete.`);
      }
    } catch {
      if (!silent) setLoadError("Approvals could not be loaded from the backend.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  // Lightweight poll while the page is open: buyer missions held for HITL
  // appear here without a manual refresh (12s, silent, single interval).
  useEffect(() => {
    const timer = window.setInterval(() => void fetchData(true), 12_000);
    return () => window.clearInterval(timer);
  }, [fetchData]);

  // Merchant floors for the first line-item SKU of each pending order —
  // best-effort enrichment, shown only where the catalog actually answers.
  useEffect(() => {
    const skus = [...new Set(
      approvals.flatMap((a) => {
        const tx = transactions.find((x) => x.order_id === a.orderId);
        const first = tx?.items?.[0]?.sku;
        return first && !(first in floors) ? [first] : [];
      })
    )];
    if (skus.length === 0) return;
    let cancelled = false;
    void Promise.all(
      skus.map(async (sku) => {
        try {
          const item = await getConsoleCatalogItem(sku);
          return { sku, floor: item.floor_paise } as const;
        } catch {
          return null;
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      const found: Record<string, number> = {};
      for (const r of rows) if (r) found[r.sku] = r.floor;
      if (Object.keys(found).length > 0) setFloors((prev) => ({ ...prev, ...found }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvals, transactions]);

  const txByOrder = useMemo(() => {
    const m = new Map<string, ConsoleTransaction>();
    for (const t of transactions) m.set(t.order_id, t);
    return m;
  }, [transactions]);

  const buyerTypeOf = (a: ApprovalRow): "ai" | "human" | "unknown" => {
    const tx = txByOrder.get(a.orderId);
    if (tx?.channel === "human_chat") return "human";
    if (tx?.channel === "agent_to_agent") return "ai";
    // Fall back to the buyer id the backend reported on the approval row.
    if (a.buyerId === "human_chat") return "human";
    if (a.buyerId) return "ai";
    return "unknown";
  };

  const isHighValue = (a: ApprovalRow): boolean =>
    thresholdPaise !== null && a.amountPaise >= thresholdPaise;

  const pending = useMemo(
    () =>
      approvals.filter((a) => {
        if (filter === "ai") return buyerTypeOf(a) === "ai";
        if (filter === "human") return buyerTypeOf(a) === "human";
        if (filter === "high") return isHighValue(a);
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approvals, filter, transactions, thresholdPaise]
  );

  const runAction = async (orderId: string, kind: "approve" | "reject") => {
    if (busyOrders.has(orderId)) return;
    setBusyOrders((prev) => new Set(prev).add(orderId));
    setActionError(null);
    try {
      if (kind === "approve") {
        const res = await approveConsoleOrder(orderId);
        // A2A buyer missions resume automatically: approval unblocks the
        // persisted mission and the backend continuation (consent reuse /
        // re-issue + payment start through the existing PaymentService)
        // proceeds without handing the checkout back to the merchant.
        // Human chat orders carry no mission_id and keep their own flow.
        if (res.mission_id) {
          try {
            await continueBuyerMission(res.mission_id);
          } catch {
            // Non-fatal: the mission stays resumable from Activity, and the
            // backend re-derives its state from the authoritative order.
          }
        }
      } else {
        await rejectConsoleOrder(orderId);
      }
      setApprovals((prev) => {
        const acted = prev.find((a) => a.orderId === orderId);
        if (acted) {
          setReviewed((r) => [
            { ...acted, status: kind === "approve" ? "APPROVED" : "REJECTED" },
            ...r.filter((x) => x.orderId !== orderId),
          ]);
        }
        return prev.filter((a) => a.orderId !== orderId);
      });
      // The decision is persisted on the order — refresh immediately so the
      // pending queue reflects backend truth without waiting for the poll.
      await fetchData(true);
    } catch (err) {
      const unreachable = err instanceof TypeError;
      setActionError(
        unreachable
          ? `Backend unreachable — the ${kind === "approve" ? "approval" : "rejection"} was not recorded. Try again.`
          : `The backend rejected the ${kind === "approve" ? "approval" : "rejection"} request. Refresh and try again.`
      );
    } finally {
      setBusyOrders((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const handleApprove = (orderId: string) => void runAction(orderId, "approve");
  const handleReject = (orderId: string) => void runAction(orderId, "reject");

  const approvalCard = (approval: ApprovalRow) => {
    const tx = txByOrder.get(approval.orderId);
    const buyerType = buyerTypeOf(approval);
    const high = isHighValue(approval);
    const items = tx?.items ?? [];
    const firstSku = items[0]?.sku;
    const floor = firstSku && firstSku in floors ? floors[firstSku] : null;
    const budget = tx?.buyer_budget_paise ?? null;
    return (
      <div key={approval.orderId} className="rounded-2xl bg-white border border-amber-200/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-6 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[15px] font-semibold text-neutral-900 tabular-nums">{approval.orderId}</span>
              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium bg-amber-50 text-amber-800">{approval.reason}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${buyerType === "ai" ? "bg-blue-50 text-blue-700" : buyerType === "human" ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-600"}`}>
                {buyerType === "ai" ? "AI buyer" : buyerType === "human" ? "Human buyer" : "Unknown buyer"}
              </span>
              {high && (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium bg-[#fff4e5] text-[#b25e00]">
                  High value
                </span>
              )}
            </div>
            {/* Product / order summary from existing transaction data */}
            {items.length > 0 ? (
              <div className="text-[13px] text-neutral-500 mb-3">
                {items.slice(0, 3).map((it) => `${it.sku} × ${it.quantity} @ ${formatPaise(it.offered_price_paise)}`).join(" · ")}
                {items.length > 3 && ` · +${items.length - 3} more`}
              </div>
            ) : (
              <div className="text-[13px] text-neutral-400 mb-3">Order detail unavailable — see the order page.</div>
            )}
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <div className="text-[12px] text-neutral-400">Buyer</div>
                <div className="text-[13px] text-neutral-700 tabular-nums">{approval.buyerId}</div>
              </div>
              <div>
                <div className="text-[12px] text-neutral-400">Amount</div>
                <MoneyValue paise={approval.amountPaise} />
              </div>
              <div>
                <div className="text-[12px] text-neutral-400">Requested</div>
                <div className="text-[13px] text-neutral-600">{formatTimestamp(approval.requestedAt)}</div>
              </div>
              {budget !== null && (
                <div>
                  <div className="text-[12px] text-neutral-400">Buyer budget</div>
                  <div className="text-[13px] text-neutral-600 tabular-nums">{formatPaise(budget)}</div>
                </div>
              )}
              {floor !== null && (
                <div>
                  <div className="text-[12px] text-neutral-400">Merchant floor</div>
                  <div className="text-[13px] text-neutral-600 tabular-nums">{formatPaise(floor)}</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Link href={`/dashboard/transactions/${approval.orderId}`} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]">
              View order <ArrowRight size={13} />
            </Link>
            <button onClick={() => handleReject(approval.orderId)} disabled={busyOrders.has(approval.orderId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-red-50 border border-red-200/60 text-[13px] font-medium text-red-700 hover:bg-red-100 transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]">
              <XCircle size={14} /> {busyOrders.has(approval.orderId) ? "Working…" : "Reject"}
            </button>
            <button onClick={() => handleApprove(approval.orderId)} disabled={busyOrders.has(approval.orderId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#1f9d55] text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a8a4b] transition-all cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]">
              <CheckCircle size={14} /> {busyOrders.has(approval.orderId) ? "Working…" : "Approve"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title={approvals.length > 0 ? `${approvals.length} waiting for you` : "Approvals"}
        subtitle="Orders waiting for your approval"
        actions={
          <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
        }
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}
      {actionError && <ErrorBanner message={actionError} />}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { label: `Pending (${approvals.length})`, value: "pending" },
          { label: `Recently reviewed (${reviewed.length})`, value: "reviewed" },
        ]}
      />

      {tab === "pending" && (
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { label: "All", value: "all" },
            { label: "AI Buyer", value: "ai" },
            { label: "Human Buyer", value: "human" },
            { label: "High value", value: "high" },
          ]}
        />
      )}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : tab === "pending" ? (
        pending.length === 0 ? (
          <EmptyState
            title={approvals.length === 0 ? "No approvals pending." : "No orders match this filter."}
            message={approvals.length === 0
              ? "Transactions below your configured approval threshold can proceed automatically."
              : "Try a different filter — the pending queue itself is intact."}
            action={<ShieldCheck size={28} className="text-[var(--bb-grey-4)]" />}
          />
        ) : (
          <div className="space-y-4 stagger-child">{pending.map(approvalCard)}</div>
        )
      ) : reviewed.length === 0 ? (
        <EmptyState
          title="Nothing reviewed yet"
          message="Orders you approve or reject this session appear here. The backend keeps no review history — this list resets on reload."
        />
      ) : (
        <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden">
          <div className="px-6 py-4 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">Recently reviewed</div>
            <div className="text-[12px] text-neutral-400 mt-0.5">The backend keeps no review history — this list resets on reload</div>
          </div>
          {reviewed.map((a, i) => (
            <div key={a.orderId} className={`px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.02] ${i < reviewed.length - 1 ? "border-b border-black/[0.05]" : ""}`}>
              <div className="flex items-center gap-4 min-w-0">
                <Link href={`/dashboard/transactions/${a.orderId}`} className="text-[13px] font-medium text-[#0071e3] hover:underline truncate">{a.orderId}</Link>
                <MoneyValue paise={a.amountPaise} size="sm" />
              </div>
              <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${a.status === "APPROVED" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{a.status === "APPROVED" ? "Approved" : "Rejected"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
