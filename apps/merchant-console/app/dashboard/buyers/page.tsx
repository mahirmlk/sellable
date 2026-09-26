"use client";

// Buyers (route /dashboard/buyers): derived SOLELY by aggregating
// getConsoleTransactions buyer info (buyer_agent_id + channel). No addresses,
// phones, emails, segments, or notes exist in the data — none are shown.
// Column headers sort client-side (aria-sort on the th); the footer paginates
// 25 rows with totals.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatTimeAgo } from "@/lib/formatters";
import { getConsoleTransactions, type ConsoleTransaction } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import {
  ChannelBadge,
  FilterTabs,
  RefreshButton,
  SavedViewsBar,
} from "@/components/dashboard/commerce-ui";
import { exportToCsv } from "@/lib/csv";
import { toast } from "@/components/dashboard/toasts";
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

type BuyerFilter = "all" | "human" | "agent";type BuyerSort =
  | "default"
  | "id-asc"
  | "id-desc"
  | "type-asc"
  | "type-desc"
  | "orders-asc"
  | "orders-desc"
  | "total-asc"
  | "total-desc"
  | "last-asc"
  | "last-desc";

interface BuyerRow {
  id: string;
  type: "human" | "agent";
  channel: "human_chat" | "agent_to_agent";
  orderCount: number;
  totalPaise: number;
  lastOrderAt: string;
}

interface BuyerView {
  filter: BuyerFilter;
  sort: BuyerSort;
}

export default function BuyersPage() {
  const [transactions, setTransactions] = useState<ConsoleTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BuyerFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BuyerSort>("default");
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTransactions(await getConsoleTransactions());
    } catch (err) {
      setTransactions([]);
      setLoadError(
        err instanceof TypeError
          ? "Backend unreachable — buyers could not be loaded."
          : "Buyers could not be loaded from the backend."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const buyers = useMemo<BuyerRow[]>(() => {
    const map = new Map<string, BuyerRow>();
    for (const t of transactions) {
      const channel = t.channel === "human_chat" ? "human_chat" : "agent_to_agent";
      const existing = map.get(t.buyer_agent_id);
      if (existing) {
        existing.orderCount += 1;
        existing.totalPaise += t.amount_paise;
        // Most recent channel wins when a buyer used both.
        if (+new Date(t.created_at) > +new Date(existing.lastOrderAt)) {
          existing.lastOrderAt = t.created_at;
          existing.channel = channel;
          existing.type = channel === "human_chat" ? "human" : "agent";
        }
      } else {
        map.set(t.buyer_agent_id, {
          id: t.buyer_agent_id,
          type: channel === "human_chat" ? "human" : "agent",
          channel,
          orderCount: 1,
          totalPaise: t.amount_paise,
          lastOrderAt: t.created_at,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [transactions]);

  const counts = useMemo(
    () => ({
      all: buyers.length,
      human: buyers.filter((b) => b.type === "human").length,
      agent: buyers.filter((b) => b.type === "agent").length,
    }),
    [buyers]
  );

  // Sortable columns. Total value sorts on *_paise, Orders on the count, Last
  // order on the timestamp, text columns locale-aware — all client-side over
  // the loaded rows.
  const sortColumns = useMemo<Array<SortColumn<BuyerRow, BuyerSort>>>(
    () => [
      { id: "buyer", label: "Buyer", asc: "id-asc", desc: "id-desc", first: "asc", value: (b) => b.id },
      { id: "type", label: "Type", asc: "type-asc", desc: "type-desc", first: "asc", width: "w-[110px]", value: (b) => b.type },
      { id: "orders", label: "Orders", asc: "orders-asc", desc: "orders-desc", first: "desc", width: "w-[90px]", value: (b) => b.orderCount },
      { id: "total", label: "Total value", asc: "total-asc", desc: "total-desc", first: "desc", width: "w-[110px]", value: (b) => b.totalPaise },
      { id: "last", label: "Last order", asc: "last-asc", desc: "last-desc", first: "desc", width: "w-[90px]", value: (b) => +new Date(b.lastOrderAt) },
    ],
    []
  );

  // The historical default (total value descending) is the "Total value" column
  // sorted descending — clicking it toggles straight to ascending.
  const eff: BuyerSort = sort === "default" ? "total-desc" : sort;
  const activeCol = sortColumns.find((c) => dirOf(c, eff) !== null);
  const activeDir: SortDir | null = activeCol ? dirOf(activeCol, eff) : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = buyers.filter((b) => {
      if (filter !== "all" && b.type !== filter) return false;
      if (q && !b.id.toLowerCase().includes(q)) return false;
      return true;
    });
    return activeCol && activeDir ? sortBy(rows, activeCol.value, activeDir) : rows;
  }, [buyers, filter, query, activeCol, activeDir]);

  // Header click: idle column → its first direction; active column → toggle asc/desc.
  const handleSort = useCallback(
    (c: SortColumn<BuyerRow, BuyerSort>) => {
      const dir = dirOf(c, eff);
      setSort(dir === null ? (c.first === "asc" ? c.asc : c.desc) : dir === "asc" ? c.desc : c.asc);
      setPage(1);
    },
    [eff]
  );

  const handleExport = useCallback(() => {
    const rows = visible.map((b) => ({
      buyer_id: b.id,
      buyer_type: b.type === "human" ? "Human" : "AI Buyer",
      orders: b.orderCount,
      total_value_inr: (b.totalPaise / 100).toFixed(2),
      last_order_at: b.lastOrderAt,
    }));
    exportToCsv("buyers.csv", rows);
    toast({ tone: "success", title: "Exported buyers.csv", description: `${rows.length} rows` });
  }, [visible]);

  const applyView = useCallback((v: BuyerView) => {
    setFilter(v.filter);
    setSort(v.sort);
    setPage(1);
  }, []);

  const pageCount = pageCountOf(visible.length);
  const current = Math.min(page, pageCount);
  const pageRows = pageSlice(visible, current);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Buyers"
        subtitle="Everyone who ordered from your store"
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

      <FilterTabs<BuyerFilter>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "human", label: "Human", count: counts.human },
          { key: "agent", label: "AI buyer", count: counts.agent },
        ]}
        active={filter}
        onChange={(f) => {
          setFilter(f);
          setPage(1);
        }}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search buyer ID…"
          aria-label="Search buyers"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-hairline focus:ring-[3px] focus:ring-ink/20 transition-shadow"
        />
        <span className="text-[12px] text-neutral-400 ml-auto tabular-nums">
          {visible.length} of {buyers.length} buyers
        </span>
      </div>

      <SavedViewsBar<BuyerView>
        storageKey="buyers"
        current={{ filter, sort }}
        onApply={applyView}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={buyers.length === 0 ? "No buyers yet" : "No buyers match"}
          message={
            buyers.length === 0
              ? "No buyers yet. Buyers who order through your store will appear here."
              : "No buyers match the current search and filters."
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
                      const dir = dirOf(c, eff);
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
                  {pageRows.map((b) => (
                    <tr key={b.id} className="relative">
                      <td>
                        <Link
                          href={`/dashboard/buyers/${encodeURIComponent(b.id)}`}
                          className="block truncate text-[13px] text-neutral-600 after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-accent"
                          title={b.id}
                        >
                          {b.id}
                        </Link>
                      </td>
                      <td>
                        <ChannelBadge channel={b.channel} />
                      </td>
                      <td>
                        <div className="text-[14px] text-neutral-900 tabular-nums">{b.orderCount}</div>
                      </td>
                      <td>
                        <MoneyValue paise={b.totalPaise} />
                      </td>
                      <td>
                        <div className="text-[12px] text-neutral-400">{formatTimeAgo(b.lastOrderAt)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-black/[0.05]">
              {pageRows.map((b) => (
                <Link
                  key={b.id}
                  href={`/dashboard/buyers/${encodeURIComponent(b.id)}`}
                  className="block px-5 py-4 space-y-2 hover:bg-black/[0.02]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[14px] font-medium text-neutral-900 truncate">{b.id}</div>
                    <MoneyValue paise={b.totalPaise} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-neutral-400">
                      {b.orderCount} order{b.orderCount > 1 ? "s" : ""} · {formatTimeAgo(b.lastOrderAt)}
                    </span>
                    <ChannelBadge channel={b.channel} />
                  </div>
                </Link>
              ))}
            </div>
          </DataTable>
          <TablePagination
            page={current}
            total={visible.length}
            noun="buyers"
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
