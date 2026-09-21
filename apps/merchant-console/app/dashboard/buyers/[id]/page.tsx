"use client";

// Buyer detail (route /dashboard/buyers/[id]): orders, total value, recent
// activity, and order history for one buyer — all aggregated from
// getConsoleTransactions (+ getConsoleEvents filtered to the buyer's order
// traces). No contact details, segments, or notes exist in the data.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatPaiseDecimal, formatTimeAgo, formatTimestamp } from "@/lib/formatters";
import {
  getConsoleEvents,
  getConsoleTransactions,
  type ConsoleTransaction,
  type LedgerEvent,
} from "@/lib/api";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  ChannelBadge,
  RefreshButton,
} from "@/components/dashboard/commerce-ui";
import { itemsSummary, mapConsoleTx } from "@/lib/commerce-view";
import type { Transaction } from "@/lib/types/domain";

export default function BuyerDetailPage() {
  const params = useParams();
  const buyerId = String(params.id ?? "");
  const [transactions, setTransactions] = useState<ConsoleTransaction[]>([]);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [txData, eventData] = await Promise.all([
        getConsoleTransactions(),
        getConsoleEvents(200).catch(() => null),
      ]);
      setTransactions(txData);
      setEvents(eventData?.events ?? []);
    } catch (err) {
      setTransactions([]);
      setEvents([]);
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — this buyer could not be loaded."
          : "This buyer could not be loaded from the backend."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const buyerOrders = useMemo(
    () => transactions.filter((t) => t.buyer_agent_id === buyerId),
    [transactions, buyerId]
  );

  const mapped: Transaction[] = useMemo(
    () =>
      buyerOrders.map(mapConsoleTx).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [buyerOrders]
  );

  const totalPaise = useMemo(
    () => buyerOrders.reduce((sum, t) => sum + t.amount_paise, 0),
    [buyerOrders]
  );

  const channel: "human_chat" | "agent_to_agent" = useMemo(() => {
    const latest = [...buyerOrders].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
    )[0];
    return latest?.channel === "human_chat" ? "human_chat" : "agent_to_agent";
  }, [buyerOrders]);

  // Recent activity: ledger events on this buyer's order traces.
  const activity = useMemo(() => {
    const traces = new Set(buyerOrders.map((t) => t.trace_id));
    return events
      .filter((e) => traces.has(e.trace_id))
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
      .slice(0, 10);
  }, [events, buyerOrders]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">Loading buyer…</div>
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/buyers"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO BUYERS
        </Link>
        <ErrorBanner message={loadError} onRetry={() => void fetchData()} />
      </div>
    );
  }

  if (buyerOrders.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/buyers"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO BUYERS
        </Link>
        <EmptyState
          title="Buyer not found"
          message="No orders exist for this buyer in your store."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/buyers"
          className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
        >
          <ArrowLeft size={14} /> BACK TO BUYERS
        </Link>
        <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
      </div>

      {/* Buyer header: id, type, orders, total value */}
      <div className="border border-[var(--bb-line)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)] break-all">
              {buyerId}
            </h1>
            <div className="mt-2">
              <ChannelBadge channel={channel} />
            </div>
          </div>
          <div className="flex items-center gap-8 shrink-0">
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-1.5">
                ORDERS
              </div>
              <div className="font-[var(--font-mono)] text-[1.35rem] text-[var(--bb-white)] tabular-nums">
                {buyerOrders.length}
              </div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-1.5">
                TOTAL VALUE
              </div>
              <div className="font-[var(--font-mono)] text-[1.35rem] text-[var(--bb-orange)] tabular-nums">
                {formatPaiseDecimal(totalPaise)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Order history */}
        <div>
          <div className="flex items-baseline gap-2.5 mb-3">
            <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-orange)] tabular-nums">01</span>
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">
              ORDER HISTORY
            </span>
          </div>
          <DataTable>
            {mapped.map((tx, i) => {
              const raw = buyerOrders.find((t) => t.order_id === tx.id);
              return (
                <Link
                  key={tx.id}
                  href={`/dashboard/transactions/${tx.id}`}
                  className={`px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[var(--bb-panel)] transition-colors group ${
                    i < mapped.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-1)] group-hover:text-[var(--bb-white)] transition-colors truncate">
                      #{tx.id}
                    </div>
                    <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mt-0.5 truncate">
                      {itemsSummary(
                        tx.items,
                        raw?.items?.map((it) => ({ sku: it.sku, quantity: it.quantity }))
                      )}{" "}
                      · {formatTimeAgo(tx.updatedAt)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <MoneyValue paise={tx.amountPaise} />
                    <div className="mt-1">
                      <StatusBadge status={tx.status} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </DataTable>
        </div>

        {/* Recent activity for this buyer */}
        <div>
          <div className="flex items-baseline gap-2.5 mb-3">
            <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-orange)] tabular-nums">02</span>
            <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.16em] uppercase text-[var(--bb-grey-3)]">
              RECENT ACTIVITY
            </span>
          </div>
          {activity.length === 0 ? (
            <div className="border border-[var(--bb-line)] px-5 py-8 text-center font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-4)]">
              No ledger activity recorded for this buyer&apos;s orders yet.
            </div>
          ) : (
            <DataTable>
              {activity.map((e, i) => (
                <div
                  key={e.event_id}
                  className={`px-5 py-[11px] flex items-center gap-3 ${
                    i < activity.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
                  }`}
                >
                  <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] w-[58px] flex-shrink-0 tabular-nums">
                    {formatTimestamp(e.timestamp)}
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">
                    {e.actor} — {e.action}
                  </span>
                </div>
              ))}
            </DataTable>
          )}
        </div>
      </div>
    </div>
  );
}
