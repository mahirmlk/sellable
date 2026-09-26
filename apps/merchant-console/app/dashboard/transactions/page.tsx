"use client";

// Orders (URL /dashboard/transactions, visible title "Orders"): toolbar
// search/filter, status tabs mapped from existing backend statuses, rows with
// order + product summary + buyer + amount + channel + status + time-ago.
// Column headers sort client-side (aria-sort on the th); the footer paginates
// 25 rows with honest totals. Saved views and CSV export operate over the
// loaded records.

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
import { toast } from "@/components/dashboard/toasts";
import {
  itemsSummary,
  mapConsoleTx,
  orderTabOf,
  type OrderTab,
} from "@/lib/commerce-view";
import {
  dirOf,
  pageCountOf,
  pageSlice,
  sortBy,
  SortableTh,
  TablePagination,
  type SortColumn,
  type SortDir,
} from "@/components/dashboard/table-affordances";
import type { Transaction } from "@/lib/types/domain";

type ChannelFilter = "all" | "agent_to_agent" | "human_chat";
// Sort states are shared with saved views — legacy values ("newest", "oldest",
// "amount-desc", "amount-asc") keep their meaning and stay valid.
type SortKey =
  | "newest"
  | "oldest"
  | "amount-desc"
  | "amount-asc"
  | "order-asc"
  | "order-desc"
  | "items-asc"
  | "items-desc"
  | "buyer-asc"
  | "buyer-desc"
  | "channel-asc"
  | "channel-desc"
  | "status-asc"
  | "status-desc";

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
  const [page, setPage] = useState(1);

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

  // Sortable columns. Amount sorts on *_paise, Placed on the timestamp, text
  // columns locale-aware — all client-side over the loaded rows.
  const sortColumns = useMemo<Array<SortColumn<Transaction, SortKey>>>(
    () => [
      { id: "order", label: "Order", asc: "order-asc", desc: "order-desc", first: "asc", width: "w-[150px]", value: (tx) => tx.id },
      { id: "items", label: "Items", asc: "items-asc", desc: "items-desc", first: "asc", value: (tx) => itemsSummary(tx.items, rawItems[tx.id]) },
      { id: "buyer", label: "Buyer", asc: "buyer-asc", desc: "buyer-desc", first: "asc", width: "w-[120px]", value: (tx) => tx.buyer.id },
      { id: "amount", label: "Amount", asc: "amount-asc", desc: "amount-desc", first: "desc", width: "w-[90px]", value: (tx) => tx.amountPaise },
      { id: "channel", label: "Channel", asc: "channel-asc", desc: "channel-desc", first: "asc", width: "w-[100px]", value: (tx) => tx.channel },
      { id: "status", label: "Status", asc: "status-asc", desc: "status-desc", first: "asc", width: "w-[130px]", value: (tx) => tx.status },
      { id: "placed", label: "Placed", asc: "oldest", desc: "newest", first: "desc", width: "w-[70px]", value: (tx) => +new Date(tx.updatedAt) },
    ],
    [rawItems]
  );

  const activeCol = sortColumns.find((c) => dirOf(c, sort) !== null);
  const activeDir: SortDir | null = activeCol ? dirOf(activeCol, sort) : null;

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
    return activeCol && activeDir ? sortBy(rows, activeCol.value, activeDir) : rows;
  }, [transactions, tab, channel, query, pendingIds, rawItems, activeCol, activeDir]);

  const handleExport = useCallback(() => {
    const rows = visible.map((tx) => ({
      order_id: tx.id,
      buyer_id: tx.buyer.id,
      buyer_type: tx.buyer.type === "human" ? "Human" : "AI Buyer",
      channel: tx.channel,
      amount_inr: (tx.amountPaise / 100).toFixed(2),
      status: tx.status,
      items: itemsSummary(tx.items, rawItems[tx.id]),
      created_at: tx.updatedAt,
    }));
    exportToCsv("orders.csv", rows);
    toast({ tone: "success", title: "Exported orders.csv", description: `${rows.length} rows` });
  }, [visible, rawItems]);

  const applyView = useCallback((v: OrderView) => {
    setTab(v.tab);
    setChannel(v.channel);
    setSort(v.sort);
    setPage(1);
  }, []);

  // Header click: idle column → its first direction; active column → toggle asc/desc.
  const handleSort = useCallback(
    (c: SortColumn<Transaction, SortKey>) => {
      const dir = dirOf(c, sort);
      setSort(dir === null ? (c.first === "asc" ? c.asc : c.desc) : dir === "asc" ? c.desc : c.asc);
      setPage(1);
    },
    [sort]
  );

  const pageCount = pageCountOf(visible.length);
  const current = Math.min(page, pageCount);
  const pageRows = pageSlice(visible, current);

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
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-700 hover:text-neutral-900 hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98]"
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
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
      />

      {/* Toolbar: search / channel filter. Sorting lives in the column headers. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search order, buyer, or SKU…"
          aria-label="Search orders"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow"
        />
        <select
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as ChannelFilter);
            setPage(1);
          }}
          className="h-9 rounded-[10px] bg-white border border-black/[0.12] text-[13px] text-neutral-700 px-2.5 cursor-pointer focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow"
          aria-label="Filter by buyer type"
        >
          <option value="all">All buyers</option>
          <option value="agent_to_agent">AI buyer</option>
          <option value="human_chat">Human</option>
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
        <div className="space-y-3">
          <DataTable>
            <div className="hidden lg:block">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    {sortColumns.map((c) => {
                      const dir = dirOf(c, sort);
                      return (
                        <SortableTh
                          key={c.id}
                          label={c.label}
                          active={dir !== null}
                          dir={dir ?? c.first}
                          className={c.width}
                          onSort={() => handleSort(c)}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((tx) => (
                    <tr key={tx.id} className="relative">
                      <td>
                        <Link
                          href={`/dashboard/transactions/${tx.id}`}
                          className="block truncate text-[13px] text-neutral-600 after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          #{tx.id}
                        </Link>
                      </td>
                      <td>
                        <div className="truncate text-[13px] text-neutral-500">
                          {itemsSummary(tx.items, rawItems[tx.id])}
                        </div>
                      </td>
                      <td>
                        <div className="truncate text-[13px] text-neutral-600" title={tx.buyer.id}>
                          {tx.buyer.id}
                        </div>
                      </td>
                      <td>
                        <MoneyValue paise={tx.amountPaise} />
                      </td>
                      <td>
                        <ChannelBadge channel={tx.channel} />
                      </td>
                      <td>
                        <StatusBadge status={tx.status} />
                      </td>
                      <td>
                        <div className="text-[12px] text-neutral-400">
                          {formatTimeAgo(tx.updatedAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-black/[0.05]">
              {pageRows.map((tx) => (
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
          <TablePagination
            page={current}
            total={visible.length}
            noun="orders"
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
