"""Capability discovery and negotiation (target §15).

A merchant publishes a capability profile; an external agent presents its
own profile; the platform intersects them (server-selects versions, UCP
style) into a negotiated session capability set. No capability is ever
assumed from the global registry — only the session set authorizes calls.
"""

from __future__ import annotations

from sellable.contracts import (
    AgentProfile,
    Capability,
    CapabilityStatus,
    MerchantCapabilityProfile,
)


#: Canonical capability ids → (endpoint, required scopes).
CAPABILITY_CATALOG: dict[str, tuple[str, list[str]]] = {
    "catalog.search": ("/commerce/search", ["search:read"]),
    "catalog.lookup": ("/commerce/catalog/lookup", ["catalog:read"]),
    "recommendations.get": ("/commerce/recommendations", ["recommendation:read"]),
    "cart.write": ("/commerce/cart", ["cart:write"]),
    "quotes.create": ("/commerce/quotes", ["cart:write"]),
    "quotes.negotiate": ("/commerce/quotes/negotiate", ["cart:write"]),
    "promotions.evaluate": ("/commerce/promotions/evaluate", ["recommendation:read"]),
    "checkout.create": ("/commerce/checkout", ["checkout:write"]),
    "checkout.authorize": ("/commerce/checkout/authorize", ["checkout:write"]),
    "orders.create": ("/commerce/orders", ["checkout:write"]),
    "orders.read": ("/commerce/orders/{id}", ["order:read"]),
    "shipping.read": ("/commerce/shipping/quote", ["shipping:read"]),
    "returns.create": ("/commerce/returns", ["return:create"]),
    "refunds.request": ("/commerce/refunds/requests", ["refund:request"]),
    "support.create": ("/commerce/support/cases", ["support:create"]),
    "identity.link": ("/commerce/identity/link", []),
    "payments.info": ("/commerce/payments", ["order:read"]),
    "webhooks.info": ("/commerce/webhooks", ["order:read"]),
}

PROTOCOL_VERSION = "1"
SUPPORTED_PROTOCOLS = ("rest", "mcp", "a2a", "ucp")


def build_merchant_profile(merchant_id: str) -> MerchantCapabilityProfile:
    """Deterministic merchant profile: every canonical capability is
    ACTIVE in v1 (merchant-level gating arrives with the console controls
    in Phase 6; the shape is stable now)."""
    return MerchantCapabilityProfile(
        merchant_id=merchant_id,
        protocol_version=PROTOCOL_VERSION,
        capabilities=[
            Capability(
                capability_id=capability_id,
                version="1",
                transport="rest",
                endpoint=endpoint,
                required_scopes=list(scopes),
                auth_mode="agent_key",
                status=CapabilityStatus.ACTIVE,
            )
            for capability_id, (endpoint, scopes) in CAPABILITY_CATALOG.items()
        ],
        protocols=list(SUPPORTED_PROTOCOLS),
    )


def negotiate(
    merchant_profile: MerchantCapabilityProfile, agent_profile: AgentProfile
) -> list[str]:
    """Intersect agent-declared capabilities with merchant ACTIVE ones.
    Server selects versions (all v1): the returned ids are the session set,
    sorted for determinism. Unknown or inactive ids never intersect."""
    merchant_active = {
        capability.capability_id
        for capability in merchant_profile.capabilities
        if capability.status is CapabilityStatus.ACTIVE
    }
    return sorted(set(agent_profile.capabilities) & merchant_active)
