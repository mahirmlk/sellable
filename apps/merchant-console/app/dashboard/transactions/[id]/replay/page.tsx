"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { ActorBadge } from "@/components/dashboard/actor-badge";
import { formatTimestamp, formatPaise } from "@/lib/formatters";
import { type LedgerEvent } from "@/lib/types/domain";
import { getConsoleTransactionDetail, type LedgerEvent as ApiLedgerEvent } from "@/lib/api";

const replaySteps = [
  "Buyer intent",
  "Catalog search",
  "Product selection",
  "Quote created",
  "Negotiation",
  "Upsell proposed",
  "Buyer accepted",
  "Policy evaluation",
  "Consent issued",
  "Razorpay order created",
  "Payment attempted",
  "Payment captured",
  "Webhook verified",
  "Order settled",
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

export default function ReplayPage() {
  const params = useParams();
  const id = params.id as string;
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [txEvents, setTxEvents] = useState<LedgerEvent[]>([]);

  useEffect(() => {
    getConsoleTransactionDetail(id)
      .then((data) => {
        if (data.events && data.events.length > 0) {
          setTxEvents(mapEvents(data.events));
        }
      })
      .catch(() => {});
  }, [id]);

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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

      {/* Timeline */}
      <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
        <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
          <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
            REPLAY TIMELINE — {replaySteps.length} STEPS
          </div>
        </div>
        {replaySteps.map((step, i) => {
          const matchedEvent = txEvents[i] || null;
          const isExpanded = expandedSteps.has(i);
          return (
            <div
              key={i}
              className={`hover-panel transition-colors ${
                i < replaySteps.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
              }`}
            >
              <button
                onClick={() => toggleStep(i)}
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
                <span className={`font-[var(--font-sans)] text-[0.85rem] ${matchedEvent ? "text-[var(--bb-white)]" : "text-[var(--bb-grey-3)]"}`}>
                  {step}
                </span>
                {matchedEvent && (
                  <span className="ml-auto font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] group-hover:text-[var(--bb-grey-2)] transition-colors">
                    {formatTimestamp(matchedEvent.timestamp)}
                  </span>
                )}
                {!matchedEvent && (
                  <span className="ml-auto font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] italic">
                    no event
                  </span>
                )}
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ease-[var(--ease-out)] ${
                  isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {matchedEvent && (
                  <div className="px-5 pb-4">
                    <EventDetail event={matchedEvent} />
                  </div>
                )}
                {!matchedEvent && (
                  <div className="px-5 pb-4 ml-8 font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-4)]">
                    No ledger event recorded for this step.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
