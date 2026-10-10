"""MCP-compatible tool surface (target §16.1): safe, typed commerce tools
for compatible agent runtimes, backed 1:1 by canonical commands.

Presented as an HTTP/JSON bridge (tool list + call), not a certified MCP
transport — the tool schemas and capability gating are the
interoperability contract.
"""

from __future__ import annotations

from sellable.protocols import dispatch
from sellable.protocols.dispatch import ProtocolContext, ProtocolError


def _intent_of(intent: object):
    """Accept an IntentMandate or its JSON form (MCP transports JSON)."""
    from sellable.contracts import IntentMandate

    if isinstance(intent, IntentMandate):
        return intent
    try:
        return IntentMandate.model_validate(intent)
    except Exception as error:
        raise ProtocolError(400, "INVALID_INTENT", str(error)) from error


def list_tools() -> list[dict[str, object]]:
    """MCP-style tool definitions (name, description, input schema)."""
    str_field = {"type": "string"}
    int_field = {"type": "integer"}
    return [
        {
            "name": "catalog_search",
            "description": "Search the merchant catalog (service-backed, never LLM memory).",
            "inputSchema": {
                "type": "object",
                "properties": {"query": str_field, "categories": {"type": "array", "items": str_field}},
                "required": ["query"],
            },
        },
        {
            "name": "catalog_lookup",
            "description": "Fetch one product by SKU.",
            "inputSchema": {
                "type": "object",
                "properties": {"sku": str_field},
                "required": ["sku"],
            },
        },
        {
            "name": "recommendations_get",
            "description": "Deterministic recommendations for a SKU.",
            "inputSchema": {
                "type": "object",
                "properties": {"sku": str_field, "limit": int_field},
                "required": ["sku"],
            },
        },
        {
            "name": "cart_create",
            "description": "Open a persistent, versioned cart.",
            "inputSchema": {
                "type": "object",
                "properties": {"customer_id": str_field},
            },
        },
        {
            "name": "cart_mutate",
            "description": "Add, set, or remove a cart line (op, sku, quantity, expected_version).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cart_id": str_field,
                    "op": str_field,
                    "sku": str_field,
                    "quantity": int_field,
                    "expected_version": int_field,
                },
                "required": ["cart_id", "op", "sku", "quantity", "expected_version"],
            },
        },
        {
            "name": "quote_create",
            "description": "Snapshot a bounded commercial offer from a cart.",
            "inputSchema": {
                "type": "object",
                "properties": {"cart_id": str_field},
                "required": ["cart_id"],
            },
        },
        {
            "name": "quote_negotiate",
            "description": "Propose a total within merchant bounds (floor/rounds enforced).",
            "inputSchema": {
                "type": "object",
                "properties": {"quote_id": str_field, "proposed_total_paise": int_field},
                "required": ["quote_id", "proposed_total_paise"],
            },
        },
        {
            "name": "promotions_evaluate",
            "description": "Evaluate eligible promotions over a cart or checkout.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cart_id": str_field,
                    "checkout_id": str_field,
                    "coupon_code": str_field,
                    "channel": str_field,
                },
            },
        },
        {
            "name": "checkout_create",
            "description": "Open a checkout from a locked cart.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cart_id": str_field,
                    "expected_version": int_field,
                    "delegation_id": str_field,
                    "quote_id": str_field,
                },
                "required": ["cart_id"],
            },
        },
        {
            "name": "checkout_authorize",
            "description": "Validate, price, and authorize a checkout (risk-gated).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "checkout_id": str_field,
                    "coupon_code": str_field,
                    "channel": str_field,
                    "merchant_state": str_field,
                    "customer_state": str_field,
                    "shipping_method": str_field,
                    "pincode": str_field,
                },
                "required": ["checkout_id"],
            },
        },
        {
            "name": "order_create",
            "description": "Create an order from an authorized checkout (idempotent).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "checkout_id": str_field,
                    "intent": {"type": "object"},
                    "idempotency_key": str_field,
                    "delegation_id": str_field,
                },
                "required": ["checkout_id", "intent", "idempotency_key"],
            },
        },
        {
            "name": "order_read",
            "description": "Read authoritative order state.",
            "inputSchema": {
                "type": "object",
                "properties": {"order_id": str_field},
                "required": ["order_id"],
            },
        },
        {
            "name": "return_create",
            "description": "Open a return case on a settled order.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "order_id": str_field,
                    "items": {"type": "array", "items": {"type": "object"}},
                    "reason": str_field,
                    "customer_id": str_field,
                },
                "required": ["order_id", "items", "reason"],
            },
        },
        {
            "name": "refund_request",
            "description": "Open a merchant-gated refund ask (never executes).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "order_id": str_field,
                    "amount_paise": int_field,
                    "reason": str_field,
                    "return_id": str_field,
                },
                "required": ["order_id", "amount_paise", "reason"],
            },
        },
        {
            "name": "support_create",
            "description": "Open a customer-service case.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "summary": str_field,
                    "order_id": str_field,
                    "category": str_field,
                },
                "required": ["summary"],
            },
        },
    ]


_TOOL_FN = {
    "catalog_search": lambda core, sessions, ctx, a: dispatch.search_catalog(
        core, sessions, ctx, query=a.get("query", ""),
        categories=a.get("categories"),
    ),
    "catalog_lookup": lambda core, sessions, ctx, a: dispatch.lookup_product(
        core, sessions, ctx, sku=a["sku"]
    ),
    "recommendations_get": lambda core, sessions, ctx, a: dispatch.get_recommendations(
        core, sessions, ctx, sku=a["sku"], limit=int(a.get("limit") or 3)
    ),
    "cart_create": lambda core, sessions, ctx, a: dispatch.create_cart(
        core, sessions, ctx, customer_id=a.get("customer_id")
    ),
    "cart_mutate": lambda core, sessions, ctx, a: dispatch.mutate_cart_item(
        core, sessions, ctx, cart_id=a["cart_id"], op=a["op"], sku=a["sku"],
        quantity=int(a["quantity"]), expected_version=int(a["expected_version"]),
    ),
    "quote_create": lambda core, sessions, ctx, a: dispatch.create_quote(
        core, sessions, ctx, cart_id=a["cart_id"]
    ),
    "quote_negotiate": lambda core, sessions, ctx, a: dispatch.negotiate_quote(
        core, sessions, ctx, quote_id=a["quote_id"],
        proposed_total_paise=int(a["proposed_total_paise"]),
    ),
    "promotions_evaluate": lambda core, sessions, ctx, a: dispatch.evaluate_promotions(
        core, sessions, ctx, cart_id=a.get("cart_id"),
        checkout_id=a.get("checkout_id"), coupon_code=a.get("coupon_code"),
        channel=a.get("channel") or "agent",
    ),
    "checkout_create": lambda core, sessions, ctx, a: dispatch.create_checkout(
        core, sessions, ctx, cart_id=a["cart_id"],
        expected_version=a.get("expected_version"),
        delegation_id=a.get("delegation_id"), quote_id=a.get("quote_id"),
    ),
    "checkout_authorize": lambda core, sessions, ctx, a: dispatch.authorize_checkout_pipeline(
        core, sessions, ctx, checkout_id=a["checkout_id"],
        coupon_code=a.get("coupon_code"), channel=a.get("channel") or "agent",
        merchant_state=a.get("merchant_state"), customer_state=a.get("customer_state"),
        shipping_method=a.get("shipping_method"), pincode=a.get("pincode") or "",
    ),
    "order_create": lambda core, sessions, ctx, a: dispatch.create_order(
        core, sessions, ctx, checkout_id=a["checkout_id"],
        intent=_intent_of(a["intent"]), idempotency_key=a["idempotency_key"],
        delegation_id=a.get("delegation_id"),
    ),
    "order_read": lambda core, sessions, ctx, a: dispatch.get_order(
        core, sessions, ctx, order_id=a["order_id"]
    ),
    "return_create": lambda core, sessions, ctx, a: dispatch.create_return(
        core, sessions, ctx, order_id=a["order_id"], items=a["items"],
        reason=a["reason"], customer_id=a.get("customer_id"),
    ),
    "refund_request": lambda core, sessions, ctx, a: dispatch.request_refund(
        core, sessions, ctx, order_id=a["order_id"],
        amount_paise=int(a["amount_paise"]), reason=a["reason"],
        return_id=a.get("return_id"),
    ),
    "support_create": lambda core, sessions, ctx, a: dispatch.create_support_case(
        core, sessions, ctx, summary=a["summary"],
        order_id=a.get("order_id"), category=a.get("category") or "other",
    ),
}


def call_tool(core, sessions, ctx: ProtocolContext, *, tool: str, arguments: dict):
    """Invoke one MCP tool through canonical dispatch (§16.2)."""
    fn = _TOOL_FN.get(tool)
    if fn is None:
        raise ProtocolError(404, "UNKNOWN_TOOL", tool)
    return fn(core, sessions, ctx, arguments or {})
