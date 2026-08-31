"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatPaise } from "@/lib/formatters";
import { getConsoleInsights, type ConsoleGrowthMetrics } from "@/lib/api";

export default function GrowthPage() {
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConsoleInsights();
      setGrowth(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-child">
        <MetricCard label="Revenue" value={growth ? Math.round(growth.revenue / 100) : 0} prefix="₹" />
        <MetricCard label="Agent-Assisted Revenue" value={growth ? Math.round(growth.agent_assisted_revenue / 100) : 0} prefix="₹" highlight />
        <MetricCard label="Upsell Revenue" value={growth ? Math.round(growth.upsell_revenue / 100) : 0} prefix="₹" />
        <MetricCard label="Avg Order Value" value={growth ? Math.round(growth.avg_order_value / 100) : 0} prefix="₹" />
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
    </div>
  );
}
