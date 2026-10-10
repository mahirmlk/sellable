"""UCP interoperability adapter (target §16.1, §53): standardized
merchant discovery, capability negotiation, and commerce operations.

UCP clients use the canonical /commerce/* endpoints with protocol "ucp"
(via the X-Protocol header); this adapter owns the UCP-shaped discovery
document and the negotiation handshake. Capability names follow current
UCP concepts (Cart, Checkout, Identity Linking, Order); the adapter makes
no certification claims.
"""

from __future__ import annotations

from sellable.contracts import AgentProfile
from sellable.protocols.capabilities import build_merchant_profile
from sellable.protocols.dispatch import ProtocolContext


UCP_WELL_KNOWN_PATH = "/.well-known/ucp"
UCP_VERSION = "ucp-1"


def discovery_document(core, *, base_url: str = "") -> dict[str, object]:
    """Machine-readable merchant declaration (§17.2 content)."""
    from sellable.repositories import MerchantRepository

    merchant_id = core.merchant_scope
    name = MerchantRepository().name_of(merchant_id) or merchant_id
    profile = build_merchant_profile(merchant_id)
    methods = [m.method.value for m in core.shipping_service.methods_for(merchant_id)]
    return {
        "merchant": {"id": merchant_id, "name": name},
        "ucp_version": UCP_VERSION,
        "api_versions": ["v1"],
        "base_url": base_url,
        "capabilities": [c.model_dump(mode="json") for c in profile.capabilities],
        "protocols": ["rest", "mcp", "a2a", "ucp"],
        "authentication": {
            "agent_key_header": "X-Agent-Key",
            "signed": {
                "headers": ["X-Timestamp", "X-Nonce", "X-Signature"],
                "note": "HMAC-SHA256 over timestamp.nonce.agent_id.method.path",
            },
            "delegation_header": "X-Delegation-Id",
        },
        "identity_linking": {
            "supported": True,
            "create": "/commerce/identity/link",
            "approve": "/commerce/identity/link/approve",
            "me": "/commerce/identity/me",
        },
        "payment": {
            "providers": ["razorpay-test"],
            "settlement_authority": "signed_webhook",
        },
        "shipping": {"methods": methods},
        "returns": {"endpoint": "/commerce/returns"},
        "support": {"endpoint": "/commerce/support/cases"},
    }


def negotiate(core, sessions, agent_profile: AgentProfile) -> object:
    """UCP capability handshake → negotiated session (protocol "ucp")."""
    from sellable.protocols.sessions import ProtocolSessionService

    service = (
        sessions
        if isinstance(sessions, ProtocolSessionService)
        else ProtocolSessionService(sessions)
    )
    profile = agent_profile.model_copy(update={"protocol": "ucp"})
    return service.negotiate(
        core.merchant_scope, profile, build_merchant_profile(core.merchant_scope)
    )


def ucp_context(
    *, trace_id: str, agent_id=None, session_id=None,
    delegation_id=None, customer_id=None,
) -> ProtocolContext:
    """ProtocolContext for UCP-riding calls."""
    return ProtocolContext(
        protocol="ucp",
        trace_id=trace_id,
        agent_id=agent_id,
        session_id=session_id,
        delegation_id=delegation_id,
        customer_id=customer_id,
    )
