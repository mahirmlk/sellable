"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useSystemStatus } from "@/components/dashboard/use-system-status";
import { formatPaise, formatPaiseDecimal, formatTimeAgo } from "@/lib/formatters";
import { getConsoleTransactions, getConsoleApprovals, getConsoleEvents, getConsoleInsights, type ConsoleTransaction, type LedgerEvent, type ConsoleGrowthMetrics } from "@/lib/api";
import { IconRefresh, IconWarning, IconApprovals } from "@/components/dashboard/icons";
import { type Transaction, type TransactionStatus } from "@/lib/types/domain";

function mapTx(tx: ConsoleTransaction): Transaction {
  // 1:1 with backend OrderStatus — approval need comes from
  // requires_approval, never from rewriting the status.
  const statusMap: Record<string, TransactionStatus> = {
    AWAITING_CONSENT: "AWAITING_CONSENT",
    CONSENTED: "CONSENTED",
    PAYMENT_PENDING: "PAYMENT_PENDING",
    PAID: "PAID",
    PAYMENT_FAILED: "PAYMENT_FAILED",
    ABORTED: "ABORTED",
    REFUNDED: "REFUNDED",
    FULFILLED: "FULFILLED",
  };
  // Carry the backend enrichment through like the Transactions page does —
  // hardcoding channel/policy here showed different data in the two views.
  const channel = tx.channel === "human_chat" ? "human_chat" : "agent_to_agent";
  return {
    id: tx.order_id,
    traceId: tx.trace_id,
    status: statusMap[tx.status] || tx.status as TransactionStatus,
    amountPaise: tx.amount_paise,
    buyer: { id: tx.buyer_agent_id, type: channel === "human_chat" ? "human" : "agent" },
    channel,
    policy: {
      verdict: (tx.policy_verdict as Transaction["policy"]["verdict"]) || "ALLOW",
      reasonCode: tx.policy_reason ?? undefined,
      policyRefs: tx.policy_refs || [],
      explanation: tx.policy_explanation ?? undefined,
    },
    buyerBudgetPaise: tx.buyer_budget_paise ?? undefined,
    updatedAt: tx.created_at,
  };
}

function SectionLabel({ index, title, children }: { index: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-orange)] tabular-nums">{index}</span>
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function OverviewPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [approvals, setApprovals] = useState<Array<{ orderId: string; buyerId: string; amountPaise: number; reason: string; requestedAt: string; status: string }>>([]);
  const [recentEvents, setRecentEvents] = useState<Array<{ id: string; time: string; label: string; type: "info" | "success" | "error" | "warning" }>>([]);
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { data: agentsStatus, error: statusError, reload: reloadStatus } = useSystemStatus();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [txData, approvalData, eventData, growthData] = await Promise.allSettled([
        getConsoleTransactions(),
        getConsoleApprovals(),
        getConsoleEvents(8),
        getConsoleInsights(),
      ]);

      if (
        txData.status === "rejected" &&
        approvalData.status === "rejected" &&
        eventData.status === "rejected" &&
        growthData.status === "rejected"
      ) {
        setLoadError("The backend could not be reached — showing the last loaded state.");
      } else if (
        txData.status === "rejected" ||
        approvalData.status === "rejected" ||
        eventData.status === "rejected" ||
        growthData.status === "rejected"
      ) {
        // Partial failure: render what succeeded, but never present
        // missing sections as genuine zeros.
        setLoadError("Some sections failed to load — figures below may be incomplete.");
      }
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
          return { id: e.event_id, time, label: `${e.actor} — ${e.action}`, type };
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
    <div className="p-6 space-y-6 max-w-[1440px]">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Overview</h1>
          <p className="font-[var(--font-mono)] text-[0.58rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mt-1.5">WHAT IS HAPPENING IN YOUR STORE RIGHT NOW</p>
        </div>
        <button onClick={() => { void fetchData(); reloadStatus(); }} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3.5 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.52rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <IconRefresh size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      {loadError && (
        <div className="border border-amber-400/30 bg-amber-400/5 px-5 py-3 font-[var(--font-mono)] text-[0.62rem] text-amber-400">
          {loadError}
        </div>
      )}

      {/* Metrics — feature revenue card + compact grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr_1fr] grid-rows-[auto_auto] gap-4">
        <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] p-5 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--bb-orange)]" />
          <div className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-4">REVENUE · ALL CHANNELS</div>
          <div className="font-[var(--font-mono)] text-[2.4rem] leading-none text-[var(--bb-white)] tabular-nums tracking-tight">
            {growth ? formatPaiseDecimal(growth.revenue) : "₹0.00"}
          </div>
          <div className="mt-4 flex items-center gap-4 font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase">
            <span className="text-[var(--bb-grey-4)]">{growth?.total_orders ?? transactions.length} ORDERS</span>
            <span className="text-[var(--bb-grey-4)]">·</span>
            <span className="text-[var(--bb-orange)]">
              {growth && growth.total_orders > 0 && growth.revenue > 0 ? Math.round((growth.agent_assisted_revenue / growth.revenue) * 100) : 0}% AGENT-DRIVEN
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 lg:contents">
          <MetricCard label="Orders" value={growth ? growth.total_orders : transactions.length} />
          <MetricCard label="Pending Approvals" value={pendingApprovals.length} highlight />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 lg:col-span-1">
          <MetricCard label="Agent-Assisted" value={growth ? growth.agent_assisted_revenue / 100 : 0} prefix="₹" highlight decimals={2} />
          <MetricCard label="Upsell Revenue" value={growth ? growth.upsell_revenue / 100 : 0} prefix="₹" decimals={2} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Live activity */}
        <div>
          <SectionLabel index="01" title="Live Activity">
            <Link href="/dashboard/activity" className="font-[var(--font-mono)] text-[0.52rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)] transition-colors flex items-center gap-1">VIEW ALL →</Link>
          </SectionLabel>
          <div className="border border-[var(--bb-line)]">
            {recentEvents.length === 0 ? (
              <div className="px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
                {loading ? "Loading events..." : "No events yet. Run a buyer agent or start a chat checkout."}
              </div>
            ) : recentEvents.map((event, i) => (
              <Link key={event.id} href="/dashboard/activity" className={`px-5 py-[11px] flex items-center gap-4 hover:bg-[var(--bb-panel)] transition-colors group ${i < recentEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                <span className="font-[var(--font-mono)] text-[0.58rem] text-[var(--bb-grey-4)] w-[58px] flex-shrink-0 tabular-nums">{event.time}</span>
                <span className={`w-[5px] h-[5px] rotate-45 flex-shrink-0 ${event.type === "success" ? "bg-green-400" : event.type === "error" ? "bg-red-400" : event.type === "warning" ? "bg-yellow-400" : "bg-[var(--bb-grey-3)]"}`} />
                <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-2)] group-hover:text-[var(--bb-white)] transition-colors">{event.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {/* Approvals */}
          {pendingApprovals.length > 0 && (
            <div>
              <SectionLabel index="02" title="Needs Attention" />
              <div className="border border-amber-400/30 bg-amber-400/[0.04] p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <IconWarning size={15} className="text-amber-400" />
                  <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-amber-400">
                    {pendingApprovals.length} TRANSACTION{pendingApprovals.length > 1 ? "S" : ""} AWAITING APPROVAL
                  </span>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-3)]">Highest amount</span>
                  <span className="font-[var(--font-mono)] text-[0.9rem] text-[var(--bb-white)] tabular-nums">{formatPaise(Math.max(...pendingApprovals.map((a) => a.amountPaise)))}</span>
                </div>
                <Link href="/dashboard/approvals" className="inline-flex items-center justify-center gap-2 w-full h-[38px] border border-amber-400/40 bg-amber-400/10 font-[var(--font-mono)] text-[0.58rem] tracking-[0.12em] uppercase text-amber-400 hover:bg-amber-400/20 transition-colors cursor-pointer">
                  <IconApprovals size={12} /> REVIEW APPROVALS
                </Link>
              </div>
            </div>
          )}

          {/* Recent orders */}
          <div>
            <SectionLabel index={pendingApprovals.length > 0 ? "03" : "02"} title="Recent Orders" />
            <div className="border border-[var(--bb-line)]">
              {transactions.length === 0 ? (
                <div className="px-5 py-10 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
                  {loading ? "Loading..." : "No transactions yet."}
                </div>
              ) : transactions.slice(0, 4).map((tx, i) => (
                <Link key={tx.id} href={`/dashboard/transactions/${tx.id}`} className={`px-5 py-3 flex items-center justify-between hover:bg-[var(--bb-panel)] transition-colors group ${i < Math.min(transactions.length, 4) - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div className="min-w-0">
                    <div className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-2)] group-hover:text-[var(--bb-white)] transition-colors truncate max-w-[220px]">{tx.id}</div>
                    <div className="font-[var(--font-mono)] text-[0.52rem] text-[var(--bb-grey-4)] mt-0.5">{formatTimeAgo(tx.updatedAt)}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-[var(--font-mono)] text-[0.82rem] text-[var(--bb-white)] tabular-nums">{formatPaise(tx.amountPaise)}</div>
                    <div className="mt-1"><StatusBadge status={tx.status} /></div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* System health */}
      <div>
        <SectionLabel index={pendingApprovals.length > 0 ? "04" : "03"} title="System Health" />
        {statusError ? (
          <div className="border border-amber-400/30 bg-amber-400/[0.04] px-5 py-4 flex items-start gap-2.5" title={statusError.message}>
            <IconWarning size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <span className="font-[var(--font-mono)] text-[0.6rem] text-amber-400 leading-relaxed">
              {statusError.kind === "auth"
                ? `Authentication problem fetching status (${statusError.message || "re-authenticate or check backend Supabase config"}).`
                : statusError.kind === "network"
                  ? "Backend unreachable while fetching status."
                  : statusError.kind === "endpoint"
                    ? "Wrong status endpoint on the backend."
                    : `Status fetch failed: ${statusError.message}`}
            </span>
          </div>
        ) : (
          <div className="border border-[var(--bb-line)] bg-[var(--bb-panel)] px-5 py-4">
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
                return (
                  <div key={item.label} className="flex items-center gap-2" title={item.detail || undefined}>
                    <span className={`w-[5px] h-[5px] ${dot}`} />
                    <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">{item.label}</span>
                    <span className={`font-[var(--font-mono)] text-[0.55rem] ${text}`}>{state ?? "…"}</span>
                  </div>
                );
              })}
            </div>
            {agentsStatus && (
              <div className="mt-3.5 pt-3.5 border-t border-[var(--bb-line-soft)] flex items-center gap-4">
                <span className="font-[var(--font-mono)] text-[0.5rem] uppercase tracking-[0.08em] text-[var(--bb-grey-4)]">
                  LLM {agentsStatus.llm.enabled ? `${agentsStatus.llm.provider} / ${agentsStatus.llm.model || "default"}` : "SCRIPTED (NO LLM)"}
                </span>
                <span className="font-[var(--font-mono)] text-[0.5rem] uppercase tracking-[0.08em] text-[var(--bb-grey-4)]">
                  {agentsStatus.summary.total_orders} ORDERS · {agentsStatus.summary.paid_orders} PAID
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
