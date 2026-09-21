"use client";

// Buyers (route /dashboard/buyers): derived SOLELY by aggregating
// getConsoleTransactions buyer info (buyer_agent_id + channel). No addresses,
// phones, emails, segments, or notes exist in the data — none are shown.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "@/components/dashboard/commerce-ui";

type BuyerFilter = "all" | "human" | "agent";

interface BuyerRow {
  id: string;
  type: "human" | "agent";
  channel: "human_chat" | "agent_to_agent";
  orderCount: number;
  totalPaise: number;
  lastOrderAt: string;
}

export default function BuyersPage() {
  const [transactions, setTransactions] = useState<ConsoleTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BuyerFilter>("all");
  const [query, setQuery] = useState("");

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return buyers.filter((b) => {
      if (filter !== "all" && b.type !== filter) return false;
      if (q && !b.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [buyers, filter, query]);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Buyers"
        subtitle="Everyone who ordered from your store"
        actions={<RefreshButton onRefresh={() => void fetchData()} loading={loading} />}
      />

      <FilterTabs<BuyerFilter>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "human", label: "Human", count: counts.human },
          { key: "agent", label: "AI buyer", count: counts.agent },
        ]}
        active={filter}
        onChange={setFilter}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search buyer ID…"
          aria-label="Search buyers"
          className="flex-1 min-w-[180px] max-w-[320px] h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow"
        />
        <span className="text-[12px] text-neutral-400 ml-auto tabular-nums">
          {visible.length} of {buyers.length} buyers
        </span>
      </div>

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
        <DataTable>
          <div className="hidden lg:grid grid-cols-[1fr_110px_90px_110px_90px] gap-3 px-6 py-3 border-b border-black/[0.06] bg-neutral-50/80">
            {["Buyer", "Type", "Orders", "Total value", "Last order"].map((h) => (
              <div key={h} className="text-[12px] font-medium text-neutral-500">{h}</div>
            ))}
          </div>
          {visible.map((b, i) => (
            <Link
              key={b.id}
              href={`/dashboard/buyers/${encodeURIComponent(b.id)}`}
              className={`hidden lg:grid grid-cols-[1fr_110px_90px_110px_90px] gap-3 px-6 py-4 items-center hover:bg-black/[0.02] transition-colors focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                i < visible.length - 1 ? "border-b border-black/[0.05]" : ""
              }`}
            >
              <div className="text-[13px] text-neutral-600 truncate" title={b.id}>
                {b.id}
              </div>
              <ChannelBadge channel={b.channel} />
              <div className="text-[14px] text-neutral-900 tabular-nums">{b.orderCount}</div>
              <MoneyValue paise={b.totalPaise} />
              <div className="text-[12px] text-neutral-400">{formatTimeAgo(b.lastOrderAt)}</div>
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-black/[0.05]">
            {visible.map((b) => (
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
      )}
    </div>
  );
}
