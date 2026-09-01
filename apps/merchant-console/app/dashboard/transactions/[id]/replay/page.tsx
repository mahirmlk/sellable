"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, ShieldCheck, ShieldAlert, XCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { ActorBadge } from "@/components/dashboard/actor-badge";
import { formatTimestamp } from "@/lib/formatters";
import { type LedgerEvent } from "@/lib/types/domain";
import { getConsoleTransactionDetail, type LedgerEvent as ApiLedgerEvent, type ConsoleTransactionDetail } from "@/lib/api";

interface ReplayStage {
  key: string;
  label: string;
  match: (action: string) => boolean;
}

const replayStages: ReplayStage[] = [
  { key: "intent", label: "Buyer intent", match: (a) => a.includes("intent") || a === "buyer.mission_evaluated" },
  { key: "discovery", label: "Discovery", match: (a) => a.includes("discover") },
  { key: "search", label: "Catalog search", match: (a) => a === "catalog.search" || a === "catalog.get" },
  { key: "selection", label: "Product selection", match: (a) => a === "product.selected" || a === "quote.received" },
  { key: "quote", label: "Quote created", match: (a) => a === "quote.created" },
  { key: "negotiation", label: "Negotiation", match: (a) => a.includes("negotiat") },
  { key: "upsell", label: "Upsell", match: (a) => a.includes("upsell") },
  { key: "policy", label: "Policy evaluation", match: (a) => a === "policy.checked" },
  { key: "consent", label: "Consent", match: (a) => a.includes("consent") },
  { key: "order", label: "Order created", match: (a) => a === "order.created" },
  { key: "payment", label: "Payment attempted", match: (a) => a.includes("payment.attempted") || a === "payment.pending" },
  { key: "webhook", label: "Webhook verified", match: (a) => a.includes("webhook") },
  { key: "captured", label: "Payment captured", match: (a) => a === "payment.captured" || a === "order.paid" || a === "payment.failed" },
  { key: "settled", label: "Order settled / ledger", match: (a) => a.includes("settled") || a === "seller.response_ready" },
];

function stageForAction(action: string): ReplayStage | null {
  for (const stage of replayStages) {
    if (stage.match(action)) return stage;
  }
  return null;
}

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
    providerRefs: e.provider_ref ? { provider_ref: e.provider_ref } : undefined,
    flags: e.flags,
  }));
}

function EventDetail({ event }: { event: LedgerEvent }) {
  return (
    <div className="ml-8 mt-2 mb-4 border-l border-[var(--bb-line)] pl-4 space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Actor</div>
          <ActorBadge actor={event.actor} />
        </div>
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Action</div>
          <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{event.action}</div>
        </div>
      </div>
      {event.reasoningSummary && (
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Explanation</div>
          <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
            {event.reasoningSummary}
          </div>
        </div>
      )}
      <div>
        <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Inputs</div>
        <pre className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] bg-[var(--bb-panel)] p-2 border border-[var(--bb-line)] overflow-x-auto">
          {JSON.stringify(event.inputs, null, 2)}
        </pre>
      </div>
      <div>
        <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Output</div>
        <pre className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-2)] bg-[var(--bb-panel)] p-2 border border-[var(--bb-line)] overflow-x-auto">
          {JSON.stringify(event.output, null, 2)}
        </pre>
      </div>
      {event.policyRefs.length > 0 && (
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Policy references</div>
          <div className="flex flex-wrap gap-1.5">
            {event.policyRefs.map((ref) => (
              <span
                key={ref}
                className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"
              >
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}
      {event.providerRefs && Object.keys(event.providerRefs).length > 0 && (
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Provider references</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(event.providerRefs).map(([key, val]) => (
              <span
                key={key}
                className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"
              >
                {key}: {val}
              </span>
            ))}
          </div>
        </div>
      )}
      {event.flags.length > 0 && (
        <div>
          <div className="font-[var(--font-mono)] text-[0.5rem] uppercase text-[var(--bb-grey-4)] mb-1">Flags</div>
          <div className="flex flex-wrap gap-1.5">
            {event.flags.map((flag) => (
              <span
                key={flag}
                className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 bg-[var(--bb-orange-wash-2)] text-[var(--bb-orange)]"
              >
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StageMarker({ status }: { status: "success" | "denied" | "failed" | "default" }) {
  if (status === "denied") {
    return (
      <span className="inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-red-400">
        <XCircle size={11} /> DENIED
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-red-400">
        <ShieldAlert size={11} /> FAILED
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.5rem] tracking-[0.1em] uppercase text-green-400">
        <ShieldCheck size={11} /> OK
      </span>
    );
  }
  return null;
}

export default function ReplayPage() {
  const params = useParams();
  const id = params.id as string;
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [txEvents, setTxEvents] = useState<LedgerEvent[]>([]);
  const [tx, setTx] = useState<ConsoleTransactionDetail | null>(null);

  useEffect(() => {
    getConsoleTransactionDetail(id)
      .then((data) => {
        setTx(data);
        if (data.events && data.events.length > 0) {
          setTxEvents(mapEvents(data.events));
        }
      })
      .catch(() => {});
  }, [id]);

  const toggleStep = (key: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const status = tx?.status || "";
  const isDenied = status === "ABORTED" || status === "DENIED" || txEvents.some((e) => e.action === "policy.checked" && e.output?.verdict === "DENY");
  const isFailed = status === "PAYMENT_FAILED" || status === "ABORTED";
  const isPaid = status === "PAID" || status === "FULFILLED" || status === "REFUNDED";

  const stages: { stage: ReplayStage; events: LedgerEvent[] }[] = replayStages
    .map((stage) => ({ stage, events: txEvents.filter((e) => stage.match(e.action)) }))
    .filter((s) => s.events.length > 0);

  const unassigned = txEvents.filter((e) => !stageForAction(e.action));

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

      {/* Timeline */}
      <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
            REPLAY TIMELINE — {stages.length + (unassigned.length > 0 ? 1 : 0)} STAGES
          </div>
        </div>
        {stages.length === 0 && (
          <div className="px-5 py-12 text-center font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
            No ledger events recorded for this transaction.
          </div>
        )}
        {stages.map(({ stage, events }, i) => {
          const isExpanded = expandedSteps.has(stage.key);
          const deniedHere = events.some((e) => e.action === "policy.checked" && e.output?.verdict === "DENY");
          const failedHere = events.some((e) => e.action === "payment.failed" || e.action === "retry.aborted" || e.action === "order.aborted");
          const marker: "success" | "denied" | "failed" | "default" = deniedHere ? "denied" : failedHere ? "failed" : "success";
          return (
            <div
              key={stage.key}
              className={`hover-panel transition-colors ${
                i < stages.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <button
                onClick={() => toggleStep(stage.key)}
                className="w-full flex items-center gap-3 text-left bg-transparent border-0 p-4 cursor-pointer group"
              >
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] w-[24px] flex-shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                >
                  <ChevronRight size={14} className="text-[var(--bb-grey-3)] group-hover:text-[var(--bb-orange)] transition-colors" />
                </span>
                <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">
                  {stage.label}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <StageMarker status={marker} />
                  <span className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] group-hover:text-[var(--bb-grey-2)] transition-colors">
                    {formatTimestamp(events[0].timestamp)}
                  </span>
                </span>
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ease-[var(--ease-out)] ${
                  isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {events.map((event) => (
                  <div key={event.eventId} className="px-5 pb-1">
                    <EventDetail event={event} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {unassigned.length > 0 && (
          <div key="unassigned" className="hover-panel transition-colors border-t border-[var(--bb-line-soft)]">
            <button
              onClick={() => toggleStep("unassigned")}
              className="w-full flex items-center gap-3 text-left bg-transparent border-0 p-4 cursor-pointer group"
            >
              <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] w-[24px] flex-shrink-0">
                {String(stages.length + 1).padStart(2, "0")}
              </span>
              <span className={`transition-transform duration-200 ${expandedSteps.has("unassigned") ? "rotate-90" : ""}`}>
                <ChevronRight size={14} className="text-[var(--bb-grey-3)] group-hover:text-[var(--bb-orange)] transition-colors" />
              </span>
              <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-grey-2)]">Additional ledger events</span>
              <span className="ml-auto font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)]">{unassigned.length} events</span>
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-[var(--ease-out)] ${expandedSteps.has("unassigned") ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"}`}>
              {unassigned.map((event) => (
                <div key={event.eventId} className="px-5 pb-1">
                  <EventDetail event={event} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}