"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { ArrowRight, AlertTriangle, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { formatPaise, formatTimeAgo } from "@/lib/formatters";
import { getConsoleTransactions, getConsoleApprovals, getConsoleEvents, getConsoleInsights, type ConsoleTransaction, type LedgerEvent, type ConsoleGrowthMetrics } from "@/lib/api";
import { type Transaction, type TransactionStatus } from "@/lib/types/domain";

function mapTx(tx: ConsoleTransaction): Transaction {
  const statusMap: Record<string, TransactionStatus> = {
    AWAITING_CONSENT: "NEEDS_HUMAN_APPROVAL",
    CONSENTED: "AWAITING_CONSENT",
    PAYMENT_PENDING: "PAYMENT_PENDING",
    PAID: "PAID",
    PAYMENT_FAILED: "PAYMENT_FAILED",
    ABORTED: "DENIED",
    REFUNDED: "REFUNDED",
    QUOTED: "QUOTED",
    FULFILLED: "PAID",
  };
  return {
    id: tx.order_id,
    traceId: tx.trace_id,
    status: statusMap[tx.status] || tx.status as TransactionStatus,
    amountPaise: tx.amount_paise,
    buyer: { id: tx.buyer_agent_id, type: "agent" },
    channel: "agent_to_agent",
    policy: { verdict: "ALLOW", policyRefs: [] },
    updatedAt: tx.created_at,
  };
}

export default function OverviewPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [approvals, setApprovals] = useState<Array<{ orderId: string; buyerId: string; amountPaise: number; reason: string; requestedAt: string; status: string }>>([]);
  const [recentEvents, setRecentEvents] = useState<Array<{ time: string; label: string; type: "info" | "success" | "error" | "warning" }>>([]);
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: agentsStatus, error: statusError, reload: reloadStatus } = useSystemStatus();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [txData, approvalData, eventData, growthData] = await Promise.allSettled([
        getConsoleTransactions(),
        getConsoleApprovals(),
        getConsoleEvents(8),
        getConsoleInsights(),
      ]);

      if (txData.status === "fulfilled") setTransactions(txData.value.map(mapTx));
      if (approvalData.status === "fulfilled") {
        setApprovals(approvalData.value.map((a) => ({
          orderId: a.order_id,
          buyerId: a.buyer_agent_id,
          amountPaise: a.amount_paise,
          reason: a.reason,
          requestedAt: a.requested_at,
          status: a.status,
        })));
      }
      if (eventData.status === "fulfilled" && eventData.value.events) {
        setRecentEvents(eventData.value.events.map((e: LedgerEvent) => {
          const ts = new Date(e.timestamp);
          const time = ts.toTimeString().slice(0, 8);
          let type: "info" | "success" | "error" | "warning" = "info";
          if (e.action.includes("captured") || e.action.includes("paid") || e.action.includes("allowed")) type = "success";
          else if (e.action.includes("failed") || e.action.includes("aborted")) type = "error";
          else if (e.action.includes("rejected") || e.action.includes("denied")) type = "warning";
          return { time, label: `${e.actor} — ${e.action}`, type };
        }));
      }
      if (growthData.status === "fulfilled") setGrowth(growthData.value);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");

  return (
    <div className="p-6 space-y-6">
      <div className="stagger-child flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Overview</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">WHAT IS HAPPENING IN YOUR STORE RIGHT NOW</p>
        </div>
        <button onClick={() => { void fetchData(); reloadStatus(); }} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 stagger-child">
        <MetricCard label="Revenue" value={growth ? Math.round(growth.revenue / 100) : 0} prefix="₹" />
        <MetricCard label="Orders" value={growth ? growth.total_orders : transactions.length} />
        <MetricCard label="Agent-Assisted" value={growth ? Math.round(growth.agent_assisted_revenue / 100) : 0} prefix="₹" highlight />
        <MetricCard label="Upsell Revenue" value={growth ? Math.round(growth.upsell_revenue / 100) : 0} prefix="₹" />
        <MetricCard label="Pending Approvals" value={pendingApprovals.length} highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">LIVE ACTIVITY</div>
            <Link href="/dashboard/activity" className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] transition-colors flex items-center gap-1">VIEW ALL <ArrowRight size={10} /></Link>
          </div>
          {recentEvents.length === 0 ? (
            <div className="px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
              {loading ? "Loading events..." : "No events yet. Run a buyer agent to see activity."}
            </div>
          ) : recentEvents.map((event, i) => (
            <Link key={i} href="/dashboard/activity" className={`px-5 py-3 flex items-center gap-4 hover-panel ${i < recentEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
              <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] w-[56px] flex-shrink-0">{event.time}</span>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${event.type === "success" ? "bg-green-400" : event.type === "error" ? "bg-red-400" : event.type === "warning" ? "bg-yellow-400" : "bg-[var(--bb-grey-3)]"}`} />
              <span className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-1)]">{event.label}</span>
            </Link>
          ))}
        </div>

        <div className="space-y-4 stagger-child">
          {pendingApprovals.length > 0 && (
            <div className="border border-amber-400/30 bg-amber-400/5 p-5 hover-lift">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-amber-400">{pendingApprovals.length} TRANSACTIONS NEED ATTENTION</span>
              </div>
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.6rem] uppercase text-[var(--bb-grey-3)]">Highest amount</span>
                  <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">{formatPaise(Math.max(...pendingApprovals.map((a) => a.amountPaise)))}</span>
                </div>
              </div>
              <Link href="/dashboard/approvals" className="inline-flex items-center justify-center w-full h-[40px] border border-amber-400/40 bg-amber-400/10 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-amber-400 hover:bg-amber-400/20 transition-colors">Review Approvals</Link>
            </div>
          )}

          <div className="border border-[var(--bb-line)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">RECENT ORDERS</div>
            </div>
            {transactions.length === 0 ? (
              <div className="px-5 py-8 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
                {loading ? "Loading..." : "No transactions yet."}
              </div>
            ) : transactions.slice(0, 4).map((tx, i) => (
              <Link key={tx.id} href={`/dashboard/transactions/${tx.id}`} className={`px-5 py-3 flex items-center justify-between hover-panel ${i < Math.min(transactions.length, 4) - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                <div>
                  <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{tx.id}</div>
                  <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">{formatTimeAgo(tx.updatedAt)}</div>
                </div>
                <div className="text-right">
                  <div className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">{formatPaise(tx.amountPaise)}</div>
                  <StatusBadge status={tx.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="border border-[var(--bb-line)] p-5 stagger-child">
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">SYSTEM HEALTH</div>
        {statusError ? (
          <div className="flex items-start gap-2" title={statusError.message}>
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <span className="font-[var(--font-mono)] text-[0.6rem] text-amber-400">
              {statusError.kind === "auth"
                ? "Authentication problem fetching status — re-authenticate or check backend Supabase config."
                : statusError.kind === "network"
                  ? "Backend unreachable while fetching status."
                  : statusError.kind === "endpoint"
                    ? "Wrong status endpoint on the backend."
                    : `Status fetch failed: ${statusError.message}`}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: "Agent", state: agentsStatus?.seller_agent.state, detail: agentsStatus?.seller_agent.detail },
              { label: "Gateway", state: agentsStatus?.agent_gateway.state, detail: agentsStatus?.agent_gateway.detail },
              { label: "Policy", state: agentsStatus?.policy_engine.state, detail: agentsStatus?.policy_engine.detail },
              { label: "Payments", state: agentsStatus?.payment_rail.state, detail: agentsStatus?.payment_rail.detail },
              { label: "Ledger", state: agentsStatus?.ledger.state, detail: agentsStatus?.ledger.detail },
            ].map((item) => {
              const state = item.state ?? null;
              const dot = state === "CONNECTED" ? "bg-green-500 animate-[blink_3s_ease-in-out_infinite]"
                : state === "UNCONFIGURED" ? "bg-yellow-400"
                  : state === "DEGRADED" ? "bg-amber-400"
                    : state === "ERROR" || state === "OFFLINE" ? "bg-red-400"
                      : "bg-[var(--bb-grey-4)]";
              const text = state === "CONNECTED" ? "text-green-400"
                : state === "UNCONFIGURED" ? "text-yellow-400"
                  : state === "DEGRADED" ? "text-amber-400"
                    : state === "ERROR" || state === "OFFLINE" ? "text-red-400"
                      : "text-[var(--bb-grey-4)]";
              const label = state ?? "…";
              return (
                <div key={item.label} className="flex items-center gap-2" title={item.detail || undefined}>
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">{item.label}</span>
                  <span className={`font-[var(--font-mono)] text-[0.55rem] ${text}`}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
        {agentsStatus && (
          <div className="mt-3 pt-3 border-t border-[var(--bb-line-soft)] flex items-center gap-3">
            <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">
              LLM {agentsStatus.llm.enabled ? `${agentsStatus.llm.provider} / ${agentsStatus.llm.model || "default"}` : "SCRIPTED (NO LLM)"}
            </span>
            <span className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">
              {agentsStatus.summary.total_orders} ORDERS · {agentsStatus.summary.paid_orders} PAID
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
