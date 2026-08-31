"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { ActorBadge, ActorIcon } from "@/components/dashboard/actor-badge";
import { formatTimestamp } from "@/lib/formatters";
import { type ActorType, type LedgerEvent } from "@/lib/types/domain";
import { getConsoleEvents } from "@/lib/api";

const actorFilters: { label: string; value: ActorType | "all" }[] = [
  { label: "All Actors", value: "all" },
  { label: "Buyer Agent", value: "buyer_agent" },
  { label: "Seller Agent", value: "seller_agent" },
  { label: "Policy Engine", value: "policy_engine" },
  { label: "Human", value: "human" },
  { label: "Razorpay", value: "razorpay" },
  { label: "System", value: "system" },
];

const eventTypeFilters = [
  "All Events",
  "catalog.search",
  "quote.created",
  "negotiation.*",
  "upsell.*",
  "policy.*",
  "consent.*",
  "payment.*",
  "order.*",
];

function mapEvent(e: { event_id: string; trace_id: string; timestamp: string; actor: string; action: string; inputs: Record<string, unknown>; output: Record<string, unknown>; reasoning_summary: string | null; policy_refs: string[]; outcome_effect: Record<string, unknown> | null; provider_ref: string | null; flags: string[] }): LedgerEvent {
  return {
    eventId: e.event_id,
    traceId: e.trace_id,
    timestamp: e.timestamp,
    actor: e.actor as ActorType,
    action: e.action,
    inputs: e.inputs,
    output: e.output,
    reasoningSummary: e.reasoning_summary ?? undefined,
    policyRefs: e.policy_refs,
    providerRefs: e.provider_ref ? { provider_ref: e.provider_ref } : undefined,
    flags: e.flags,
  };
}

export default function ActivityPage() {
  const [actorFilter, setActorFilter] = useState<ActorType | "all">("all");
  const [typeFilter, setTypeFilter] = useState("All Events");
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConsoleEvents(200);
      if (data.events) setEvents(data.events.map(mapEvent));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = events.filter((e) => {
    if (actorFilter !== "all" && e.actor !== actorFilter) return false;
    if (typeFilter !== "All Events" && !e.action.startsWith(typeFilter.replace(".*", ""))) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Activity</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">REAL-TIME OPERATIONAL FEED</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 stagger-child">
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">ACTOR</span>
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value as ActorType | "all")} className="font-[var(--font-mono)] text-[0.65rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-1.5 cursor-pointer">
            {actorFilters.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)]">TYPE</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="font-[var(--font-mono)] text-[0.65rem] bg-[var(--bb-panel)] border border-[var(--bb-line)] text-[var(--bb-white)] px-3 py-1.5 cursor-pointer">
            {eventTypeFilters.map((f) => (<option key={f} value={f}>{f}</option>))}
          </select>
        </div>
        <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{filtered.length} events</span>
      </div>

      <div className="border border-[var(--bb-line)] overflow-hidden stagger-child">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              {loading ? "Loading events..." : "No events match the current filters."}
            </div>
          </div>
        ) : filtered.map((event, i) => (
          <div key={event.eventId} className={`px-5 py-4 hover-panel transition-colors ${i < filtered.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-2 w-[60px] flex-shrink-0">
                <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{formatTimestamp(event.timestamp)}</span>
              </div>
              <ActorIcon actor={event.actor} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <ActorBadge actor={event.actor} />
                  <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">{event.action}</span>
                </div>
                {event.reasoningSummary && (
                  <div className="font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed mb-2">{event.reasoningSummary}</div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {event.policyRefs.map((ref) => (
                    <span key={ref} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]">{ref}</span>
                  ))}
                  {event.flags.map((flag) => (
                    <span key={flag} className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 bg-[var(--bb-orange-wash-2)] text-[var(--bb-orange)]">{flag}</span>
                  ))}
                </div>
              </div>
              <div className="font-[var(--font-mono)] text-[0.5rem] text-[var(--bb-grey-4)] flex-shrink-0">{event.traceId}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
