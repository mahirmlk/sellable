"""Canonical commerce commands (target §16.2, §17.3): every protocol —
REST, MCP, A2A, UCP — translates into these functions. Capability gating
(§15.2) and delegation authorization (§14.4) run here, once, for all
transports; business logic stays in the domain services.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sellable.delegations import AuthorizationOutcome, OperationScope


@dataclass
class ProtocolContext:
    """Per-call protocol envelope (§4.4 attribution for machine calls)."""

    protocol: str = "rest"
    trace_id: str = ""
    agent_id: str | None = None
    session_id: str | None = None
    delegation_id: str | None = None
    customer_id: str | None = None


class ProtocolError(ValueError):
    """A canonical command was refused (HTTP-mapped at the transport)."""

    def __init__(self, status_code: int, reason_code: str, detail: str = "") -> None:
        super().__init__(detail or reason_code)
        self.status_code = status_code
        self.reason_code = reason_code


def require_capability(sessions, core, ctx: ProtocolContext, capability_id: str) -> None:
    """Gate one call on the negotiated session set. Calls without a
    session (direct REST trust) skip negotiation but never skip
    delegation/authorization below."""
    if not ctx.session_id or sessions is None:
        return
    try:
        sessions.require_capability(
            ctx.session_id, core.merchant_scope, capability_id
        )
    except Exception as error:
        raise ProtocolError(403, "CAPABILITY_NOT_NEGOTIATED", str(error)) from error


def authorize_scope(core, ctx: ProtocolContext, scope: OperationScope, amount_paise=None):
    """Resolve the delegation for one command. None when no delegation is
    presented (legacy trust); DENY → 403; REQUIRE_* → 409 hold."""
    delegation_id = ctx.delegation_id
    if not delegation_id:
        return None
    decision = core.authorization_service.authorize(
        delegation_id=delegation_id,
        scope=scope,
        merchant_id=core.merchant_scope,
        amount_paise=amount_paise,
    )
    core.log_gateway_authorization(
        trace_id=ctx.trace_id, decision=decision, route=f"{ctx.protocol}.{scope.value}"
    )
    if decision.outcome is AuthorizationOutcome.DENY:
        raise ProtocolError(403, decision.reason_code)
    if decision.outcome is not AuthorizationOutcome.ALLOW:
        raise ProtocolError(409, decision.reason_code, decision.outcome.value)
    return decision


def _ctx_delegation(ctx: ProtocolContext, delegation_id=None):
    return delegation_id or ctx.delegation_id


# ------------------------------------------------------------------
# Discovery (public tiers, no delegation required).
# ------------------------------------------------------------------

def search_catalog(core, sessions, ctx: ProtocolContext, *, query: str, categories=None):
    require_capability(sessions, core, ctx, "catalog.search")
    from sellable.contracts import CatalogSearchRequest

    return core.catalog.search(query, set(categories or ()))


def lookup_product(core, sessions, ctx: ProtocolContext, *, sku: str):
    require_capability(sessions, core, ctx, "catalog.lookup")
    try:
        return core.catalog.get(sku)
    except Exception as error:
        raise ProtocolError(404, "UNKNOWN_SKU", str(error)) from error


def get_recommendations(core, sessions, ctx: ProtocolContext, *, sku: str, limit: int = 3):
    require_capability(sessions, core, ctx, "recommendations.get")
    product = lookup_product(core, sessions, ctx, sku=sku)
    # Same deterministic rule as the seller recommendations tool
    # (merchant-curated chain, then category); the recommendation engine
    # plugs in here without changing protocol semantics.
    candidates = []
    seen = {product.sku}
    upsell_sku = product.attributes.get("upsell_sku")
    if isinstance(upsell_sku, str) and upsell_sku not in seen:
        try:
            candidates.append(core.catalog.get(upsell_sku))
            seen.add(upsell_sku)
        except Exception:  # noqa: BLE001 — dangling curation never breaks discovery
            pass
    for item in core.catalog.search("", {product.category}):
        if item.sku not in seen:
            candidates.append(item)
            seen.add(item.sku)
        if len(candidates) >= max(limit, 1):
            break
    return candidates


# ------------------------------------------------------------------
# Cart and quotes.
# ------------------------------------------------------------------

def create_cart(core, sessions, ctx: ProtocolContext, *, customer_id=None):
    require_capability(sessions, core, ctx, "cart.write")
    authorize_scope(core, ctx, OperationScope.CART_WRITE)
    return core.create_cart(
        trace_id=ctx.trace_id,
        customer_id=customer_id or ctx.customer_id,
        agent_session_id=ctx.session_id or ctx.agent_id,
    )


def mutate_cart_item(
    core, sessions, ctx: ProtocolContext, *, cart_id: str, op: str,
    sku: str, quantity: int, expected_version: int,
):
    require_capability(sessions, core, ctx, "cart.write")
    authorize_scope(core, ctx, OperationScope.CART_WRITE)
    try:
        if op == "add":
            return core.cart_add_item(
                cart_id, sku, quantity,
                expected_version=expected_version, trace_id=ctx.trace_id,
            )
        if op == "set":
            return core.cart_set_quantity(
                cart_id, sku, quantity,
                expected_version=expected_version, trace_id=ctx.trace_id,
            )
        if op == "remove":
            return core.cart_remove_item(
                cart_id, sku, expected_version=expected_version, trace_id=ctx.trace_id
            )
    except Exception as error:
        raise ProtocolError(409, "CART_MUTATION_REFUSED", str(error)) from error
    raise ProtocolError(400, "UNKNOWN_CART_OP", op)


def create_quote(core, sessions, ctx: ProtocolContext, *, cart_id: str):
    require_capability(sessions, core, ctx, "quotes.create")
    authorize_scope(core, ctx, OperationScope.CART_WRITE)
    try:
        return core.create_quote(cart_id, trace_id=ctx.trace_id)
    except Exception as error:
        raise ProtocolError(409, "QUOTE_REFUSED", str(error)) from error


def negotiate_quote(
    core, sessions, ctx: ProtocolContext, *, quote_id: str, proposed_total_paise: int
):
    require_capability(sessions, core, ctx, "quotes.negotiate")
    authorize_scope(core, ctx, OperationScope.CART_WRITE)
    from sellable.contracts import QuoteNegotiationOutcome

    try:
        outcome = core.negotiate_quote(quote_id, proposed_total_paise, trace_id=ctx.trace_id)
        quote = core.quote_service.get_quote(quote_id, core.merchant_scope)
    except Exception as error:
        raise ProtocolError(409, "NEGOTIATION_REFUSED", str(error)) from error
    return {"outcome": outcome.value, "quote": quote}


def evaluate_promotions(
    core, sessions, ctx: ProtocolContext, *, cart_id=None, checkout_id=None,
    coupon_code=None, channel: str = "agent",
):
    require_capability(sessions, core, ctx, "promotions.evaluate")
    from sellable.promotions import PromotionEngine, PromotionLine

    if checkout_id is not None:
        checkout = core.checkout_service.get_checkout(checkout_id, core.merchant_scope)
        if checkout is None:
            raise ProtocolError(404, "UNKNOWN_CHECKOUT", checkout_id)
        source_lines = [
            (line.sku, line.quantity, line.unit_price_paise) for line in checkout.lines
        ]
        customer_id = checkout.customer_id
    elif cart_id is not None:
        cart = core.cart_service.get_cart(cart_id, core.merchant_scope)
        if cart is None:
            raise ProtocolError(404, "UNKNOWN_CART", cart_id)
        source_lines = [
            (line.sku, line.quantity, line.unit_price_paise) for line in cart.items
        ]
        customer_id = cart.customer_id
    else:
        raise ProtocolError(400, "CART_OR_CHECKOUT_REQUIRED", "")
    lines = [
        PromotionLine(
            sku=sku, quantity=qty, unit_price_paise=unit,
            category=core.catalog.get(sku).category,
        )
        for sku, qty, unit in source_lines
    ]
    return core.promotion_engine.evaluate(
        lines=lines,
        promotions=core.promotion_repo.active_for_merchant(core.merchant_scope),
        customer_id=customer_id,
        channel=channel,
        coupon_code=coupon_code,
        usage=core.promotion_repo.usage(core.merchant_scope),
    )


# ------------------------------------------------------------------
# Checkout and orders.
# ------------------------------------------------------------------

def create_checkout(
    core, sessions, ctx: ProtocolContext, *, cart_id: str,
    expected_version=None, delegation_id=None, quote_id=None,
):
    require_capability(sessions, core, ctx, "checkout.create")
    authorize_scope(core, ctx, OperationScope.CHECKOUT_WRITE)
    cart = core.cart_service.get_cart(cart_id, core.merchant_scope)
    if cart is None:
        raise ProtocolError(404, "UNKNOWN_CART", cart_id)
    from sellable.contracts import CartStatus

    if cart.status is CartStatus.ACTIVE:
        try:
            core.cart_start_checkout(
                cart_id,
                expected_version=expected_version or cart.version,
                trace_id=ctx.trace_id,
            )
        except Exception as error:
            raise ProtocolError(409, "CART_LOCK_REFUSED", str(error)) from error
    try:
        return core.create_checkout(
            cart_id,
            trace_id=ctx.trace_id,
            delegation_id=_ctx_delegation(ctx, delegation_id),
            quote_id=quote_id,
        )
    except Exception as error:
        raise ProtocolError(409, "CHECKOUT_REFUSED", str(error)) from error


def authorize_checkout_pipeline(
    core, sessions, ctx: ProtocolContext, *, checkout_id: str,
    coupon_code=None, channel: str = "agent",
    tax_total_paise: int = 0, shipping_total_paise: int = 0,
    merchant_state=None, customer_state=None,
    shipping_method=None, pincode: str = "",
):
    """Drive validate → price → authorize in one canonical call (§17.3).
    Tax/shipping apply deterministically when a destination is supplied."""
    require_capability(sessions, core, ctx, "checkout.authorize")
    authorize_scope(core, ctx, OperationScope.CHECKOUT_WRITE)
    try:
        core.checkout_validate(checkout_id, trace_id=ctx.trace_id)
        core.checkout_price(
            checkout_id,
            trace_id=ctx.trace_id,
            coupon_code=coupon_code,
            channel=channel,
            tax_total_paise=tax_total_paise,
            shipping_total_paise=shipping_total_paise,
        )
        if pincode or merchant_state or customer_state:
            from sellable.contracts import ShippingMethod as _Method

            method = _Method(shipping_method) if shipping_method else _Method.STANDARD
            core.checkout_apply_tax_shipping(
                checkout_id,
                trace_id=ctx.trace_id,
                merchant_state=merchant_state,
                customer_state=customer_state,
                method=method,
                pincode=pincode,
            )
        return core.checkout_authorize(checkout_id, trace_id=ctx.trace_id)
    except ProtocolError:
        raise
    except Exception as error:
        raise ProtocolError(409, "CHECKOUT_AUTHORIZE_REFUSED", str(error)) from error


def create_order(
    core, sessions, ctx: ProtocolContext, *, checkout_id: str,
    intent, idempotency_key: str, delegation_id=None,
):
    require_capability(sessions, core, ctx, "orders.create")
    try:
        return core.create_order_from_checkout(
            checkout_id,
            intent=intent,
            idempotency_key=idempotency_key,
            delegation_id=_ctx_delegation(ctx, delegation_id),
            trace_id=ctx.trace_id,
        )
    except Exception as error:
        raise ProtocolError(409, "ORDER_REFUSED", str(error)) from error


def get_order(core, sessions, ctx: ProtocolContext, *, order_id: str):
    require_capability(sessions, core, ctx, "orders.read")
    authorize_scope(core, ctx, OperationScope.ORDER_READ)
    try:
        order = core.get_order(order_id)
    except Exception as error:
        raise ProtocolError(404, "UNKNOWN_ORDER", str(error)) from error
    return {
        "order_id": order.order_id,
        "status": order.status.value,
        "amount_paise": order.amount_paise,
        "trace_id": order.trace_id,
        "payment_id": core.ledger.last_provider_ref(order.trace_id, action="order.paid"),
    }


def shipping_quote(
    core, sessions, ctx: ProtocolContext, *, pincode: str, free_shipping: bool = False
):
    require_capability(sessions, core, ctx, "shipping.read")
    return core.shipping_service.quote(
        core.merchant_scope, pincode, free_shipping=free_shipping
    )


# ------------------------------------------------------------------
# Post-purchase.
# ------------------------------------------------------------------

def create_return(
    core, sessions, ctx: ProtocolContext, *, order_id: str,
    items: list, reason: str, customer_id=None,
):
    require_capability(sessions, core, ctx, "returns.create")
    authorize_scope(core, ctx, OperationScope.RETURN_CREATE)
    try:
        return core.request_return(
            order_id, items, reason,
            trace_id=ctx.trace_id, customer_id=customer_id or ctx.customer_id,
        )
    except Exception as error:
        raise ProtocolError(409, "RETURN_REFUSED", str(error)) from error


def request_refund(
    core, sessions, ctx: ProtocolContext, *, order_id: str,
    amount_paise: int, reason: str, return_id=None,
):
    require_capability(sessions, core, ctx, "refunds.request")
    authorize_scope(core, ctx, OperationScope.REFUND_REQUEST, amount_paise=amount_paise)
    try:
        return core.request_refund(
            order_id, amount_paise, reason, trace_id=ctx.trace_id, return_id=return_id
        )
    except Exception as error:
        raise ProtocolError(409, "REFUND_REQUEST_REFUSED", str(error)) from error


def create_support_case(
    core, sessions, ctx: ProtocolContext, *, summary: str,
    order_id=None, category: str = "other",
):
    require_capability(sessions, core, ctx, "support.create")
    authorize_scope(core, ctx, OperationScope.SUPPORT_CREATE)
    from sellable.contracts import SupportCategory

    try:
        return core.case_service.open_case(
            core.merchant_scope, summary,
            customer_id=ctx.customer_id, order_id=order_id,
            category=SupportCategory(category),
            context={"opened_via": ctx.protocol},
        )
    except Exception as error:
        raise ProtocolError(409, "CASE_REFUSED", str(error)) from error


# Field metadata for cross-referencing (kept beside the dispatcher).
COMMAND_CAPABILITIES = {
    "search_catalog": "catalog.search",
    "lookup_product": "catalog.lookup",
    "get_recommendations": "recommendations.get",
    "create_cart": "cart.write",
    "mutate_cart_item": "cart.write",
    "create_quote": "quotes.create",
    "negotiate_quote": "quotes.negotiate",
    "evaluate_promotions": "promotions.evaluate",
    "create_checkout": "checkout.create",
    "authorize_checkout_pipeline": "checkout.authorize",
    "create_order": "orders.create",
    "get_order": "orders.read",
    "shipping_quote": "shipping.read",
    "create_return": "returns.create",
    "request_refund": "refunds.request",
    "create_support_case": "support.create",
}
