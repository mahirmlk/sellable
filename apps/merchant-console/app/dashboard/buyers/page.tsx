"use client";

// Buyers (route /dashboard/buyers): derived SOLELY by aggregating
// getConsoleTransactions buyer info (buyer_agent_id + channel). No addresses,
// phones, emails, segments, or notes exist in the data — none are shown.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatTimeAgo } from "@/lib/formatters";
import { getConsoleTransactions, type ConsoleTransaction } from "@/lib/api";
import {
  ChannelBadge,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterTabs,
  PageHeader,
  RefreshButton,
} from "../_components/tier1-ui";

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
    <div className="p-6 space-y-6">
      <PageHeader
        title="Buyers"
        subtitle="EVERY BUYER WHO ORDERED FROM YOUR STORE"
        actions={<RefreshButton onRefresh={() => void fetchData()} loading={loading} />}
      />

      <FilterTabs<BuyerFilter>
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "human", label: "Human", count: counts.human },
          { key: "agent", label: "AI Buyer", count: counts.agent },
        ]}
        active={filter}
        onChange={setFilter}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search buyer id…"
          className="flex-1 min-w-[180px] max-w-[300px] font-[var(--font-mono)] text-[0.7rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-2 placeholder:text-[var(--bb-grey-4)] focus:outline-none focus:border-[var(--bb-orange)] transition-colors"
        />
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] ml-auto">
          {visible.length} of {buyers.length} buyers
        </span>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      {loading ? (
        <DataTable>
          <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            <div className="skeleton h-3 w-32" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-[var(--bb-line-soft)] last:border-b-0">
              <div className="flex items-center gap-4">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-3 w-12 ml-auto" />
              </div>
            </div>
          ))}
        </DataTable>
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
          <div className="hidden lg:grid grid-cols-[1fr_110px_90px_110px_90px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
            {["BUYER", "TYPE", "ORDERS", "TOTAL VALUE", "LAST ORDER"].map((h) => (
              <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
            ))}
          </div>
          {visible.map((b, i) => (
            <Link
              key={b.id}
              href={`/dashboard/buyers/${encodeURIComponent(b.id)}`}
              className={`hidden lg:grid grid-cols-[1fr_110px_90px_110px_90px] gap-3 px-5 py-3.5 items-center hover:bg-[var(--bb-panel)] transition-colors group ${
                i < visible.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <div className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-grey-1)] group-hover:text-[var(--bb-white)] transition-colors truncate" title={b.id}>
                {b.id}
              </div>
              <ChannelBadge channel={b.channel} />
              <div className="font-[var(--font-mono)] text-[0.72rem] text-[var(--bb-white)] tabular-nums">{b.orderCount}</div>
              <MoneyValue paise={b.totalPaise} />
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{formatTimeAgo(b.lastOrderAt)}</div>
            </Link>
          ))}
          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-[var(--bb-line-soft)]">
            {visible.map((b) => (
              <Link
                key={b.id}
                href={`/dashboard/buyers/${encodeURIComponent(b.id)}`}
                className="block px-5 py-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] truncate">{b.id}</div>
                  <MoneyValue paise={b.totalPaise} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
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
