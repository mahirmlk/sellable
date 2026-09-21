"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { RefreshButton } from "@/components/dashboard/commerce-ui";

type Tab = "overview" | "ai" | "negotiation" | "upsells";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50/80 border border-black/[0.05] p-4">
      <div className="text-[13px] font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums text-neutral-900">{value}</div>
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
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Analytics"
        subtitle="Revenue analytics from your sales"
        actions={
          <RefreshButton onRefresh={() => void fetchData()} loading={loading} />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard label="Revenue" value={growth.revenue / 100} prefix="₹" decimals={2} />
                <MetricCard label="Orders" value={growth.total_orders} />
                <MetricCard label="Avg order value" value={growth.avg_order_value / 100} prefix="₹" decimals={2} />
                <MetricCard label="AI-assisted revenue" value={growth.agent_assisted_revenue / 100} prefix="₹" highlight decimals={2} />
              </div>
            )}

            {tab === "ai" && (
              <Section title="AI sales" hint="Agent-assisted share of revenue">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Stat label="AI-assisted revenue" value={formatPaise(growth.agent_assisted_revenue)} />
                  <Stat label="Total revenue" value={formatPaise(growth.revenue)} />
                  <Stat label="AI share" value={`${aiShare}%`} />
                </div>
                <p className="mt-4 text-[14px] text-neutral-500 leading-relaxed">
                  Revenue from orders where the AI seller assisted discovery, quoting, negotiation, or checkout.
                </p>
              </Section>
            )}

            {tab === "negotiation" && (
              <Section title="Negotiation" hint="Accepted, countered and walked away">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Negotiations" value={String(growth.negotiations)} />
                  <Stat label="Accepted" value={String(growth.negotiated_accepted)} />
                  <Stat label="Countered" value={String(growth.countered)} />
                  <Stat label="Walked away" value={String(growth.walked_away)} />
                </div>
              </Section>
            )}

            {tab === "upsells" && (
              <Section title="Upsells" hint="Offers, accepted and attach rate">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Offers" value={String(growth.upsell_offers)} />
                  <Stat label="Accepted" value={String(growth.upsell_accepted)} />
                  <Stat label="Attach rate" value={`${attachRate}%`} />
                  <Stat label="Upsell revenue" value={formatPaise(growth.upsell_revenue)} />
                </div>
                <p className="mt-4 text-[12px] text-neutral-400">
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
