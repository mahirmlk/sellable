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
    <div className="p-6 space-y-6">
      <PageHeader
        title="Orders"
        subtitle="EVERY ORDER THROUGH YOUR STORE"
        actions={
          <>
            <button
              onClick={handleExport}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50"
            >
              <Download size={12} /> EXPORT
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
          className="flex-1 min-w-[180px] max-w-[300px] font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
        />
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as ChannelFilter)}
          className="font-[var(--font-mono)] text-[0.62rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-grey-2)] px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
          aria-label="Filter by buyer type"
        >
          <option value="all">BUYER: ALL</option>
          <option value="agent_to_agent">BUYER: AI BUYER</option>
          <option value="human_chat">BUYER: HUMAN</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="font-[var(--font-mono)] text-[0.62rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-grey-2)] px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
          aria-label="Sort orders"
        >
          <option value="newest">SORT: NEWEST</option>
          <option value="oldest">SORT: OLDEST</option>
          <option value="amount-desc">SORT: AMOUNT HIGH–LOW</option>
          <option value="amount-asc">SORT: AMOUNT LOW–HIGH</option>
        </select>
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] ml-auto">
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
        <DataTable>
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="skeleton h-3 w-32" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-[var(--bb-line-soft)] last:border-b-0">
              <div className="flex items-center gap-4">
                <div className="skeleton h-3 w-24" />
                <div className="skeleton h-3 w-32" />
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-3 w-12 ml-auto" />
              </div>
            </div>
          ))}
        </DataTable>
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
          <div className="hidden lg:grid grid-cols-[150px_1fr_120px_90px_100px_130px_70px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            {["ORDER", "ITEMS", "BUYER", "AMOUNT", "CHANNEL", "STATUS", "PLACED"].map((h) => (
              <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
            ))}
          </div>
          {visible.map((tx, i) => (
            <Link
              key={tx.id}
              href={`/dashboard/transactions/${tx.id}`}
              className={`hidden lg:grid grid-cols-[150px_1fr_120px_90px_100px_130px_70px] gap-3 px-5 py-3.5 items-center hover:bg-[var(--bb-panel)] transition-colors group ${
                i < visible.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <div className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-1)] group-hover:text-[var(--bb-white)] transition-colors truncate">
                #{tx.id}
              </div>
              <div className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-3)] truncate">
                {itemsSummary(tx.items, rawItems[tx.id])}
              </div>
              <div className="font-[var(--font-mono)] text-[0.62rem] text-[var(--bb-grey-2)] truncate" title={tx.buyer.id}>
                {tx.buyer.id}
              </div>
              <MoneyValue paise={tx.amountPaise} />
              <ChannelBadge channel={tx.channel} />
              <StatusBadge status={tx.status} />
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
                {formatTimeAgo(tx.updatedAt)}
              </div>
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
            {visible.map((tx) => (
              <Link key={tx.id} href={`/dashboard/transactions/${tx.id}`} className="block px-5 py-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-[var(--font-mono)] text-[0.72rem] text-[var(--bb-white)] truncate">#{tx.id}</div>
                    <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] mt-0.5 truncate">
                      {itemsSummary(tx.items, rawItems[tx.id])}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <MoneyValue paise={tx.amountPaise} />
                    <div className="mt-1"><StatusBadge status={tx.status} /></div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)] truncate">
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
