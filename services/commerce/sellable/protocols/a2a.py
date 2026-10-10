"""A2A-compatible agent surface (target §16.1): the Seller and Customer
Service agents addressable as interoperable actors. Presented as a
task-based bridge, not a certified A2A transport — actor routing and the
guarded tool layer are the interoperability contract.
"""

from __future__ import annotations

from sellable.protocols.dispatch import ProtocolContext, ProtocolError


SELLER_ACTOR = "seller"
SERVICE_ACTOR = "service"


def agent_card(merchant_id: str, merchant_name: str) -> dict[str, object]:
    """A2A-style agent card for the merchant's two platform agents."""
    return {
        "name": f"{merchant_name} commerce agents",
        "merchant_id": merchant_id,
        "actors": [
            {
                "actor": SELLER_ACTOR,
                "description": (
                    "Merchant selling agent: discovery, quotes, negotiation, "
                    "promotions, and checkout assistance. Never touches money."
                ),
                "input": "seller_task {message, intent, requested_sku?, quantity?, "
                "buyer_offer_paise?, coupon_code?}",
            },
            {
                "actor": SERVICE_ACTOR,
                "description": (
                    "Merchant service agent: order help, shipping, returns, "
                    "exchanges, bounded refund asks, escalation. "
                    "Never executes refunds."
                ),
                "input": "service_task {message, customer_id?, order_id?, "
                "action_hint?, items?, amount_paise?, reason?}",
            },
        ],
    }


def handle_task(
    seller_agent,
    service_agent,
    ctx: ProtocolContext,
    *,
    actor: str,
    input: dict,
) -> dict[str, object]:
    """Route one A2A task to the addressed platform agent (§16.2: the
    adapters translate; the agents and commerce core execute)."""
    if actor == SELLER_ACTOR:
        from agents.seller.agent import SellerRequest
        from sellable.contracts import IntentMandate

        try:
            request = SellerRequest(
                message=input["message"],
                intent=IntentMandate.model_validate(input["intent"]),
                requested_sku=input.get("requested_sku"),
                quantity=int(input.get("quantity") or 1),
                buyer_offer_paise=input.get("buyer_offer_paise"),
                coupon_code=input.get("coupon_code"),
            )
        except Exception as error:
            raise ProtocolError(400, "INVALID_SELLER_TASK", str(error)) from error
        decision = seller_agent.respond(request, trace_id=ctx.trace_id or None)
        return {"actor": actor, "decision": decision.model_dump(mode="json")}
    if actor == SERVICE_ACTOR:
        from agents.customer_service.agent import CSRequest

        try:
            request = CSRequest.model_validate(input)
        except Exception as error:
            raise ProtocolError(400, "INVALID_SERVICE_TASK", str(error)) from error
        decision = service_agent.respond(request, trace_id=ctx.trace_id or None)
        return {"actor": actor, "decision": decision.model_dump(mode="json")}
    raise ProtocolError(404, "UNKNOWN_ACTOR", actor)
