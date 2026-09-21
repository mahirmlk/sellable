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
  return <div className="text-[12px] text-neutral-500">{children}</div>;
}

function Value({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-neutral-900 break-words">{children}</div>;
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
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <div className="text-[13px] text-neutral-500">Loading order…</div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to orders
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
      <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to orders
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
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to orders
        </Link>
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      {/* Header: order + status + amount + buyer */}
      <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 break-all">
                Order #{tx.id}
              </h1>
              <StatusBadge status={tx.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <MoneyValue paise={tx.amountPaise} size="lg" />
              <span className="text-[13px] text-neutral-500">
                Buyer: {tx.buyer.id} ({buyerLabel})
              </span>
              <ChannelBadge channel={tx.channel} />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/dashboard/transactions/${tx.id}/replay`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:bg-neutral-50 transition-all"
            >
              <RotateCcw size={12} /> View replay
            </Link>
            {(tx.status === "PAID" || tx.status === "FULFILLED") && (
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-red-50 text-red-700 border border-red-200/60 text-[13px] font-medium hover:bg-red-100 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={12} /> {refunding ? "Refunding…" : "Refund"}
              </button>
            )}
          </div>
        </div>
      </div>

      {refundMsg === "success" && (
        <div className="rounded-2xl bg-green-50 border border-green-200/60 px-6 py-4">
          <span className="text-[13px] text-green-700">
            Refund initiated. The ledger records the refund as an auditable event.
          </span>
        </div>
      )}
      {refundMsg === "error" && (
        <div className="rounded-2xl bg-red-50 border border-red-200/60 px-6 py-4">
          <span className="text-[13px] text-red-700">
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
            className={`h-9 px-4 rounded-full text-[13px] font-medium border transition-all cursor-pointer ${
              tab === t.key
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white border-black/10 text-neutral-600 hover:bg-neutral-50 shadow-sm"
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
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-600 hover:bg-neutral-50 transition-all"
        >
          Replay <ExternalLink size={11} />
        </Link>
      </div>

      {tab === "overview" && (
        <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-6 py-4 border-b border-black/[0.06]">
            <div className="text-[15px] font-semibold text-neutral-900">Order overview</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 px-6 py-2">
            {[
              { label: "Buyer", value: `${tx.buyer.id} (${buyerLabel})` },
              { label: "Channel", value: tx.channel === "agent_to_agent" ? "Agent-to-agent" : "Human chat" },
              { label: "Amount", value: formatPaise(tx.amountPaise) },
              { label: "Status", value: tx.status.replace(/_/g, " ") },
              { label: "Created", value: formatDateTime(tx.updatedAt) },
              { label: "Trace", value: tx.traceId },
            ].map((row) => (
              <div key={row.label} className="py-3 border-b border-black/[0.06] space-y-1.5">
                <Label>{row.label}</Label>
                <Value>{row.value}</Value>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-black/[0.06] bg-neutral-50/50">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-neutral-500">Policy</span>
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
              <div className="hidden lg:grid grid-cols-[1fr_70px_110px_110px_110px] gap-3 px-6 py-4 border-b border-black/[0.06]">
                {["SKU", "Qty", "Unit price", "Offered", "Line total"].map((h) => (
                  <div key={h} className="text-[12px] font-medium text-neutral-500">{h}</div>
                ))}
              </div>
              {items.map((item, i) => (
                <div
                  key={`${item.sku}-${i}`}
                  className={`hidden lg:grid grid-cols-[1fr_70px_110px_110px_110px] gap-3 px-6 py-3 items-center ${
                    i < items.length - 1 ? "border-b border-black/[0.06]" : ""
                  }`}
                >
                  <div className="text-[14px] text-neutral-900">{item.sku}</div>
                  <div className="text-[13px] text-neutral-500 tabular-nums">{item.quantity}</div>
                  <div className="text-[13px] text-neutral-500 tabular-nums">{formatPaise(item.unit_price_paise)}</div>
                  <div className="text-[13px] text-neutral-900 tabular-nums">{formatPaise(item.offered_price_paise)}</div>
                  <MoneyValue paise={item.line_total_paise} />
                </div>
              ))}
              <div className="lg:hidden divide-y divide-black/[0.06]">
                {items.map((item, i) => (
                  <div key={`${item.sku}-${i}`} className="px-6 py-3.5 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] text-neutral-900">{item.sku}</span>
                      <MoneyValue paise={item.line_total_paise} />
                    </div>
                    <div className="text-[12px] text-neutral-400 tabular-nums">
                      Qty {item.quantity} · Unit {formatPaise(item.unit_price_paise)} · Offered {formatPaise(item.offered_price_paise)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-black/[0.06] bg-neutral-50/50 flex items-center justify-between">
                <span className="text-[13px] font-medium text-neutral-600">Final</span>
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
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">
                  Listed vs agreed — {negotiatedItems.length} item{negotiatedItems.length > 1 ? "s" : ""} negotiated
                </div>
              </div>
              {negotiatedItems.map((item, i) => (
                <div
                  key={`${item.sku}-${i}`}
                  className={`px-6 py-3.5 grid grid-cols-2 sm:grid-cols-4 gap-4 ${
                    i < negotiatedItems.length - 1 ? "border-b border-black/[0.06]" : ""
                  }`}
                >
                  <div className="space-y-1.5">
                    <Label>Item</Label>
                    <Value>{item.sku} ×{item.quantity}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Listed</Label>
                    <Value>{formatPaise(item.unit_price_paise)}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Buyer offer</Label>
                    <Value>{formatPaise(item.offered_price_paise)}</Value>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Final</Label>
                    <Value>{formatPaise(item.line_total_paise)}</Value>
                  </div>
                </div>
              ))}
            </DataTable>
          )}
          {negotiationEvents.length > 0 && (
            <DataTable>
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">Related ledger events</div>
              </div>
              {negotiationEvents.map((event, i) => (
                <div key={event.eventId} className={`px-6 py-3 ${i < negotiationEvents.length - 1 ? "border-b border-black/[0.06]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] text-neutral-400 w-[60px] flex-shrink-0 pt-0.5 tabular-nums">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-medium text-neutral-500">{event.actor}</span>
                        <span className="text-[13px] text-neutral-900">{event.action}</span>
                      </div>
                      {event.reasoningSummary && (
                        <div className="text-[13px] text-neutral-600 leading-relaxed">{event.reasoningSummary}</div>
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
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">Payment</div>
              </div>
              <div className="px-6 py-2">
                {[
                  { label: "Provider", value: tx.payment.provider },
                  {
                    label: "Status",
                    value: (
                      <span
                        className={
                          tx.payment.status === "CAPTURED"
                            ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700"
                            : tx.payment.status === "FAILED"
                              ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-red-50 text-red-700"
                              : "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-amber-50 text-amber-800"
                        }
                      >
                        {tx.payment.status}
                      </span>
                    ),
                  },
                  ...(tx.payment.orderId ? [{ label: "Provider order id", value: tx.payment.orderId }] : []),
                  ...(tx.payment.paymentId ? [{ label: "Payment id", value: tx.payment.paymentId }] : []),
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-3 border-b border-black/[0.06] last:border-b-0">
                    <Label>{row.label}</Label>
                    <Value>{row.value}</Value>
                  </div>
                ))}
              </div>
              {tx.payment.paymentUrl && (
                <div className="px-6 py-4 border-t border-black/[0.06]">
                  <a
                    href={tx.payment.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#0071e3] text-white text-[13px] font-medium hover:bg-[#0077ed] transition-colors"
                  >
                    Open payment link <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {tx.payment.verifiedByWebhook && (
                <div className="px-6 py-4 border-t border-black/[0.06]">
                  <span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700">
                    Confirmed by verified webhook
                  </span>
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
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">Approval</div>
              </div>
              <div className="px-6 py-2">
                {[
                  { label: "Approval required", value: "Yes" },
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
                            ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700"
                            : approval?.status === "REJECTED"
                              ? "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-red-50 text-red-700"
                              : "inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-amber-50 text-amber-800"
                        }
                      >
                        {approval?.status ?? "Pending"}
                      </span>
                    ),
                  },
                  ...(approval?.requested_at
                    ? [{ label: "Requested", value: formatDateTime(approval.requested_at) }]
                    : []),
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-3 border-b border-black/[0.06] last:border-b-0">
                    <Label>{row.label}</Label>
                    <Value>{row.value}</Value>
                  </div>
                ))}
              </div>
              {(!approval || approval.status === "PENDING") && (
                <div className="px-6 py-4 border-t border-black/[0.06]">
                  <Link
                    href="/dashboard/approvals"
                    className="inline-flex items-center h-9 px-4 rounded-full bg-amber-50 text-amber-800 border border-amber-200/60 text-[13px] font-medium hover:bg-amber-100 transition-colors"
                  >
                    Review in approvals →
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
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">
                  Event timeline — {txEvents.length} events
                </div>
              </div>
              {txEvents.map((event, i) => (
                <div key={event.eventId} className={`px-6 py-3 ${i < txEvents.length - 1 ? "border-b border-black/[0.06]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] text-neutral-400 w-[60px] flex-shrink-0 pt-0.5 tabular-nums">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-medium text-neutral-500">{event.actor}</span>
                        <span className="text-[13px] text-neutral-900">{event.action}</span>
                      </div>
                      {event.reasoningSummary && (
                        <div className="text-[13px] text-neutral-600 leading-relaxed">{event.reasoningSummary}</div>
                      )}
                      {event.policyRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {event.policyRefs.map((ref) => (
                            <span key={ref} className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600">{ref}</span>
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
