"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, RotateCcw, RefreshCw } from "lucide-react";
import { StatusBadge, PolicyBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatPaise, formatTimestamp } from "@/lib/formatters";
import { getConsoleTransactionDetail, type ConsoleTransactionDetail, type LedgerEvent as ApiLedgerEvent } from "@/lib/api";
import { type LedgerEvent, type Transaction, type TransactionStatus } from "@/lib/types/domain";

function mapTxDetail(tx: ConsoleTransactionDetail): Transaction {
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

function mapEvents(events: ApiLedgerEvent[]): LedgerEvent[] {
  return events.map((e) => ({
    eventId: e.event_id,
    traceId: e.trace_id,
    timestamp: e.timestamp,
    actor: e.actor as LedgerEvent["actor"],
    action: e.action,
    inputs: e.inputs,
    output: e.output,
    reasoningSummary: e.reasoning_summary ?? undefined,
    policyRefs: e.policy_refs,
    providerRefs: e.provider_ref ? { provider_ref: e.provider_ref } : undefined,
    flags: e.flags,
  }));
}

export default function TransactionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [tx, setTx] = useState<Transaction | null>(null);
  const [txEvents, setTxEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConsoleTransactionDetail(id);
      setTx(mapTxDetail(data));
      setTxEvents(mapEvents(data.events));
    } catch {} finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading transaction...</div>
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="p-6">
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors mb-6">
          <ArrowLeft size={14} /> BACK TO TRANSACTIONS
        </Link>
        <div className="border border-[var(--bb-line)] px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)]">
          Transaction not found.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors">
          <ArrowLeft size={14} /> BACK TO TRANSACTIONS
        </Link>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      <div className="border border-[var(--bb-line)] p-6 stagger-child">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Order #{tx.id}</h1>
              <StatusBadge status={tx.status} />
            </div>
            <div className="flex items-center gap-4">
              <MoneyValue paise={tx.amountPaise} size="lg" />
              <span className="font-[var(--font-mono)] text-[0.6rem] uppercase text-[var(--bb-grey-3)]">Buyer: {tx.buyer.id}</span>
              <span className="font-[var(--font-mono)] text-[0.6rem] uppercase text-[var(--bb-grey-3)]">Channel: {tx.channel === "agent_to_agent" ? "Agent-to-Agent" : "Human Chat"}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/transactions/${tx.id}/replay`} className="inline-flex items-center gap-2 h-[36px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all">
              <RotateCcw size={12} /> VIEW REPLAY
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          {tx.items && tx.items.length > 0 && (
            <div className="border border-[var(--bb-line)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">PURCHASE SUMMARY</div>
              </div>
              {tx.items.map((item, i) => (
                <div key={item.sku} className={`px-5 py-3 flex items-center justify-between ${i < tx.items!.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div>
                    <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">{item.title}</div>
                    <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)]">{item.sku} · Qty {item.qty}</div>
                  </div>
                  <MoneyValue paise={item.pricePaise} />
                </div>
              ))}
              <div className="px-5 py-3 border-t border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">FINAL</span>
                <MoneyValue paise={tx.amountPaise} size="lg" />
              </div>
            </div>
          )}

          {txEvents.length > 0 && (
            <div className="border border-[var(--bb-line)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">EVENT TIMELINE — {txEvents.length} EVENTS</div>
              </div>
              {txEvents.map((event, i) => (
                <div key={event.eventId} className={`px-5 py-3 ${i < txEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] w-[60px] flex-shrink-0 pt-0.5">{formatTimestamp(event.timestamp)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-[var(--bb-grey-2)]">{event.actor}</span>
                        <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{event.action}</span>
                      </div>
                      {event.reasoningSummary && (
                        <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed">{event.reasoningSummary}</div>
                      )}
                      {event.policyRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {event.policyRefs.map((ref) => (
                            <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">{ref}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="border border-[var(--bb-line)] p-5 stagger-child">
            <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">POLICY DECISION</div>
            <div className="mb-4"><PolicyBadge verdict={tx.policy.verdict} /></div>
            {tx.policy.explanation && (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed mb-4">{tx.policy.explanation}</div>
            )}
            <div className="border-t border-[var(--bb-line)] pt-3 mt-3">
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-2">Policies evaluated</div>
              <div className="flex flex-wrap gap-1.5">
                {tx.policy.policyRefs.map((ref) => (
                  <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">{ref}</span>
                ))}
              </div>
            </div>
          </div>

          {tx.consent && (
            <div className="border border-[var(--bb-line)] p-5 stagger-child">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">CONSENT</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Status</span>
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-green-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{tx.consent.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Amount</span>
                  <MoneyValue paise={tx.consent.amountPaise} size="sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Single use</span>
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{tx.consent.singleUse ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Expires</span>
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{formatTimestamp(tx.consent.expiresAt)}</span>
                </div>
              </div>
            </div>
          )}

          {tx.payment && (
            <div className="border border-[var(--bb-line)] p-5">
              <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">PAYMENT</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Provider</span>
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{tx.payment.provider}</span>
                </div>
                {tx.payment.orderId && (
                  <div className="flex items-center justify-between">
                    <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Order ID</span>
                    <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{tx.payment.orderId}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-mono)] text-[0.55rem] uppercase text-[var(--bb-grey-4)]">Status</span>
                  <span className={`font-[var(--font-mono)] text-[0.65rem] ${tx.payment.status === "CAPTURED" ? "text-green-400" : tx.payment.status === "FAILED" ? "text-red-400" : "text-yellow-400"}`}>{tx.payment.status}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
