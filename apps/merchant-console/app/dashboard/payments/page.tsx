"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
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
import { RefreshButton, FilterTabs, SavedViewsBar } from "@/components/dashboard/commerce-ui";
import { PaymentBadge } from "@/components/dashboard/status-badge";
import { exportToCsv } from "@/lib/csv";
import { toast } from "@/components/dashboard/toasts";

type Bucket = "CAPTURED" | "FAILED" | "PENDING" | "NONE";

type BucketFilter = "ALL" | Bucket;

interface PaymentView {
  bucket: BucketFilter;
}

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
  const [bucket, setBucket] = useState<BucketFilter>("ALL");

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

  const visible = useMemo(
    () => (bucket === "ALL" ? records : records.filter((r) => r.bucket === bucket)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, bucket]
  );

  const handleExport = useCallback(() => {
    const rows = visible.map(({ tx, bucket: b }) => ({
      order_id: tx.order_id,
      amount_inr: (tx.amount_paise / 100).toFixed(2),
      status: b,
      provider_order_id: tx.payment_order_id ?? "",
      payment_id: tx.payment_id ?? "",
      updated_at: tx.created_at,
    }));
    exportToCsv("payments.csv", rows);
    toast({ tone: "success", title: "Exported payments.csv", description: `${rows.length} rows` });
  }, [visible]);

  const applyView = useCallback((v: PaymentView) => {
    setBucket(v.bucket);
  }, []);

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <PageHeader
        title="Payments"
        subtitle="Payment records from your transactions"
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

      {loadError && <ErrorBanner message={loadError} onRetry={() => void fetchData()} />}
      {partialError && <PartialBanner message={partialError} />}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : transactions === null ? (
        <EmptyState title="Payments unavailable" message="Transaction data could not be loaded from the backend." />
      ) : (
        <>
          <Section title="Payment rail" hint="Live system status">
            {rail ? (
              <div className="text-[14px] text-neutral-600 leading-relaxed">
                Provider <span className="font-medium text-neutral-900">{rail.provider}</span> · {rail.mode} ·{" "}
                {rail.configured ? "Configured" : "Not configured"} · webhook{" "}
                {rail.webhook_configured ? "configured" : "not configured"}
                {rail.webhook_last_verified_at && (
                  <> · last verified {new Date(rail.webhook_last_verified_at).toLocaleString("en-IN", { hour12: false })}</>
                )}
              </div>
            ) : (
              <div className="text-[14px] text-neutral-500">Payment rail status unavailable.</div>
            )}
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Captured", value: captured },
              { label: "Failed", value: failed },
              { label: "Pending", value: pending },
            ].map((s) => (
              <div key={s.label} className="rounded-[18px] bg-panel border border-hairline shadow-card p-5 transition-all duration-200 hover:-translate-y-px">
                <div className="text-[13px] font-medium text-neutral-500 mb-2">{s.label}</div>
                <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-neutral-900">{s.value}</div>
              </div>
            ))}
          </div>

          {records.length === 0 ? (
            <EmptyState
              title="No payment records yet."
              message="Payment records appear here once orders reach the payment stage — start a checkout in AI Sales."
            />
          ) : (
            <>
              <FilterTabs<BucketFilter>
                tabs={[
                  { key: "ALL", label: "All", count: records.length },
                  { key: "CAPTURED", label: "Captured", count: captured },
                  { key: "FAILED", label: "Failed", count: failed },
                  { key: "PENDING", label: "Pending", count: pending },
                ]}
                active={bucket}
                onChange={setBucket}
              />

              <SavedViewsBar<PaymentView>
                storageKey="payments"
                current={{ bucket }}
                onApply={applyView}
              />

              {visible.length === 0 ? (
                <EmptyState
                  title="No payments match"
                  message="No payment records match the current filter."
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
                  {visible.map(({ tx, bucket }) => (
                    <tr key={tx.order_id}>
                      <td data-label="Order" className="text-[13px] text-neutral-500 tabular-nums">{tx.order_id}</td>
                      <td data-label="Amount" className="text-[15px] font-semibold text-neutral-900 tabular-nums">{formatPaise(tx.amount_paise)}</td>
                      <td data-label="Status">
                        <PaymentBadge status={bucket} />
                      </td>
                      <td data-label="Provider order" className="text-[13px] text-neutral-500 tabular-nums">{tx.payment_order_id ?? "—"}</td>
                      <td data-label="Updated" className="text-[12px] text-neutral-400">{formatTimeAgo(tx.created_at)}</td>
                      <td data-label="Open">
                        <Link href={`/dashboard/transactions/${tx.order_id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline">
                          View <ArrowRight size={12} />
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
        </>
      )}
    </div>
  );
}
