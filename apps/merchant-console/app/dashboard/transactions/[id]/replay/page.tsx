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
      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">{label}</div>
      <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] break-all">{children}</div>
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
    <div className="p-6 space-y-6">
      <Link
        href={`/dashboard/transactions/${id}`}
        className="inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] transition-colors"
      >
        <ArrowLeft size={14} /> BACK TO TRANSACTION
      </Link>

      <div className="stagger-child">
        <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">
          Transaction Replay
        </h1>
        <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">
          {id} · COMPLETE DECISION AND PAYMENT TRAIL
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
            <div className="border border-red-400/30 bg-red-400/5 p-5 flex items-start gap-3">
              <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-red-400 mb-1">DENIED TRANSACTION</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                  The agent proposal was rejected by the deterministic Policy Engine. No Razorpay order was created and no money moved. The proposal is not an executed financial action.
                </div>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="border border-red-400/30 bg-red-400/5 p-5 flex items-start gap-3">
              <ShieldAlert size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-red-400 mb-1">FAILED TRANSACTION</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                  The payment attempt failed, was classified, and either retried within the bounded limit or aborted cleanly. No duplicate settlement occurred.
                </div>
              </div>
            </div>
          )}

          {isPaid && (
            <div className="border border-green-400/30 bg-green-400/5 p-5 flex items-start gap-3">
              <ShieldCheck size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-green-400 mb-1">SUCCESSFUL TRANSACTION</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                  The full loop completed: intent → discovery → catalog → quote → negotiation → upsell → policy ALLOW → consent → Razorpay order → verified webhook → PAID.
                </div>
              </div>
            </div>
          )}

          {isRefunded && (
            <div className="border border-purple-400/30 bg-purple-400/5 p-5 flex items-start gap-3">
              <ShieldCheck size={18} className="text-purple-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.12em] uppercase text-purple-400 mb-1">REFUNDED TRANSACTION</div>
                <div className="font-[var(--font-sans)] text-[0.78rem] text-[var(--bb-grey-2)] leading-relaxed">
                  The order was captured and later refunded through the provider rail. The refund event below carries the provider refund reference.
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            {/* Timeline */}
            <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between gap-3">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
                  TIMELINE — {stages.length} STAGES · {txEvents.length} EVENTS
                </div>
                <button onClick={fetchData} className="inline-flex items-center gap-1 h-[26px] px-2 border border-[var(--bb-line)] bg-transparent font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer">
                  <RefreshCw size={10} /> REFRESH
                </button>
              </div>
              {stages.map(({ stage, events }, i) => (
                <div key={stage.key} className={i < stages.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}>
                  <div className="px-5 pt-3 pb-1 font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-4)]">
                    {String(i + 1).padStart(2, "0")} · {stage.label}
                  </div>
                  {events.map((event) => {
                    const active = event.eventId === selectedId;
                    return (
                      <button
                        key={event.eventId}
                        onClick={() => setSelectedId(event.eventId)}
                        className={`w-full text-left px-5 py-2.5 flex items-center gap-3 transition-colors cursor-pointer border-l-2 ${
                          active
                            ? "border-[var(--bb-orange)] bg-[var(--bb-orange)]/5"
                            : "border-transparent hover:bg-[var(--bb-panel)]"
                        }`}
                      >
                        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)] shrink-0 w-[62px]">
                          {formatTimestamp(event.timestamp)}
                        </span>
                        <span className="font-[var(--font-mono)] text-[0.68rem] text-[var(--bb-white)] truncate flex-1">
                          {event.action}
                        </span>
                        {event.policyRefs.length > 0 && (
                          <span className="hidden sm:inline font-[var(--font-mono)] text-[0.48rem] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)] shrink-0">
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
            <div className="border border-[var(--bb-line)] overflow-hidden lg:sticky lg:top-4">
              <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
                <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">SELECTED EVENT</div>
              </div>
              {!selected ? (
                <div className="px-5 py-8 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
                  Select an event in the timeline.
                </div>
              ) : (
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Actor</div>
                      <ActorBadge actor={selected.actor} />
                    </div>
                    <Field label="Action">{selected.action}</Field>
                  </div>
                  <Field label="Decision">{decisionOf(selected)}</Field>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Reason</div>
                    <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
                      {selected.reasoningSummary ?? "No reasoning recorded for this event."}
                    </div>
                  </div>
                  <div>
                    <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Policy refs</div>
                    {selected.policyRefs.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selected.policyRefs.map((ref) => (
                          <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">—</div>
                    )}
                  </div>
                  <Field label="Provider ref">{selected.provider_ref ?? "—"}</Field>
                  <Field label="Trace ID">{selected.traceId}</Field>
                  <Field label="Event ID">{selected.eventId}</Field>
                  {selected.flags.length > 0 && (
                    <div>
                      <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Flags</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.flags.map((flag) => (
                          <span key={flag} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 bg-[var(--bb-orange-wash-2)] text-[var(--bb-orange)]">
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <details>
                    <summary className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] cursor-pointer transition-colors">
                      INPUTS / OUTPUT
                    </summary>
                    <pre className="mt-2 font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] bg-[var(--bb-panel)] p-3 border border-[var(--bb-line)] overflow-x-auto max-h-[300px] overflow-y-auto">
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
