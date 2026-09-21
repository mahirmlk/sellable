"use client";

// Orders (URL /dashboard/transactions, visible title "Orders"): toolbar
// search/filter/sort, status tabs mapped from existing backend statuses,
// rows with order + product summary + buyer + amount + channel + status +
// time-ago. Saved views and CSV export operate over the loaded records.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatTimeAgo } from "@/lib/formatters";
import { getConsoleApprovals, getConsoleTransactions } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  ChannelBadge,
  FilterTabs,
  RefreshButton,
  SavedViewsBar,
} from "@/components/dashboard/commerce-ui";
import { exportToCsv } from "@/lib/csv";
import {
  itemsSummary,
  mapConsoleTx,
  orderTabOf,
  type OrderTab,
} from "@/lib/commerce-view";
import type { Transaction } from "@/lib/types/domain";

type ChannelFilter = "all" | "agent_to_agent" | "human_chat";
type SortKey = "newest" | "oldest" | "amount-desc" | "amount-asc";

interface OrderView {
  tab: OrderTab;
  channel: ChannelFilter;
  sort: SortKey;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rawItems, setRawItems] = useState<Record<string, Array<{ sku: string; quantity: number }>>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<OrderTab>("all");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [txData, apprData] = await Promise.all([
        getConsoleTransactions(),
        getConsoleApprovals().catch(() => []),
      ]);
      setTransactions(txData.map(mapConsoleTx));
      const items: Record<string, Array<{ sku: string; quantity: number }>> = {};
      for (const t of txData) {
        if (t.items) items[t.order_id] = t.items.map((i) => ({ sku: i.sku, quantity: i.quantity }));
      }
      setRawItems(items);
      setPendingIds(
        new Set(apprData.filter((a) => a.status === "PENDING").map((a) => a.order_id))
      );
    } catch (err) {
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — orders could not be loaded."
          : "Orders could not be loaded from the backend."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const counts = useMemo(() => {
    const c: Record<OrderTab, number> = {
      all: transactions.length,
      open: 0,
      approval: 0,
      payment: 0,
      paid: 0,
      failed: 0,
      refunded: 0,
    };
    for (const tx of transactions) c[orderTabOf(tx, pendingIds)] += 1;
    return c;
  }, [transactions, pendingIds]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = transactions.filter((tx) => {
      if (tab !== "all" && orderTabOf(tx, pendingIds) !== tab) return false;
      if (channel !== "all" && tx.channel !== channel) return false;
      if (q) {
        const hay = `${tx.id} ${tx.buyer.id} ${(rawItems[tx.id] ?? []).map((i) => i.sku).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    switch (sort) {
      case "newest":
        return [...rows].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      case "oldest":
        return [...rows].sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt));
      case "amount-desc":
        return [...rows].sort((a, b) => b.amountPaise - a.amountPaise);
      case "amount-asc":
        return [...rows].sort((a, b) => a.amountPaise - b.amountPaise);
    }
  }, [transactions, tab, channel, sort, query, pendingIds, rawItems]);

  const handleExport = useCallback(() => {
    exportToCsv(
      "orders.csv",
      visible.map((tx) => ({
        order_id: tx.id,
        buyer_id: tx.buyer.id,
        buyer_type: tx.buyer.type === "human" ? "Human" : "AI Buyer",
        channel: tx.channel,
        amount_inr: (tx.amountPaise / 100).toFixed(2),
        status: tx.status,
        items: itemsSummary(tx.items, rawItems[tx.id]),
        created_at: tx.updatedAt,
      }))
    );
  }, [visible, rawItems]);

  const applyView = useCallback((v: OrderView) => {
    setTab(v.tab);
    setChannel(v.channel);
    setSort(v.sort);
  }, []);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Orders"
        subtitle="Every order through your store"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98]"
            >
              <Download size={14} /> Export
            </button>
            <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
          </>
        }
      />

      <FilterTabs<OrderTab>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "open", label: "Open", count: counts.open },
          { key: "approval", label: "Awaiting approval", count: counts.approval },
          { key: "payment", label: "Payment pending", count: counts.payment },
          { key: "paid", label: "Paid", count: counts.paid },
          { key: "failed", label: "Failed", count: counts.failed },
          { key: "refunded", label: "Refunded", count: counts.refunded },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Toolbar: search / channel filter / sort */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order, buyer, or SKU…"
          aria-label="Search orders"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
        />
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as ChannelFilter)}
          className="h-9 rounded-[10px] bg-white border border-black/[0.12] text-[13px] text-neutral-700 px-2.5 cursor-pointer focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
          aria-label="Filter by buyer type"
        >
          <option value="all">All buyers</option>
          <option value="agent_to_agent">AI buyer</option>
          <option value="human_chat">Human</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-[10px] bg-white border border-black/[0.12] text-[13px] text-neutral-700 px-2.5 cursor-pointer focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
          aria-label="Sort orders"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="amount-desc">Amount: high to low</option>
          <option value="amount-asc">Amount: low to high</option>
        </select>
        <span className="text-[12px] text-neutral-400 ml-auto tabular-nums">
          {visible.length} of {transactions.length} orders
        </span>
      </div>

      <SavedViewsBar<OrderView>
        storageKey="orders"
        current={{ tab, channel, sort }}
        onApply={applyView}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={transactions.length === 0 ? "No orders yet" : "No orders match"}
          message={
            transactions.length === 0
              ? "No orders yet. Orders created through your store will appear here."
              : "No orders match the current search and filters."
          }
        />
      ) : (
        <DataTable>
          <div className="hidden lg:grid grid-cols-[150px_1fr_120px_90px_100px_130px_70px] gap-3 px-6 py-3 border-b border-black/[0.06] bg-neutral-50/80">
            {["Order", "Items", "Buyer", "Amount", "Channel", "Status", "Placed"].map((h) => (
              <div key={h} className="text-[12px] font-medium text-neutral-500">{h}</div>
            ))}
          </div>
          {visible.map((tx, i) => (
            <Link
              key={tx.id}
              href={`/dashboard/transactions/${tx.id}`}
              className={`hidden lg:grid grid-cols-[150px_1fr_120px_90px_100px_130px_70px] gap-3 px-6 py-4 items-center hover:bg-black/[0.02] transition-colors focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                i < visible.length - 1 ? "border-b border-black/[0.05]" : ""
              }`}
            >
              <div className="text-[13px] text-neutral-600 truncate">
                #{tx.id}
              </div>
              <div className="text-[13px] text-neutral-500 truncate">
                {itemsSummary(tx.items, rawItems[tx.id])}
              </div>
              <div className="text-[13px] text-neutral-600 truncate" title={tx.buyer.id}>
                {tx.buyer.id}
              </div>
              <MoneyValue paise={tx.amountPaise} />
              <ChannelBadge channel={tx.channel} />
              <StatusBadge status={tx.status} />
              <div className="text-[12px] text-neutral-400">
                {formatTimeAgo(tx.updatedAt)}
              </div>
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-black/[0.05]">
            {visible.map((tx) => (
              <Link key={tx.id} href={`/dashboard/transactions/${tx.id}`} className="block px-5 py-4 space-y-2 hover:bg-black/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-neutral-900 truncate">#{tx.id}</div>
                    <div className="text-[12px] text-neutral-400 mt-0.5 truncate">
                      {itemsSummary(tx.items, rawItems[tx.id])}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <MoneyValue paise={tx.amountPaise} />
                    <div className="mt-1"><StatusBadge status={tx.status} /></div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-neutral-400 truncate">
                    {tx.buyer.id} · {formatTimeAgo(tx.updatedAt)}
                  </span>
                  <ChannelBadge channel={tx.channel} />
                </div>
              </Link>
            ))}
          </div>
        </DataTable>
      )}
    </div>
  );
}
