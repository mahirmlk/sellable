"use client";

// Order detail (route /dashboard/transactions/[id]): header with order,
// status, amount, buyer; tabs for Overview / Items / Negotiation / Payment /
// Approval / Activity; Replay links to the existing replay route. Negotiation
// figures come only from the loaded line items and ledger events — nothing is
// invented. Refund is irreversible, so it goes through a type-to-confirm
// ConfirmDialog before the existing refundOrder call. PAID orders can be
// marked FULFILLED via the documented POST /console/orders/{id}/fulfill.
// Every rendered field comes from the loaded ConsoleTransactionDetail.

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { RotateCcw, ExternalLink, PackageCheck, Copy, Download } from "lucide-react";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { StatusBadge, PolicyBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatPaise, formatDateTime, formatTimestamp } from "@/lib/formatters";
import {
  getConsoleApprovals,
  getConsoleTransactionDetail,
  refundOrder,
  fulfillOrder,
  ApiError,
  type ConsoleApproval,
  type ConsoleTransactionDetail,
  type LedgerEvent as ApiLedgerEvent,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { toast } from "@/components/dashboard/toasts";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  ChannelBadge,
  RefreshButton,
} from "@/components/dashboard/commerce-ui";
import { exportToCsv } from "@/lib/csv";
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

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ tone: "success", title: "Copied" });
  } catch {
    toast({
      tone: "error",
      title: "Copy failed",
      description: "The browser denied clipboard access.",
    });
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => void copyToClipboard(value)}
      className="size-6 rounded-full inline-flex items-center justify-center text-faint hover:text-ink hover:bg-panel-3 transition-colors cursor-pointer shrink-0"
    >
      <Copy size={12} />
    </button>
  );
}

function MonoRef({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px] text-faint shrink-0">{label}</span>
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-[12px] text-ink-2 break-all">{value}</span>
        <CopyButton value={value} label={label} />
      </span>
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
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  // Optional partial-refund amount in INR rupees (converted to paise).
  // Defaults to the full order amount when the dialog opens.
  const [refundAmountRupees, setRefundAmountRupees] = useState("");
  const [fulfilling, setFulfilling] = useState(false);

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

  // Runs only after the ConfirmDialog is confirmed (type-to-confirm "REFUND").
  // Optional partial amount: below the full order amount it calls refundOrder
  // with amountPaise + an idempotency key; otherwise a full refund as today.
  const handleRefund = useCallback(async () => {
    if (!tx || refunding) return;
    const orderId = tx.id;
    const fullPaise = tx.amountPaise;
    const parsed = parseFloat(refundAmountRupees);
    const refundPaise = Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
    const valid = Number.isFinite(refundPaise) && refundPaise > 0 && refundPaise <= fullPaise;
    if (!valid) return;
    const isPartial = refundPaise < fullPaise;
    setRefunding(true);
    setRefundMsg(null);
    try {
      if (isPartial) {
        await refundOrder(orderId, "Merchant-initiated refund from order detail", {
          amountPaise: refundPaise,
          idempotencyKey: crypto.randomUUID(),
        });
      } else {
        await refundOrder(orderId, "Merchant-initiated refund from order detail");
      }
      setRefundMsg("success");
      setRefundDialogOpen(false);
      await fetchData();
      toast({
        tone: "success",
        title: "Refund initiated",
        description: `Order ${orderId} — ${formatPaise(isPartial ? refundPaise : fullPaise)} refunded. The ledger records the refund as an auditable event.`,
      });
    } catch {
      setRefundMsg("error");
      setRefundDialogOpen(false);
      toast({
        tone: "error",
        title: "Refund failed",
        description: "The backend rejected the request.",
      });
    } finally {
      setRefunding(false);
    }
  }, [tx, refunding, fetchData, refundAmountRupees]);

  // Routine op (PAID → FULFILLED) — no confirmation dialog.
  const handleFulfill = useCallback(async () => {
    if (!tx || fulfilling) return;
    const orderId = tx.id;
    setFulfilling(true);
    try {
      await fulfillOrder(orderId);
      await fetchData();
      toast({ tone: "success", title: "Order marked fulfilled" });
    } catch {
      toast({
        tone: "error",
        title: "Could not mark order fulfilled",
        description: "The backend rejected the request.",
      });
    } finally {
      setFulfilling(false);
    }
  }, [tx, fulfilling, fetchData]);

  const handleExportItems = useCallback(() => {
    if (!detail) return;
    const rows = (detail.items ?? []).map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      unit_price_inr: (item.unit_price_paise / 100).toFixed(2),
      offered_price_inr: (item.offered_price_paise / 100).toFixed(2),
      line_total_inr: (item.line_total_paise / 100).toFixed(2),
    }));
    exportToCsv(`order_${detail.order_id}_items.csv`, rows);
    toast({ tone: "success", title: `Exported order_${detail.order_id}_items.csv`, description: `${rows.length} rows` });
  }, [detail]);

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
        <Breadcrumbs
          items={[{ label: "Orders", href: "/dashboard/transactions" }, { label: `#${id}` }]}
        />
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
        <Breadcrumbs
          items={[{ label: "Orders", href: "/dashboard/transactions" }, { label: `#${id}` }]}
        />
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
  // `failure_reason` is part of the PaymentAttemptPayload contract. The order
  // detail only carries it when a failed payment attempt reported one — read
  // it defensively and render only when the field actually exists (never invented).
  const rawFailureReason = (detail as { failure_reason?: unknown }).failure_reason;
  const failureReason =
    typeof rawFailureReason === "string" && rawFailureReason.length > 0 ? rawFailureReason : null;
  // Partial-refund amount: rupees input converted to paise. Valid when > 0
  // and <= the full order amount; the confirm button is disabled otherwise.
  const refundParsed = parseFloat(refundAmountRupees);
  const refundPaise = Number.isFinite(refundParsed) ? Math.round(refundParsed * 100) : NaN;
  const isRefundAmountValid =
    Number.isFinite(refundPaise) && refundPaise > 0 && refundPaise <= tx.amountPaise;
  const refundDisplayPaise = isRefundAmountValid ? refundPaise : tx.amountPaise;

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3">
        <Breadcrumbs
          items={[{ label: "Orders", href: "/dashboard/transactions" }, { label: `#${tx.id}` }]}
        />
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      {/* Header: order + status + amount + buyer */}
      <div className="rounded-[18px] bg-panel border border-hairline shadow-card p-6">
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
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-panel border border-hairline text-[13px] font-medium text-ink-2 hover:text-ink transition-all"
            >
              <RotateCcw size={12} /> View replay
            </Link>
            {tx.status === "PAID" && (
              <button
                onClick={() => void handleFulfill()}
                disabled={fulfilling}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ink text-panel text-[13px] font-medium hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
              >
                <PackageCheck size={12} /> {fulfilling ? "Fulfilling…" : "Mark fulfilled"}
              </button>
            )}
            {(tx.status === "PAID" || tx.status === "FULFILLED") && (
              <button
                onClick={() => {
                  setRefundAmountRupees(String(tx.amountPaise / 100));
                  setRefundDialogOpen(true);
                }}
                disabled={refunding}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-red-600 text-panel text-[13px] font-medium hover:bg-red-700 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={12} /> Refund
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
        <div className="rounded-[18px] bg-panel border border-hairline shadow-card overflow-hidden">
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
          <div className="px-6 py-4 border-t border-black/[0.06] bg-panel-2">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-neutral-500">Policy</span>
              <PolicyBadge verdict={tx.policy.verdict} />
            </div>
            {tx.policy.explanation && (
              <p className="mt-3 text-[13px] leading-relaxed text-muted">{tx.policy.explanation}</p>
            )}
          </div>
          <div className="px-6 py-3 border-t border-black/[0.06]">
            <div className="text-[12px] text-faint mb-1">References</div>
            <MonoRef label="quote_id" value={detail.quote_id} />
            <MonoRef label="idempotency_key" value={detail.idempotency_key} />
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
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[12px] text-neutral-400 tabular-nums">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
                <button
                  onClick={handleExportItems}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98] ml-auto"
                >
                  <Download size={14} /> Export
                </button>
              </div>
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
              <div className="px-6 py-4 border-t border-black/[0.06] bg-panel-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-neutral-600">Final</span>
                <MoneyValue paise={tx.amountPaise} size="lg" />
              </div>
            </DataTable>
            </>
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
            <div className="rounded-[18px] bg-panel border border-hairline shadow-card overflow-hidden">
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">Payment</div>
              </div>
              {tx.payment.status === "FAILED" && failureReason && (
                <div className="mx-6 mt-4 rounded-[12px] bg-red-50 text-red-700 px-4 py-3 text-[13px] leading-relaxed">
                  Payment failed: {failureReason}
                </div>
              )}
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
                  ...(tx.payment.paymentId
                    ? [
                        {
                          label: "Payment id",
                          value: (
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[12px] text-ink-2 break-all">{tx.payment.paymentId}</span>
                              <CopyButton value={tx.payment.paymentId} label="payment_id" />
                            </span>
                          ),
                        },
                      ]
                    : []),
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
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ink text-white text-[13px] font-medium hover:bg-ink-2 transition-colors"
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
            <div className="rounded-[18px] bg-panel border border-hairline shadow-card overflow-hidden">
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

      {/* Irreversible: refund only proceeds after typing REFUND in the dialog. */}
      <ConfirmDialog
        open={refundDialogOpen}
        title={`Refund ${formatPaise(refundDisplayPaise)}?`}
        description={
          <div className="space-y-4">
            <div>
              Refund {formatPaise(refundDisplayPaise)} for order{" "}
              <span className="font-mono text-[12px] text-ink-2">{tx.id}</span> (buyer{" "}
              <span className="font-mono text-[12px] text-ink-2">{tx.buyer.id}</span>) cannot be
              undone.
            </div>
            <label className="block">
              <span className="text-[12px] text-faint">AMOUNT (₹)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={refundAmountRupees}
                onChange={(e) => setRefundAmountRupees(e.target.value)}
                className="mt-1.5 w-full h-9 rounded-[12px] bg-panel border border-hairline px-3 text-[14px] text-ink tabular-nums focus:outline-none focus:border-accent"
              />
              <span className="mt-1.5 block text-[12px] text-faint">
                Leave at {formatPaise(tx.amountPaise)} for a full refund.
              </span>
              {!isRefundAmountValid && (
                <span className="mt-1 block text-[12px] text-red-600">
                  Enter an amount greater than ₹0 and up to {formatPaise(tx.amountPaise)}.
                </span>
              )}
            </label>
          </div>
        }
        confirmLabel="Refund"
        tone="danger"
        typeToConfirm="REFUND"
        busy={refunding}
        confirmDisabled={!isRefundAmountValid}
        onConfirm={() => void handleRefund()}
        onCancel={() => setRefundDialogOpen(false)}
      />
    </div>
  );
}
