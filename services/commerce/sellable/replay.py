"""Transaction replay (target §28.3): reconstruct the evidence chain for
one trace — request → agent run → retrieval → tools → cart → promotions →
policy → risk → authorization → payment → webhook → order → support —
from ledger rows. Reads evidence only; it never re-executes money actions.
"""

from __future__ import annotations


# Ordered sections with the action prefixes that belong to each.
SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("agent", ("seller.", "buyer.", "customer_service.")),
    ("retrieval", ("catalog.",)),
    ("recommendations", ("recommendations.",)),
    ("cart", ("cart.", "quote.", "negotiation.", "upsell.")),
    ("promotions", ("promotion.",)),
    ("policy", ("policy.",)),
    ("risk", ("risk.",)),
    ("authorization", ("authorization.", "consent.")),
    ("payment", ("payment.", "order.paid", "refund.")),
    ("webhook", ("webhook.",)),
    ("order", ("order.",)),
    ("fulfillment", ("fulfillment.", "shipping.")),
    ("support", ("support.", "return.", "exchange.", "service.")),
    ("platform", ("connector.", "onboarding.", "escalation.", "agent.run.")),
)


def _section_for(action: str) -> str:
    if action.startswith("checkout."):
        return "cart"
    for name, prefixes in SECTIONS:
        if any(action == prefix.rstrip(".") or action.startswith(prefix) for prefix in prefixes):
            return name
    return "agent"


def build_replay(trace_id: str, merchant_id: str, *, ledger) -> dict[str, object]:
    """Assemble the replay chain for one trace, merchant-scoped."""
    events = ledger.for_trace(trace_id, merchant_id=merchant_id)
    sections: dict[str, list[dict[str, object]]] = {}
    order_id = None
    for event in events:
        action = event.action
        name = _section_for(action)
        outputs = event.output_json or {}
        if action == "order.created" and order_id is None:
            order_id = outputs.get("order_id")
        sections.setdefault(name, []).append(
            {
                "action": action,
                "actor": event.actor,
                "summary": event.reasoning_summary,
                "policies": list(event.policy_refs_json or []),
                "outcome": event.outcome_effect_json,
                "at": event.timestamp.isoformat()
                if hasattr(event.timestamp, "isoformat")
                else str(event.timestamp),
            }
        )
    ordered = [
        {"section": name, "events": sections[name]}
        for name, _ in SECTIONS
        if name in sections
    ]
    leftovers = [name for name in sections if name not in dict(SECTIONS)]
    for name in leftovers:
        ordered.append({"section": name, "events": sections[name]})
    return {
        "trace_id": trace_id,
        "merchant_id": merchant_id,
        "order_id": order_id,
        "sections": ordered,
        "event_count": len(events),
    }
