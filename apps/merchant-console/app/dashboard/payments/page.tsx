"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, ArrowRight } from "lucide-react";
import {
  getConsoleTransactions,
  getAgentsStatus,
  type ConsoleTransaction,
  type AgentsStatusResponse,
} from "@/lib/api";
import { formatPaise, formatTimeAgo } from "@/lib/formatters";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { DataTable } from "@/components/dashboard/data-table";
import {
  Section,
  PartialBanner,
} from "@/components/dashboard/tier-fallbacks";

type Bucket = "CAPTURED" | "FAILED" | "PENDING" | "NONE";

function bucketOf(tx: ConsoleTransaction): Bucket {
  const s = (tx.payment_status ?? "").toUpperCase();
  if (s === "CAPTURED") return "CAPTURED";
  if (s === "FAILED") return "FAILED";
  // A started-but-unsettled provider attempt, or an order awaiting payment,
  // counts as pending. Orders with no payment attempt at all are NONE and
  // excluded from the payment records table.
  if (s === "PAYMENT_PENDING" || tx.status === "PAYMENT_PENDING" || tx.status === "CONSENTED") return "PENDING";
  return "NONE";
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<ConsoleTransaction[] | null>(null);
  const [rail, setRail] = useState<AgentsStatusResponse["payment_rail"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setPartialError(null);
    const [t, s] = await Promise.allSettled([getConsoleTransactions(), getAgentsStatus()]);
    if (t.status === "fulfilled") setTransactions(t.value);
    else setTransactions(null);
    if (s.status === "fulfilled") setRail(s.value.payment_rail);
    else setRail(null);
    if (t.status === "rejected" && s.status === "rejected") {
      setLoadError("Payment data could not be loaded from the backend.");
    } else if (t.status === "rejected" || s.status === "rejected") {
      setPartialError(
        t.status === "rejected"
          ? "Transactions failed to load — payment records are unavailable."
          : "Payment rail status failed to load — rail details are unavailable."
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
  }, [fetchData]);

  const records = (transactions ?? [])
    .map((tx) => ({ tx, bucket: bucketOf(tx) }))
    .filter((r) => r.bucket !== "NONE");
  const captured = records.filter((r) => r.bucket === "CAPTURED").length;
  const failed = records.filter((r) => r.bucket === "FAILED").length;
  const pending = records.filter((r) => r.bucket === "PENDING").length;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Payments"
        subtitle="PROVIDER PAYMENT RECORDS · DERIVED FROM TRANSACTIONS"
        actions={
          <button onClick={() => void fetchData()} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
          </button>
        }
      />

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : transactions === null ? (
        <EmptyState title="Payments unavailable" message="Transaction data could not be loaded from the backend." />
      ) : (
        <>
          <Section title="PAYMENT RAIL" hint="FROM LIVE SYSTEM STATUS">
            {rail ? (
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)] leading-relaxed">
                Provider {rail.provider} · {rail.mode} · {rail.configured ? "CONFIGURED" : "NOT CONFIGURED"} ·{" "}
                webhook {rail.webhook_configured ? "CONFIGURED" : "NOT CONFIGURED"}
                {rail.webhook_last_verified_at && (
                  <> · last verified {new Date(rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })}</>
                )}
              </div>
            ) : (
              <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-3)]">Payment rail status unavailable.</div>
            )}
          </Section>

          <div className="grid grid-cols-3 gap-4 stagger-child">
            {[
              { label: "Captured", value: captured, tone: "text-green-400" },
              { label: "Failed", value: failed, tone: "text-red-400" },
              { label: "Pending", value: pending, tone: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label} className="border border-[var(--bb-line)] p-4 bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-3">{s.label}</div>
                <div className={`font-[var(--font-mono)] text-[1.35rem] leading-none tabular-nums ${s.tone}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {records.length === 0 ? (
            <EmptyState
              title="No payment records yet."
              message="Payment records appear here once orders reach the payment stage — start a checkout in AI Sales."
            />
          ) : (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Provider order</th>
                    <th>Updated</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(({ tx, bucket }) => (
                    <tr key={tx.order_id}>
                      <td data-label="Order" className="font-[var(--font-mono)] text-[0.7rem]">{tx.order_id}</td>
                      <td data-label="Amount" className="font-[var(--font-mono)] tabular-nums">{formatPaise(tx.amount_paise)}</td>
                      <td data-label="Status">
                        <span className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase ${bucket === "CAPTURED" ? "text-green-400" : bucket === "FAILED" ? "text-red-400" : "text-yellow-400"}`}>
                          {bucket}
                        </span>
                      </td>
                      <td data-label="Provider order" className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)]">{tx.payment_order_id ?? "—"}</td>
                      <td data-label="Updated" className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{formatTimeAgo(tx.created_at)}</td>
                      <td data-label="Open">
                        <Link href={`/dashboard/transactions/${tx.order_id}`} className="inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-orange)] hover:text-[var(--bb-orange-bright)]">
                          VIEW <ArrowRight size={10} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </>
      )}
    </div>
  );
}
