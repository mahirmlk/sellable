import { ActorBadge } from "@/components/dashboard/actor-badge";
import { type ActorType } from "@/lib/types/domain";

const events = [
  {
    event_id: "evt_001",
    trace_id: "trc_abc123",
    actor: "buyer_agent",
    action: "catalog.search",
    reasoning: "Searched for wireless headphones in accessories category",
    policy_refs: ["POLICY.catalog_access"],
    timestamp: "12:34:01",
  },
  {
    event_id: "evt_002",
    trace_id: "trc_abc123",
    actor: "seller_agent",
    action: "quote.create",
    reasoning: "Created quote for Wave Pro Wireless Headphones at floor price",
    policy_refs: ["POLICY.floor_price", "POLICY.max_discount"],
    timestamp: "12:34:02",
  },
  {
    event_id: "evt_003",
    trace_id: "trc_abc123",
    actor: "seller_agent",
    action: "upsell.suggest",
    reasoning: "Suggested Headphone Travel Case — compatible with selected item, within buyer budget",
    policy_refs: ["POLICY.upsell_allowed", "POLICY.buyer_budget"],
    timestamp: "12:34:02",
  },
  {
    event_id: "evt_004",
    trace_id: "trc_abc123",
    actor: "policy_engine",
    action: "policy.evaluate",
    reasoning: "Total ₹5,698 within max order ₹5,000 — DENY. Counter-offer within limits accepted.",
    policy_refs: ["POLICY.max_order_value"],
    timestamp: "12:34:03",
  },
  {
    event_id: "evt_005",
    trace_id: "trc_abc123",
    actor: "consent_service",
    action: "consent.issue",
    reasoning: "Single-use consent issued for ₹4,999, expires in 10 minutes",
    policy_refs: ["POLICY.consent_required"],
    timestamp: "12:34:04",
  },
  {
    event_id: "evt_006",
    trace_id: "trc_abc123",
    actor: "payment_rail",
    action: "payment.captured",
    reasoning: "Payment captured via payment provider test mode",
    policy_refs: [],
    timestamp: "12:34:05",
  },
];

const KNOWN_ACTORS = new Set<string>([
  "buyer_agent",
  "seller_agent",
  "policy_engine",
  "consent_service",
  "human",
  "razorpay",
  "commerce_core",
]);

export function LedgerView() {
  return (
    <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/[0.05] bg-white flex items-center justify-between">
        <div className="text-[13px] font-semibold text-neutral-900">
          XAI Ledger — trace trc_abc123
        </div>
        <div className="text-[13px] text-neutral-500 tabular-nums">
          {events.length} events
        </div>
      </div>

      {/* Events */}
      {events.map((event) => (
        <div
          key={event.event_id}
          className="px-6 py-4 border-b border-black/[0.05] last:border-b-0 hover:bg-neutral-50 transition-colors"
        >
          {/* Desktop */}
          <div className="hidden sm:block">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[13px] text-neutral-400 w-[50px] flex-shrink-0 tabular-nums">
                  {event.timestamp}
                </span>
                {KNOWN_ACTORS.has(event.actor) ? (
                  <ActorBadge actor={event.actor as ActorType} />
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none bg-neutral-100 text-neutral-600"
                    title={event.actor}
                  >
                    {event.actor}
                  </span>
                )}
                <span className="text-[14px] font-medium text-neutral-900">
                  {event.action}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {event.policy_refs.map((ref) => (
                  <span
                    key={ref}
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-medium text-neutral-600"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2 ml-[62px] text-[14px] text-neutral-600 leading-relaxed">
              {event.reasoning}
            </div>
          </div>

          {/* Mobile */}
          <div className="sm:hidden">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[13px] text-neutral-400 tabular-nums">
                {event.timestamp}
              </span>
              {KNOWN_ACTORS.has(event.actor) ? (
                <ActorBadge actor={event.actor as ActorType} />
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none bg-neutral-100 text-neutral-600"
                  title={event.actor}
                >
                  {event.actor}
                </span>
              )}
            </div>
            <div className="text-[14px] font-medium text-neutral-900 mb-1">
              {event.action}
            </div>
            <div className="text-[14px] text-neutral-600 leading-relaxed mb-2">
              {event.reasoning}
            </div>
            {event.policy_refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {event.policy_refs.map((ref) => (
                  <span
                    key={ref}
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-medium text-neutral-600"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
