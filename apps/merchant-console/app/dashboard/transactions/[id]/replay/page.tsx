"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, ShieldAlert, XCircle, RefreshCw } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { ActorBadge } from "@/components/dashboard/actor-badge";
import { formatTimestamp } from "@/lib/formatters";
import { type LedgerEvent } from "@/lib/types/domain";
import { getConsoleTransactionDetail, type LedgerEvent as ApiLedgerEvent, type ConsoleTransactionDetail } from "@/lib/api";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";

interface ReplayStage {
  key: string;
  label: string;
  match: (action: string) => boolean;
}

// Canonical commerce stages. Every ledger event lands in exactly one bucket
// (first match wins; leftovers fold into final-state where each row still
// shows its true action name — nothing is relabeled).
const replayStages: ReplayStage[] = [
  { key: "intent", label: "Intent", match: (a) => a === "buyer.mission_received" || a.includes("intent") || a === "buyer.mission_evaluated" },
  { key: "discovery", label: "Discovery", match: (a) => a.includes("discover") || a === "catalog.search" || a === "catalog.get" || a === "buyer.catalog_researched" },
  { key: "product", label: "Product", match: (a) => a === "product.selected" || a === "quote.received" },
  { key: "quote", label: "Quote", match: (a) => a === "quote.created" || a === "buyer.response_phrased" },
  { key: "negotiation", label: "Negotiation", match: (a) => a.includes("negotiat") || a.includes("upsell") },
  { key: "policy", label: "Policy", match: (a) => a.includes("policy") },
  { key: "approval", label: "Approval", match: (a) => a === "buyer.order_requested" || a === "buyer.order_held" || a.includes("approv") || a === "order.created" },
  { key: "consent", label: "Consent", match: (a) => a.includes("consent") },
  { key: "payment", label: "Payment", match: (a) => a.includes("payment.attempted") || a === "payment.pending" || a === "payment.captured" || a === "payment.failed" || a === "order.paid" || a === "buyer.payment_verified" },
  { key: "webhook", label: "Webhook", match: (a) => a.includes("webhook") },
  { key: "final", label: "Final state", match: () => true },
];

function mapEvents(events: ApiLedgerEvent[]): LedgerEvent[] {
  return events.map((e) => ({
    eventId: e.event_id,
    traceId: e.trace_id,
    timestamp: e.timestamp,
    actor: e.actor as LedgerEvent["actor"],
    action: e.action,
    inputs: e.inputs,
    output: e.output,
    reasoningSummary: e.reasoning_summary ?? undefined,
    policyRefs: e.policy_refs,
    outcome_effect: e.outcome_effect ?? null,
    provider_ref: e.provider_ref ?? null,
    flags: e.flags,
  }));
}

/** Decision shown in the detail panel: only backend-reported verdict fields. */
function decisionOf(event: LedgerEvent): string {
  const out = (event.output ?? {}) as Record<string, unknown>;
  for (const k of ["verdict", "decision", "action", "status"]) {
    const v = out[k];
    if (typeof v === "string" && v) return v;
  }
  return "—";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-neutral-500 mb-1">{label}</div>
      <div className="text-[13px] text-neutral-900 break-all">{children}</div>
    </div>
  );
}

export default function ReplayPage() {
  const params = useParams();
  const id = params.id as string;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [txEvents, setTxEvents] = useState<LedgerEvent[]>([]);
  const [tx, setTx] = useState<ConsoleTransactionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchData = () => {
    setLoaded(false);
    setLoadError(null);
    getConsoleTransactionDetail(id)
      .then((data) => {
        setTx(data);
        setLoaded(true);
        if (data.events && data.events.length > 0) {
          const mapped = mapEvents(data.events);
          setTxEvents(mapped);
          setSelectedId((prev) => prev ?? mapped[0].eventId);
        }
      })
      .catch((err) => {
        setLoaded(true);
        setLoadError(
          err instanceof TypeError
            ? "Backend unreachable — the replay could not be loaded."
            : "The replay could not be loaded from the backend."
        );
      });
  };

  useEffect(() => {
    const t = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const status = tx?.status || "";
  // ABORTED is a merchant abort, not a policy deny — it already renders the
  // FAILED banner below. (There is no DENIED order status; denials surface
  // through the policy.checked → DENY event branch.)
  const isDenied = txEvents.some((e) => e.action === "policy.checked" && (e.output as Record<string, unknown>)?.verdict === "DENY");
  const isFailed = status === "PAYMENT_FAILED" || status === "ABORTED";
  const isRefunded = status === "REFUNDED";
  const isPaid = (status === "PAID" || status === "FULFILLED") && !isRefunded;

  const stages = useMemo(() => {
    const remaining = [...txEvents];
    return replayStages
      .map((stage, idx) => {
        const last = idx === replayStages.length - 1;
        const events = remaining.filter((e) => (last ? true : stage.match(e.action)));
        if (!last) {
          for (const e of events) remaining.splice(remaining.indexOf(e), 1);
        }
        return { stage, events };
      })
      .filter((s) => s.events.length > 0);
  }, [txEvents]);

  const selected = txEvents.find((e) => e.eventId === selectedId) ?? null;

  return (
    <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">
      <Link
        href={`/dashboard/transactions/${id}`}
        className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
      >
        <ArrowLeft size={14} /> Back to transaction
      </Link>

      <div className="stagger-child">
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900">
          Transaction replay
        </h1>
        <p className="text-[13px] text-neutral-500 mt-1">
          {id} · Complete decision and payment trail
        </p>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={fetchData} />}

      {!loaded ? (
        <TableSkeleton rows={8} />
      ) : txEvents.length === 0 && !loadError ? (
        <EmptyState
          title="No ledger events"
          message="No ledger events were recorded for this transaction."
        />
      ) : (
        <>
          {isDenied && (
            <div className="rounded-2xl bg-red-50 border border-red-200/60 p-6 flex items-start gap-3">
              <XCircle size={18} className="text-red-700 flex-shrink-0 mt-0.5" />
              <div>
                <div className="mb-1"><span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-red-50 text-red-700 border border-red-200/60">Denied transaction</span></div>
                <div className="text-[13px] text-neutral-600 leading-relaxed">
                  The agent proposal was rejected by the deterministic Policy Engine. No Razorpay order was created and no money moved. The proposal is not an executed financial action.
                </div>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="rounded-2xl bg-red-50 border border-red-200/60 p-6 flex items-start gap-3">
              <ShieldAlert size={18} className="text-red-700 flex-shrink-0 mt-0.5" />
              <div>
                <div className="mb-1"><span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-red-50 text-red-700 border border-red-200/60">Failed transaction</span></div>
                <div className="text-[13px] text-neutral-600 leading-relaxed">
                  The payment attempt failed, was classified, and either retried within the bounded limit or aborted cleanly. No duplicate settlement occurred.
                </div>
              </div>
            </div>
          )}

          {isPaid && (
            <div className="rounded-2xl bg-green-50 border border-green-200/60 p-6 flex items-start gap-3">
              <ShieldCheck size={18} className="text-green-700 flex-shrink-0 mt-0.5" />
              <div>
                <div className="mb-1"><span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-green-50 text-green-700 border border-green-200/60">Successful transaction</span></div>
                <div className="text-[13px] text-neutral-600 leading-relaxed">
                  The full loop completed: intent → discovery → catalog → quote → negotiation → upsell → policy allow → consent → Razorpay order → verified webhook → paid.
                </div>
              </div>
            </div>
          )}

          {isRefunded && (
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6 flex items-start gap-3">
              <ShieldCheck size={18} className="text-neutral-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="mb-1"><span className="inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium bg-neutral-100 text-neutral-700">Refunded transaction</span></div>
                <div className="text-[13px] text-neutral-600 leading-relaxed">
                  The order was captured and later refunded through the provider rail. The refund event below carries the provider refund reference.
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            {/* Timeline */}
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden stagger-child">
              <div className="px-6 py-4 border-b border-black/[0.06] flex items-center justify-between gap-3">
                <div className="text-[15px] font-semibold text-neutral-900">
                  Timeline — {stages.length} stages · {txEvents.length} events
                </div>
                <button onClick={fetchData} className="inline-flex items-center gap-1 h-9 px-4 rounded-full bg-white border border-black/10 shadow-sm text-[13px] font-medium text-neutral-600 hover:bg-neutral-50 transition-all cursor-pointer">
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>
              {stages.map(({ stage, events }, i) => (
                <div key={stage.key} className={i < stages.length - 1 ? "border-b border-black/[0.06]" : ""}>
                  <div className="px-6 pt-3 pb-1 text-[12px] text-neutral-400">
                    {String(i + 1).padStart(2, "0")} · {stage.label}
                  </div>
                  {events.map((event) => {
                    const active = event.eventId === selectedId;
                    return (
                      <button
                        key={event.eventId}
                        onClick={() => setSelectedId(event.eventId)}
                        className={`w-full text-left px-6 py-2.5 flex items-center gap-3 transition-colors cursor-pointer border-l-2 ${
                          active
                            ? "border-[#0071e3] bg-[#0071e3]/5"
                            : "border-transparent hover:bg-neutral-50"
                        }`}
                      >
                        <span className="text-[12px] text-neutral-400 shrink-0 w-[62px] tabular-nums">
                          {formatTimestamp(event.timestamp)}
                        </span>
                        <span className="text-[13px] text-neutral-900 truncate flex-1">
                          {event.action}
                        </span>
                        {event.policyRefs.length > 0 && (
                          <span className="hidden sm:inline text-[12px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                            {event.policyRefs[0]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selected event */}
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden lg:sticky lg:top-4">
              <div className="px-6 py-4 border-b border-black/[0.06]">
                <div className="text-[15px] font-semibold text-neutral-900">Selected event</div>
              </div>
              {!selected ? (
                <div className="px-6 py-8 text-center text-[13px] text-neutral-400">
                  Select an event in the timeline.
                </div>
              ) : (
                <div className="px-6 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[12px] text-neutral-500 mb-1">Actor</div>
                      <ActorBadge actor={selected.actor} />
                    </div>
                    <Field label="Action">{selected.action}</Field>
                  </div>
                  <Field label="Decision">{decisionOf(selected)}</Field>
                  <div>
                    <div className="text-[12px] text-neutral-500 mb-1">Reason</div>
                    <div className="text-[13px] text-neutral-600 leading-relaxed">
                      {selected.reasoningSummary ?? "No reasoning recorded for this event."}
                    </div>
                  </div>
                  <div>
                    <div className="text-[12px] text-neutral-500 mb-1">Policy refs</div>
                    {selected.policyRefs.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selected.policyRefs.map((ref) => (
                          <span key={ref} className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600">
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[13px] text-neutral-400">—</div>
                    )}
                  </div>
                  <Field label="Provider ref">{selected.provider_ref ?? "—"}</Field>
                  <Field label="Trace ID">{selected.traceId}</Field>
                  <Field label="Event ID">{selected.eventId}</Field>
                  {selected.flags.length > 0 && (
                    <div>
                      <div className="text-[12px] text-neutral-500 mb-1">Flags</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.flags.map((flag) => (
                          <span key={flag} className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <details>
                    <summary className="text-[13px] font-medium text-neutral-500 hover:text-neutral-900 cursor-pointer transition-colors">
                      Inputs / output
                    </summary>
                    <pre className="mt-2 text-[12px] text-neutral-600 bg-neutral-50 p-3 rounded-xl border border-black/[0.06] overflow-x-auto max-h-[300px] overflow-y-auto">
                      {JSON.stringify({ inputs: selected.inputs, output: selected.output }, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
