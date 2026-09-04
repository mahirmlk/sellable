"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ShieldCheck, CheckCircle, XCircle, RefreshCw, ArrowRight } from "lucide-react";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatTimestamp } from "@/lib/formatters";
import { getConsoleApprovals, approveConsoleOrder, rejectConsoleOrder, continueBuyerMission, type ConsoleApproval } from "@/lib/api";

function mapApproval(a: ConsoleApproval) {
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
  type ApprovalRow = { orderId: string; buyerId: string; amountPaise: number; reason: string; requestedAt: string; status: string };
  // `approvals` mirrors the backend queue (always PENDING rows); `reviewed`
  // is this session's acted-upon record — the approval/rejection itself is
  // persisted on the order backend-side, and the refetch below reconciles
  // the pending list with backend truth.
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [reviewed, setReviewed] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Per-order busy flags: double-clicking approve/reject must not fire the
  // request twice (the second call 400s after the first one lands).
  const [busyOrders, setBusyOrders] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (silent = false) => {
    // Polls run silently: only the opening fetch may flip the full-page
    // loading state, otherwise the queue flickers every 12 seconds.
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await getConsoleApprovals();
      setApprovals(data.map(mapApproval));
    } catch (err) {
      if (silent) return; // keep the last good list on background failures
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — approvals could not be loaded."
          : "Approvals could not be loaded from the backend."
      );
    } finally { if (!silent) setLoading(false); }
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

  const pending = approvals;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Approvals</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">HUMAN APPROVAL REQUIRED</p>
        </div>
        <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      {loadError && (
        <div className="border border-amber-400/30 bg-amber-400/5 px-5 py-3 flex items-start gap-2">
          <span className="font-[var(--font-mono)] text-[0.62rem] text-amber-400">{loadError}</span>
        </div>
      )}
      {actionError && (
        <div className="border border-red-400/30 bg-red-400/5 px-5 py-3 flex items-start gap-2">
          <span className="font-[var(--font-mono)] text-[0.62rem] text-red-400">{actionError}</span>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="border border-[var(--bb-line)] px-5 py-12 text-center">
          <ShieldCheck size={32} className="text-[var(--bb-grey-4)] mx-auto mb-3" />
          <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] mb-2">
            {loading ? "Loading..." : "No approvals pending."}
          </div>
          <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-4)]">
            Transactions below your configured approval threshold can proceed automatically.
          </div>
        </div>
      ) : (
        <div className="space-y-4 stagger-child">
          {pending.map((approval) => (
            <div key={approval.orderId} className="border border-amber-400/30 bg-amber-400/5 p-5 hover-lift">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">{approval.orderId}</span>
                    <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-amber-400">{approval.reason}</span>
                  </div>
                  <div className="flex items-center gap-4">
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
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/dashboard/transactions/${approval.orderId}`} className="inline-flex items-center gap-1.5 h-[36px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
                    VIEW CART <ArrowRight size={11} />
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
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="border border-[var(--bb-line)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">REVIEWED THIS SESSION</div>
            <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mt-0.5">THE BACKEND KEEPS NO REVIEW HISTORY — THIS LIST RESETS ON RELOAD</div>
          </div>
          {reviewed.map((a, i) => (
            <div key={a.orderId} className={`px-5 py-3 flex items-center justify-between ${i < reviewed.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
              <div className="flex items-center gap-4">
                <span className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{a.orderId}</span>
                <MoneyValue paise={a.amountPaise} size="sm" />
              </div>
              <span className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${a.status === "APPROVED" ? "text-green-400" : "text-red-400"}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
