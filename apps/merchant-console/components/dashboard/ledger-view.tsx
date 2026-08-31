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

const actorColors: Record<string, string> = {
  buyer_agent: "text-blue-400",
  seller_agent: "text-[var(--bb-orange)]",
  policy_engine: "text-yellow-400",
  consent_service: "text-green-400",
  payment_rail: "text-purple-400",
  commerce_core: "text-[var(--bb-grey-1)]",
};

export function LedgerView() {
  return (
    <div className="border border-[var(--bb-line)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
        <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          XAI LEDGER — TRACE trc_abc123
        </div>
        <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
          {events.length} EVENTS
        </div>
      </div>

      {/* Events */}
      {events.map((event, i) => (
        <div
          key={event.event_id}
          className={`px-5 py-4 ${
            i < events.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
          } hover:bg-[var(--bb-panel)] transition-colors`}
        >
          {/* Desktop */}
          <div className="hidden sm:block">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] w-[50px] flex-shrink-0">
                  {event.timestamp}
                </span>
                <span
                  className={`font-[var(--font-mono)] text-[0.65rem] tracking-[0.08em] uppercase ${actorColors[event.actor] || "text-[var(--bb-grey-2)]"}`}
                >
                  {event.actor}
                </span>
                <span className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)]">
                  {event.action}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {event.policy_refs.map((ref) => (
                  <span
                    key={ref}
                    className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2 ml-[62px] font-[var(--font-sans)] text-[0.8rem] text-[var(--bb-grey-2)] leading-relaxed">
              {event.reasoning}
            </div>
          </div>

          {/* Mobile */}
          <div className="sm:hidden">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
                {event.timestamp}
              </span>
              <span
                className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase ${actorColors[event.actor] || "text-[var(--bb-grey-2)]"}`}
              >
                {event.actor}
              </span>
            </div>
            <div className="font-[var(--font-mono)] text-[0.7rem] text-[var(--bb-white)] mb-1">
              {event.action}
            </div>
            <div className="font-[var(--font-sans)] text-[0.75rem] text-[var(--bb-grey-2)] leading-relaxed mb-2">
              {event.reasoning}
            </div>
            {event.policy_refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {event.policy_refs.map((ref) => (
                  <span
                    key={ref}
                    className="font-[var(--font-mono)] text-[0.48rem] tracking-[0.08em] px-1.5 py-0.5 border border-[var(--bb-grey-4)] text-[var(--bb-grey-3)]"
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
