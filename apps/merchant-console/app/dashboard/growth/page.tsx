"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatPaise } from "@/lib/formatters";
import { getConsoleInsights, type ConsoleGrowthMetrics } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  Section,
  Tabs,
} from "@/components/dashboard/tier-fallbacks";

type Tab = "overview" | "ai" | "negotiation" | "upsells";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">{label}</div>
      <div className="font-[var(--font-sans)] text-[1.3rem] text-[var(--bb-white)] tabular-nums">{value}</div>
    </div>
  );
}

export default function GrowthPage() {
  const [growth, setGrowth] = useState<ConsoleGrowthMetrics | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestGen = useRef(0);

  const fetchData = useCallback(async () => {
    const gen = ++requestGen.current;
    const alive = () => requestGen.current === gen;
    setLoading(true);
    setLoadError(null);
    try {
      setGrowth(await getConsoleInsights());
    } catch (err) {
      if (alive()) {
        setGrowth(null);
        setLoadError(
          err instanceof TypeError
            ? "Backend unreachable — analytics could not be loaded."
            : "Analytics could not be loaded from the backend."
        );
      }
    } finally {
      if (alive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      requestGen.current += 1;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const hasData = growth !== null && growth.total_orders > 0;
  const attachRate =
    growth && growth.upsell_offers > 0
      ? ((growth.upsell_accepted / growth.upsell_offers) * 100).toFixed(1)
      : "0";
  const aiShare =
    growth && growth.revenue > 0
      ? ((growth.agent_assisted_revenue / growth.revenue) * 100).toFixed(1)
      : "0";

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="AGENTIC COMMERCE REVENUE ANALYTICS · FROM SALES METRICS ONLY"
        actions={
          <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
        }
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { label: "Overview", value: "overview" },
          { label: "AI Sales", value: "ai" },
          { label: "Negotiation", value: "negotiation" },
          { label: "Upsells", value: "upsells" },
        ]}
      />

      {loading ? (
        <TableSkeleton rows={4} />
      ) : !hasData ? (
        <EmptyState
          title="Not enough transaction data yet."
          message="Analytics appear here once orders flow through your store — run a checkout in AI Sales or wait for AI buyers to purchase."
        />
      ) : (
        growth && (
          <>
            {tab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-child">
                  <MetricCard label="Revenue" value={growth.revenue / 100} prefix="₹" decimals={2} />
                  <MetricCard label="Orders" value={growth.total_orders} />
                  <MetricCard label="Avg Order Value" value={growth.avg_order_value / 100} prefix="₹" decimals={2} />
                  <MetricCard label="AI-Assisted Revenue" value={growth.agent_assisted_revenue / 100} prefix="₹" highlight decimals={2} />
                </div>
                <Section title="OVERVIEW" hint="REVENUE · ORDERS · AOV · AI-ASSISTED">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Stat label="Revenue" value={formatPaise(growth.revenue)} />
                    <Stat label="Orders" value={String(growth.total_orders)} />
                    <Stat label="Avg order value" value={formatPaise(growth.avg_order_value)} />
                    <Stat label="AI-assisted" value={formatPaise(growth.agent_assisted_revenue)} />
                  </div>
                </Section>
              </div>
            )}

            {tab === "ai" && (
              <Section title="AI SALES" hint="AGENT-ASSISTED SHARE OF REVENUE">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Stat label="AI-assisted revenue" value={formatPaise(growth.agent_assisted_revenue)} />
                  <Stat label="Total revenue" value={formatPaise(growth.revenue)} />
                  <Stat label="AI share" value={`${aiShare}%`} />
                </div>
                <p className="mt-4 font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-3)] leading-relaxed">
                  Revenue from orders where the AI seller assisted discovery, quoting, negotiation, or checkout.
                </p>
              </Section>
            )}

            {tab === "negotiation" && (
              <Section title="NEGOTIATION" hint="NEGOTIATIONS · ACCEPTED · COUNTERED · WALKED AWAY">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Negotiations" value={String(growth.negotiations)} />
                  <Stat label="Accepted" value={String(growth.negotiated_accepted)} />
                  <Stat label="Countered" value={String(growth.countered)} />
                  <Stat label="Walked away" value={String(growth.walked_away)} />
                </div>
              </Section>
            )}

            {tab === "upsells" && (
              <Section title="UPSELLS" hint="OFFERS · ACCEPTED · ATTACH RATE · UPSELL REVENUE">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Offers" value={String(growth.upsell_offers)} />
                  <Stat label="Accepted" value={String(growth.upsell_accepted)} />
                  <Stat label="Attach rate" value={`${attachRate}%`} />
                  <Stat label="Upsell revenue" value={formatPaise(growth.upsell_revenue)} />
                </div>
                <p className="mt-4 font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)]">
                  Attach rate = accepted ÷ offers
                </p>
              </Section>
            )}
          </>
        )
      )}
    </div>
  );
}
