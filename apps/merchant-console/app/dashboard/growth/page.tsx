"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, TrendingDown } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatPaise } from "@/lib/formatters";
import { getConsoleInsights, getConsoleTransactions, getConsoleTransactionDetail, getConsoleCatalogItem, type ConsoleGrowthMetrics, type ConsoleTransaction, type Product } from "@/lib/api";

interface SavedDealRow {
  sku: string;
  requests: number;
  converted: number;
  walkedAway: number;
  floorPaise: number | null;
  pricePaise: number | null;
}

async function computeSavedDeals(txs: ConsoleTransaction[]): Promise<SavedDealRow[]> {
  const details = await Promise.all(txs.slice(0, 20).map((tx) => getConsoleTransactionDetail(tx.order_id).catch(() => null)));
  const bySku = new Map<string, SavedDealRow>();
  for (const d of details) {
    if (!d) continue;
    // Converted = money actually captured and kept. Unpaid quotes must never
    // inflate this, and refunded orders sit in neither bucket (they paid,
    // then the money went back) rather than posing as conversions or walks.
    const converted = d.status === "PAID" || d.status === "FULFILLED";
    const refunded = d.status === "REFUNDED";
    for (const e of d.events || []) {
      // Substring match, same as the backend insights counter: any
      // negotiation.* variant counts, not just one literal action.
      if (e.action.includes("negotiat")) {
        const sku = (e.inputs as Record<string, unknown>)?.sku as string | undefined;
        if (!sku) continue;
        const row = bySku.get(sku) || { sku, requests: 0, converted: 0, walkedAway: 0, floorPaise: null, pricePaise: null };
        row.requests += 1;
        bySku.set(sku, row);
      }
    }
    for (const item of d.items || []) {
      const row = bySku.get(item.sku) || { sku: item.sku, requests: 0, converted: 0, walkedAway: 0, floorPaise: null, pricePaise: null };
      if (converted) row.converted += 1;
      else if (!refunded) row.walkedAway += 1;
      bySku.set(item.sku, row);
    }
  }
  const rows = [...bySku.values()].filter((r) => r.requests > 0 || r.converted > 0);
  rows.sort((a, b) => b.requests + b.walkedAway - (a.requests + a.walkedAway));
  const top = rows.slice(0, 3);
  await Promise.all(
    top.map(async (row) => {
      try {
        const product: Product = await getConsoleCatalogItem(row.sku);
        row.floorPaise = product.floor_paise;
        row.pricePaise = product.price_paise;
      } catch {
        // leave floor/price null
      }
    })
  );
  return top;
}

export default function GrowthPage() {
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedDeals, setSavedDeals] = useState<SavedDealRow[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestGen = useRef(0);

  const fetchData = useCallback(async () => {
    const gen = ++requestGen.current;
    const alive = () => requestGen.current === gen;
    setLoading(true);
    setInsightsLoading(true);
    setLoadError(null);
    try {
      const [growthData, txData] = await Promise.allSettled([getConsoleInsights(), getConsoleTransactions()]);
      if (!alive()) return;
      if (growthData.status === "fulfilled") setGrowth(growthData.value);
      if (txData.status === "fulfilled") {
        computeSavedDeals(txData.value)
          .then((rows) => { if (alive()) setSavedDeals(rows); })
          .catch(() => { if (alive()) setSavedDeals([]); })
          .finally(() => { if (alive()) setInsightsLoading(false); });
      } else {
        setInsightsLoading(false);
      }
      if (growthData.status === "rejected" && txData.status === "rejected") {
        setLoadError("Growth data could not be loaded from the backend.");
      } else if (growthData.status === "rejected" || txData.status === "rejected") {
        setLoadError("Part of the growth data failed to load — figures below may be incomplete.");
      }
    } catch {
      if (alive()) setLoadError("Growth data could not be loaded from the backend.");
    } finally {
      if (alive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => { requestGen.current += 1; };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const attachRate = growth && growth.upsell_offers > 0
    ? ((growth.upsell_accepted / growth.upsell_offers) * 100).toFixed(1)
    : "0";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Growth</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">AGENTIC COMMERCE REVENUE ANALYTICS</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      {loadError && (
        <div className="border border-red-400/30 bg-red-400/5 px-5 py-3 font-[var(--font-mono)] text-[0.62rem] text-red-400">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-child">
        <MetricCard label="Revenue" value={growth ? growth.revenue / 100 : 0} prefix="₹" decimals={2} />
        <MetricCard label="Agent-Assisted Revenue" value={growth ? growth.agent_assisted_revenue / 100 : 0} prefix="₹" highlight decimals={2} />
        <MetricCard label="Upsell Revenue" value={growth ? growth.upsell_revenue / 100 : 0} prefix="₹" decimals={2} />
        <MetricCard label="Avg Order Value" value={growth ? growth.avg_order_value / 100 : 0} prefix="₹" decimals={2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[var(--bb-line)] p-5">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">UPSELL ANALYTICS</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Offers</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{growth?.upsell_offers ?? 0}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Accepted</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{growth?.upsell_accepted ?? 0}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Attach rate</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-orange)]">{attachRate}%</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Upsell revenue</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{formatPaise(growth?.upsell_revenue ?? 0)}</div>
            </div>
          </div>
        </div>

        <div className="border border-[var(--bb-line)] p-5">
          <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)] mb-4">NEGOTIATION ANALYTICS</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Negotiations</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)]">{growth?.negotiations ?? 0}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Accepted</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-green-400">{growth?.negotiated_accepted ?? 0}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Countered</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-yellow-400">{growth?.countered ?? 0}</div>
            </div>
            <div>
              <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Walked away</div>
              <div className="font-[var(--font-sans)] text-[1.3rem] text-red-400">{growth?.walked_away ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-[var(--bb-line)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">SAVED DEAL & PRICING INSIGHT</div>
          <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">
            {insightsLoading ? "DERIVING FROM LEDGER…" : "TRACEABLE TO TRANSACTIONS · NEWEST 20"}
          </div>
        </div>
        {savedDeals.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <TrendingDown size={24} className="text-[var(--bb-grey-4)] mx-auto mb-3" />
            <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] mb-2">
              {insightsLoading ? "Analyzing transactions…" : "Not enough negotiation data yet."}
            </div>
            <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-4)]">
              Pricing insights appear as buyers negotiate at or below merchant floors.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--bb-line-soft)]">
            {savedDeals.map((row) => (
              <div key={row.sku} className="px-5 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <TrendingDown size={14} className="text-[var(--bb-orange)]" />
                  <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{row.sku}</span>
                  <span className="ml-auto font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">SAVED DEAL</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Below-floor offers</div>
                    <div className="font-[var(--font-mono)] text-[1rem] text-[var(--bb-white)]">{row.requests}</div>
                  </div>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Converted orders</div>
                    <div className="font-[var(--font-mono)] text-[1rem] text-green-400">{row.converted}</div>
                  </div>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Walked away</div>
                    <div className="font-[var(--font-mono)] text-[1rem] text-red-400">{row.walkedAway}</div>
                  </div>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">Merchant floor</div>
                    <div className="font-[var(--font-mono)] text-[1rem] text-[var(--bb-white)]">{row.floorPaise != null ? formatPaise(row.floorPaise) : "—"}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--bb-line-soft)] flex items-start gap-2">
                  <TrendingDown size={13} className="text-[var(--bb-orange)] mt-0.5 flex-shrink-0" />
                  <p className="font-[var(--font-sans)] text-[0.72rem] text-[var(--bb-grey-3)] leading-relaxed">
                    {row.requests > 0
                      ? `${row.requests} buyer offer${row.requests === 1 ? "" : "s"} fell at or below the merchant floor${row.floorPaise != null ? ` (${formatPaise(row.floorPaise)})` : ""}. ${row.walkedAway > 0 ? `${row.walkedAway} walked away without converting. ` : ""}Potential price sensitivity detected — offered as analytics only; merchant policy is not changed automatically.`
                      : "Negotiation activity detected on this SKU."}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
