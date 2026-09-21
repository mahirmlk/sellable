"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ShieldCheck, CheckCircle, XCircle, RefreshCw, ArrowRight } from "lucide-react";
import { MoneyValue } from "@/components/dashboard/money-value";
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
      <div key={approval.orderId} className="border border-amber-400/30 bg-amber-400/5 p-5 hover-lift">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">{approval.orderId}</span>
              <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-amber-400">{approval.reason}</span>
              <span className={`font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase px-1.5 py-0.5 border ${buyerType === "ai" ? "border-blue-400/40 text-blue-400" : buyerType === "human" ? "border-green-400/40 text-green-400" : "border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"}`}>
                {buyerType === "ai" ? "AI BUYER" : buyerType === "human" ? "HUMAN BUYER" : "UNKNOWN BUYER"}
              </span>
              {high && (
                <span className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-[var(--bb-orange)]/50 text-[var(--bb-orange)]">
                  HIGH VALUE
                </span>
              )}
            </div>
            {/* Product / order summary from existing transaction data */}
            {items.length > 0 ? (
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] mb-2">
                {items.slice(0, 3).map((it) => `${it.sku} × ${it.quantity} @ ${formatPaise(it.offered_price_paise)}`).join(" · ")}
                {items.length > 3 && ` · +${items.length - 3} more`}
              </div>
            ) : (
              <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] mb-2">Order detail unavailable — see the order page.</div>
            )}
            <div className="flex items-center gap-5 flex-wrap">
              <div>
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Buyer</div>
                <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)]">{approval.buyerId}</div>
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Amount</div>
                <MoneyValue paise={approval.amountPaise} />
              </div>
              <div>
                <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Requested</div>
                <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{formatTimestamp(approval.requestedAt)}</div>
              </div>
              {budget !== null && (
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Buyer budget</div>
                  <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] tabular-nums">{formatPaise(budget)}</div>
                </div>
              )}
              {floor !== null && (
                <div>
                  <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Merchant floor</div>
                  <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] tabular-nums">{formatPaise(floor)}</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Link href={`/dashboard/transactions/${approval.orderId}`} className="inline-flex items-center gap-1.5 h-[36px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
              VIEW ORDER <ArrowRight size={11} />
            </Link>
            <button onClick={() => handleReject(approval.orderId)} disabled={busyOrders.has(approval.orderId)} className="inline-flex items-center gap-1.5 h-[36px] px-4 border border-red-400/30 bg-red-400/5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-red-400 hover:bg-red-400/10 transition-all cursor-pointer disabled:opacity-50">
              <XCircle size={12} /> {busyOrders.has(approval.orderId) ? "WORKING…" : "REJECT"}
            </button>
            <button onClick={() => handleApprove(approval.orderId)} disabled={busyOrders.has(approval.orderId)} className="inline-flex items-center gap-1.5 h-[36px] px-4 border border-green-400/30 bg-green-400/5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-green-400 hover:bg-green-400/10 transition-all cursor-pointer disabled:opacity-50">
              <CheckCircle size={12} /> {busyOrders.has(approval.orderId) ? "WORKING…" : "APPROVE"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={approvals.length > 0 ? `${approvals.length} waiting for you` : "Approvals"}
        subtitle="HUMAN APPROVAL REQUIRED"
        actions={
          <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
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
        <div className="border border-[var(--bb-line)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">RECENTLY REVIEWED</div>
            <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mt-0.5">THE BACKEND KEEPS NO REVIEW HISTORY — THIS LIST RESETS ON RELOAD</div>
          </div>
          {reviewed.map((a, i) => (
            <div key={a.orderId} className={`px-5 py-3 flex items-center justify-between gap-3 ${i < reviewed.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
              <div className="flex items-center gap-4 min-w-0">
                <Link href={`/dashboard/transactions/${a.orderId}`} className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] truncate">{a.orderId}</Link>
                <MoneyValue paise={a.amountPaise} size="sm" />
              </div>
              <span className={`shrink-0 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${a.status === "APPROVED" ? "text-green-400" : "text-red-400"}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
