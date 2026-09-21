"use client";

// Order detail (route /dashboard/transactions/[id]): header with order,
// status, amount, buyer; tabs for Overview / Items / Negotiation / Payment /
// Approval / Activity; Replay links to the existing replay route. Negotiation
// figures come only from the loaded line items and ledger events — nothing is
// invented. Refund stays wired to the existing refundOrder call.

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, RotateCcw, ExternalLink } from "lucide-react";
import { StatusBadge, PolicyBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatPaise, formatDateTime, formatTimestamp } from "@/lib/formatters";
import {
  getConsoleApprovals,
  getConsoleTransactionDetail,
  refundOrder,
  ApiError,
  type ConsoleApproval,
  type ConsoleTransactionDetail,
  type LedgerEvent as ApiLedgerEvent,
} from "@/lib/api";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  ChannelBadge,
  RefreshButton,
} from "@/components/dashboard/commerce-ui";
import { mapConsoleTx } from "@/lib/commerce-view";
import type { LedgerEvent, Transaction } from "@/lib/types/domain";

type DetailTab = "overview" | "items" | "negotiation" | "payment" | "approval" | "activity";

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "items", label: "Items" },
  { key: "negotiation", label: "Negotiation" },
  { key: "payment", label: "Payment" },
  { key: "approval", label: "Approval" },
  { key: "activity", label: "Activity" },
];

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
    outcome_effect: e.outcome_effect ?? null,
    provider_ref: e.provider_ref ?? null,
    flags: e.flags,
  }));
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-[var(--font-mono)] text-[0.78rem] text-[var(--bb-white)] break-words">
      {children}
    </div>
  );
}

export default function TransactionDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [tx, setTx] = useState<Transaction | null>(null);
  const [detail, setDetail] = useState<ConsoleTransactionDetail | null>(null);
  const [txEvents, setTxEvents] = useState<LedgerEvent[]>([]);
  const [approval, setApproval] = useState<ConsoleApproval | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundMsg, setRefundMsg] = useState<"success" | "error" | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const [data, approvals] = await Promise.all([
        getConsoleTransactionDetail(id),
        getConsoleApprovals().catch(() => [] as ConsoleApproval[]),
      ]);
      setDetail(data);
      setTx(mapConsoleTx(data));
      setTxEvents(mapEvents(data.events));
      setApproval(approvals.find((a) => a.order_id === data.order_id) ?? null);
    } catch (err) {
      setTx(null);
      setDetail(null);
      setTxEvents([]);
      if (err instanceof ApiError && err.isNotFound) {
        setNotFound(true);
      } else {
        setLoadError(
          err instanceof TypeError
            ? "Backend unreachable — the order could not be loaded."
            : "The order could not be loaded from the backend."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const handleRefund = useCallback(async () => {
    if (!tx || refunding) return;
    setRefunding(true);
    setRefundMsg(null);
    try {
      await refundOrder(tx.id, "Merchant-initiated refund from order detail");
      setRefundMsg("success");
      await fetchData();
    } catch {
      setRefundMsg("error");
    } finally {
      setRefunding(false);
    }
  }, [tx, refunding, fetchData]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
          Loading order…
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO ORDERS
        </Link>
        <EmptyState
          title="Order not found"
          message="This order was not found — it may belong to another store."
        />
      </div>
    );
  }

  if (loadError || !tx || !detail) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO ORDERS
        </Link>
        <ErrorBanner message={loadError ?? "The order could not be loaded."} onRetry={() => void fetchData()} />
      </div>
    );
  }

  const items = detail.items ?? [];
  const negotiatedItems = items.filter((i) => i.offered_price_paise !== i.unit_price_paise);
  const negotiationEvents = txEvents.filter((e) =>
    /counter|negotiat|offer|quote/i.test(e.action)
  );
  const approvalRequired =
    tx.policy.verdict === "NEEDS_HUMAN_APPROVAL" || approval !== null;
  const buyerLabel = tx.buyer.type === "human" ? "Human" : "AI Buyer";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO ORDERS
        </Link>
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      {/* Header: order + status + amount + buyer */}
      <div className="border border-[var(--bb-line)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)] break-all">
                Order #{tx.id}
              </h1>
              <StatusBadge status={tx.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <MoneyValue paise={tx.amountPaise} size="lg" />
              <span className="font-[var(--font-mono)] text-[0.6rem] uppercase text-[var(--bb-grey-3)]">
                Buyer: {tx.buyer.id} ({buyerLabel})
              </span>
              <ChannelBadge channel={tx.channel} />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/dashboard/transactions/${tx.id}/replay`}
              className="inline-flex items-center gap-2 h-[36px] px-4 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all"
            >
              <RotateCcw size={12} /> VIEW REPLAY
            </Link>
            {(tx.status === "PAID" || tx.status === "FULFILLED") && (
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="inline-flex items-center gap-2 h-[36px] px-4 border border-red-400/30 bg-red-400/5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-red-400 hover:bg-red-400/10 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={12} /> {refunding ? "REFUNDING…" : "REFUND"}
              </button>
            )}
          </div>
        </div>
      </div>

      {refundMsg === "success" && (
        <div className="border border-green-400/30 bg-green-400/5 px-5 py-3">
          <span className="font-[var(--font-mono)] text-[0.65rem] text-green-400">
            Refund initiated. The ledger records the refund as an auditable event.
          </span>
        </div>
      )}
      {refundMsg === "error" && (
        <div className="border border-red-400/30 bg-red-400/5 px-5 py-3">
          <span className="font-[var(--font-mono)] text-[0.65rem] text-red-400">
            Refund failed. The backend rejected the request.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all cursor-pointer ${
              tab === t.key
                ? "border-[var(--bb-orange)] bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]"
                : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)]"
            }`}
          >
            {t.label}
            {t.key === "items" && items.length > 0 && (
              <span className="ml-1.5 tabular-nums opacity-80">{items.length}</span>
            )}
            {t.key === "activity" && txEvents.length > 0 && (
              <span className="ml-1.5 tabular-nums opacity-80">{txEvents.length}</span>
            )}
          </button>
        ))}
        <Link
          href={`/dashboard/transactions/${tx.id}/replay`}
          className="inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-1.5 border border-[var(--bb-line)] text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all"
        >
          REPLAY <ExternalLink size={11} />
        </Link>
      </div>

      {tab === "overview" && (
        <div className="border border-[var(--bb-line)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
              ORDER OVERVIEW
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 px-5 py-2">
            {[
              { label: "Buyer", value: `${tx.buyer.id} (${buyerLabel})` },
              { label: "Channel", value: tx.channel === "agent_to_agent" ? "Agent-to-agent" : "Human chat" },
              { label: "Amount", value: formatPaise(tx.amountPaise) },
              { label: "Status", value: tx.status.replace(/_/g, " ") },
              { label: "Created", value: formatDateTime(tx.updatedAt) },
              { label: "Trace", value: tx.traceId },
            ].map((row) => (
              <div key={row.label} className="py-3 border-b border-[var(--bb-line-soft)] space-y-1.5">
                <Label>{row.label}</Label>
                <Value>{row.value}</Value>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="flex items-center gap-3">
              <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase text-[var(--bb-grey-4)]">
                POLICY
              </span>
              <PolicyBadge verdict={tx.policy.verdict} />
            </div>
          </div>
        </div>
      )}

      {tab === "items" && (
        <>
          {items.length === 0 ? (
            <EmptyState
              title="No line items"
              message="The backend returned no line items for this order."
            />
          ) : (
            <DataTable>
              <div className="hidden lg:grid grid-cols-[1fr_70px_110px_110px_110px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                {["SKU", "QTY", "UNIT PRICE", "OFFERED", "LINE TOTAL"].map((h) => (
                  <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
                ))}
              </div>
              {items.map((item, i) => (
                <div
                  key={`${item.sku}-${i}`}
                  className={`hidden lg:grid grid-cols-[1fr_70px_110px_110px_110px] gap-3 px-5 py-3 items-center ${
                    i < items.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                  }`}
                >
                  <div className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">{item.sku}</div>
                  <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-2)] tabular-nums">{item.quantity}</div>
                  <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-grey-3)] tabular-nums">{formatPaise(item.unit_price_paise)}</div>
                  <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] tabular-nums">{formatPaise(item.offered_price_paise)}</div>
                  <MoneyValue paise={item.line_total_paise} />
                </div>
              ))}
              <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
                {items.map((item, i) => (
                  <div key={`${item.sku}-${i}`} className="px-5 py-3.5 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">{item.sku}</span>
                      <MoneyValue paise={item.line_total_paise} />
                    </div>
                    <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] tabular-nums">
                      QTY {item.quantity} · UNIT {formatPaise(item.unit_price_paise)} · OFFERED {formatPaise(item.offered_price_paise)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
                <span className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">FINAL</span>
                <MoneyValue paise={tx.amountPaise} size="lg" />
              </div>
            </DataTable>
          )}
        </>
      )}

      {tab === "negotiation" && (
        <div className="space-y-6">
          {negotiatedItems.length === 0 ? (
            <EmptyState
              title="No negotiation on this order"
              message="Every line item was bought at its listed price — the buyer made no counter-offer."
            />
          ) : (
            <DataTable>
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  LISTED VS AGREED — {negotiatedItems.length} ITEM{negotiatedItems.length > 1 ? "S" : ""} NEGOTIATED
                </div>
              </div>
              {negotiatedItems.map((item, i) => (
                <div
                  key={`${item.sku}-${i}`}
                  className={`px-5 py-3.5 grid grid-cols-2 sm:grid-cols-4 gap-4 ${
                    i < negotiatedItems.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                  }`}
                >
                  <div className="space-y-1.5">
                    <Label>ITEM</Label>
                    <Value>{item.sku} ×{item.quantity}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>LISTED</Label>
                    <Value>{formatPaise(item.unit_price_paise)}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>BUYER OFFER</Label>
                    <Value>{formatPaise(item.offered_price_paise)}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>FINAL</Label>
                    <Value>{formatPaise(item.line_total_paise)}</Value>
                  </div>
                </div>
              ))}
            </DataTable>
          )}
          {negotiationEvents.length > 0 && (
            <DataTable>
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  RELATED LEDGER EVENTS
                </div>
              </div>
              {negotiationEvents.map((event, i) => (
                <div key={event.eventId} className={`px-5 py-3 ${i < negotiationEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] w-[60px] flex-shrink-0 pt-0.5">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-[var(--bb-grey-2)]">{event.actor}</span>
                        <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-white)]">{event.action}</span>
                      </div>
                      {event.reasoningSummary && (
                        <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed">{event.reasoningSummary}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </DataTable>
          )}
        </div>
      )}

      {tab === "payment" && (
        <>
          {!tx.payment ? (
            <EmptyState
              title="No payment recorded"
              message="No payment attempt has been recorded for this order yet."
            />
          ) : (
            <div className="border border-[var(--bb-line)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  PAYMENT
                </div>
              </div>
              <div className="px-5 py-2">
                {[
                  { label: "Provider", value: tx.payment.provider },
                  {
                    label: "Status",
                    value: (
                      <span
                        className={
                          tx.payment.status === "CAPTURED"
                            ? "text-green-400"
                            : tx.payment.status === "FAILED"
                              ? "text-red-400"
                              : "text-yellow-400"
                        }
                      >
                        {tx.payment.status}
                      </span>
                    ),
                  },
                  ...(tx.payment.orderId ? [{ label: "Provider order id", value: tx.payment.orderId }] : []),
                  ...(tx.payment.paymentId ? [{ label: "Payment id", value: tx.payment.paymentId }] : []),
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
                    <Label>{row.label}</Label>
                    <Value>{row.value}</Value>
                  </div>
                ))}
              </div>
              {tx.payment.paymentUrl && (
                <div className="px-5 py-4 border-t border-[var(--bb-line)]">
                  <a
                    href={tx.payment.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-[36px] px-4 border border-[var(--bb-orange)]/50 bg-[var(--bb-orange)]/10 font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:bg-[var(--bb-orange)]/20 transition-colors"
                  >
                    OPEN PAYMENT LINK <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {tx.payment.verifiedByWebhook && (
                <div className="px-5 py-3 border-t border-[var(--bb-line-soft)] font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] text-green-400">
                  Confirmed by verified webhook
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "approval" && (
        <>
          {!approvalRequired ? (
            <EmptyState
              title="No approval needed"
              message="This order did not require human approval — the policy decision allowed it through."
            />
          ) : (
            <div className="border border-[var(--bb-line)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  APPROVAL
                </div>
              </div>
              <div className="px-5 py-2">
                {[
                  { label: "Approval required", value: "YES" },
                  {
                    label: "Reason",
                    value: approval?.reason ?? tx.policy.reasonCode ?? "Policy review",
                  },
                  {
                    label: "Status",
                    value: (
                      <span
                        className={
                          approval?.status === "APPROVED"
                            ? "text-green-400"
                            : approval?.status === "REJECTED"
                              ? "text-red-400"
                              : "text-amber-400"
                        }
                      >
                        {approval?.status ?? "PENDING"}
                      </span>
                    ),
                  },
                  ...(approval?.requested_at
                    ? [{ label: "Requested", value: formatDateTime(approval.requested_at) }]
                    : []),
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-3 border-b border-[var(--bb-line-soft)] last:border-b-0">
                    <Label>{row.label}</Label>
                    <Value>{row.value}</Value>
                  </div>
                ))}
              </div>
              {(!approval || approval.status === "PENDING") && (
                <div className="px-5 py-4 border-t border-[var(--bb-line)]">
                  <Link
                    href="/dashboard/approvals"
                    className="inline-flex items-center h-[36px] px-4 border border-amber-400/40 bg-amber-400/10 font-[var(--font-mono)] text-[0.58rem] tracking-[0.1em] uppercase text-amber-400 hover:bg-amber-400/20 transition-colors"
                  >
                    REVIEW IN APPROVALS →
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "activity" && (
        <>
          {txEvents.length === 0 ? (
            <EmptyState
              title="No activity yet"
              message="No ledger events have been recorded for this order yet."
            />
          ) : (
            <DataTable>
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  EVENT TIMELINE — {txEvents.length} EVENTS
                </div>
              </div>
              {txEvents.map((event, i) => (
                <div key={event.eventId} className={`px-5 py-3 ${i < txEvents.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] w-[60px] flex-shrink-0 pt-0.5">
                      {formatTimestamp(event.timestamp)}
                    </span>
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
            </DataTable>
          )}
        </>
      )}
    </div>
  );
}
