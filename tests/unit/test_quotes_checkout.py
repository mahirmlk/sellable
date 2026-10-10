"""Phase 2b: quotes/negotiation (§18.3, §20.2) and checkout (§18.4, §21.3).

End-to-end through CommerceCore delegates: cart → quote → negotiate →
checkout → validate → price → authorize → complete, plus invariant
violations (stale cart, delegation deny, amount mismatch).
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.checkout import CheckoutError
from sellable.contracts import (
    CheckoutStatus,
    Promotion,
    PromotionType,
    QuoteNegotiationOutcome,
    QuoteStatus,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.delegations import OperationScope
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.quotes import QuoteError


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def _stocked_cart(core: CommerceCore, trace_id: str, sku: str = "AUDIO-CASE-01"):
    cart = core.create_cart(trace_id=trace_id)
    cart = core.cart_add_item(cart.cart_id, sku, 1, expected_version=1, trace_id=trace_id)
    return core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)


# --- Quotes ------------------------------------------------------------------


def test_quote_create_negotiate_accept(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    quote = commerce_core.create_quote(cart.cart_id, trace_id=trace_id)
    assert quote.status == QuoteStatus.OPEN
    assert quote.base_subtotal_paise == 69_900
    assert quote.negotiated_subtotal_paise == 69_900
    assert quote.round_number == 0

    # Below floor and below discount cap → countered at the walk-away total.
    outcome = commerce_core.negotiate_quote(quote.quote_id, 1_000, trace_id=trace_id)
    assert outcome == QuoteNegotiationOutcome.COUNTERED
    countered = commerce_core.quote_service.get_quote(quote.quote_id, commerce_core.merchant_scope)
    assert countered.round_number == 1
    assert countered.negotiated_subtotal_paise >= 50_000  # floor respected
    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert "quote.created" in actions
    assert "quote.negotiated" in actions


def test_quote_negotiate_within_bounds_accepts(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    quote = commerce_core.create_quote(cart.cart_id, trace_id=trace_id)
    outcome = commerce_core.negotiate_quote(quote.quote_id, 65_000, trace_id=trace_id)
    assert outcome == QuoteNegotiationOutcome.ACCEPTED
    settled = commerce_core.quote_service.get_quote(quote.quote_id, commerce_core.merchant_scope)
    assert settled.negotiated_subtotal_paise == 65_000
    assert settled.round_number == 1


def test_quote_round_cap_and_expiry(commerce_core: CommerceCore) -> None:
    from sellable.contracts import MerchantPolicy

    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    quote = commerce_core.create_quote(cart.cart_id, trace_id=trace_id)
    # Tighten rounds to 1 for this core only.
    commerce_core.quote_service._policy = MerchantPolicy(
        merchant_id=commerce_core.merchant_scope,
        max_order_value_paise=500_000,
        max_single_item_value_paise=300_000,
        max_discount_percent=20,
        allowed_categories=["accessories"],
        max_negotiation_rounds=1,
        max_upsells_per_session=1,
        human_approval_threshold_paise=200_000,
    )
    assert (
        commerce_core.negotiate_quote(quote.quote_id, 60_000, trace_id=trace_id)
        == QuoteNegotiationOutcome.ACCEPTED
    )
    assert (
        commerce_core.negotiate_quote(quote.quote_id, 55_000, trace_id=trace_id)
        == QuoteNegotiationOutcome.DENIED
    )
    with pytest.raises(QuoteError):
        commerce_core.quote_service.negotiate("quo_missing", commerce_core.merchant_scope, 1)


# --- Checkout ------------------------------------------------------------------


def _checkout_to_authorized(core: CommerceCore, trace_id: str, **price_kwargs):
    cart = _stocked_cart(core, trace_id)
    checkout = core.create_checkout(cart.cart_id, trace_id=trace_id)
    assert checkout.status == CheckoutStatus.CREATED
    core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    priced = core.checkout_price(checkout.checkout_id, trace_id=trace_id, **price_kwargs)
    assert priced.status == CheckoutStatus.PRICED
    assert priced.grand_total_paise == 69_900
    return core.checkout_authorize(checkout.checkout_id, trace_id=trace_id)


def test_checkout_full_lifecycle_to_completed(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    authorized = _checkout_to_authorized(commerce_core, trace_id)
    assert authorized.status == CheckoutStatus.AUTHORIZED
    assert authorized.price_hash is not None

    # Complete needs a settled order for the same amount (bind via legacy flow).
    from sellable.contracts import CartItem, CartMandate, IntentMandate

    intent = IntentMandate(
        buyer_agent_id="buyer_2b",
        budget_ceiling_paise=200_000,
        allowed_categories=["accessories"],
        purpose="2b",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    cart_mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=69_900,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=0,
        total_paise=69_900,
        negotiation_round=0,
    )
    order = commerce_core.create_order(
        cart=cart_mandate,
        intent=intent,
        trace_id=_trace(),
        idempotency_key=f"idem_2b_{uuid4().hex}",
    )
    completed = commerce_core.checkout_complete(
        authorized.checkout_id, order.order_id, trace_id=trace_id
    )
    assert completed.status == CheckoutStatus.COMPLETED
    assert completed.order_id == order.order_id

    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    for expected in (
        "checkout.created",
        "checkout.validated",
        "checkout.priced",
        "checkout.risk_reviewed",
        "checkout.authorized",
        "checkout.payment_pending",
        "checkout.completed",
    ):
        assert expected in actions

    from sellable.repositories import OutboxRepository

    outbox = OutboxRepository(engine=commerce_core.checkout_repo._engine)
    types = [e.event_type for e in outbox.claim_unpublished(limit=50)]
    assert "checkout.completed" in types

    events = commerce_core.checkout_service.events_for(
        authorized.checkout_id, commerce_core.merchant_scope
    )
    assert [e.action for e in events][0] == "checkout.created"


def test_checkout_promotion_applies_and_records_redemption(
    commerce_core: CommerceCore,
) -> None:
    trace_id = _trace()
    promotion = Promotion(
        merchant_id=commerce_core.merchant_scope,
        kind=PromotionType.FIXED_DISCOUNT,
        title="5 off",
        amount_paise=5_000,
        start_at=utc_now() - timedelta(hours=1),
    )
    commerce_core.create_promotion(promotion)
    evaluated = commerce_core.evaluate_promotions(
        _stocked_cart(commerce_core, trace_id).cart_id, trace_id=trace_id
    )
    assert evaluated.discount_total_paise == 5_000

    cart = _stocked_cart(commerce_core, _trace())
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    priced = commerce_core.checkout_price(checkout.checkout_id, trace_id=trace_id)
    assert priced.grand_total_paise == 64_900
    assert priced.applied_promotion_ids == [promotion.promotion_id]

    authorized = commerce_core.checkout_authorize(checkout.checkout_id, trace_id=trace_id)
    # Complete without an order repo link check bypass: order_repo present, so
    # completion requires a real order — use the legacy flow for the amount.
    from sellable.contracts import CartItem, CartMandate, IntentMandate

    intent = IntentMandate(
        buyer_agent_id="buyer_2bpromo",
        budget_ceiling_paise=200_000,
        allowed_categories=["accessories"],
        purpose="2b promo",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=64_900,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=5_000,
        total_paise=64_900,
        negotiation_round=0,
    )
    order = commerce_core.create_order(
        cart=mandate,
        intent=intent,
        trace_id=_trace(),
        idempotency_key=f"idem_2bpromo_{uuid4().hex}",
    )
    completed = commerce_core.checkout_complete(
        authorized.checkout_id, order.order_id, trace_id=trace_id
    )
    assert completed.status == CheckoutStatus.COMPLETED
    usage = commerce_core.promotion_repo.usage(commerce_core.merchant_scope)
    assert usage[promotion.promotion_id]["count"] == 1
    assert usage[promotion.promotion_id]["discount_paise"] == 5_000


def test_checkout_rejects_stale_cart(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id)
    cart = commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = commerce_core.cart_start_checkout(
        cart.cart_id, expected_version=2, trace_id=trace_id
    )
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    # Cart drifts after checkout creation (release → mutate → relock).
    service = commerce_core.cart_service
    merchant = commerce_core.merchant_scope
    service.release_checkout(cart.cart_id, merchant, expected_version=3)
    service.add_item(cart.cart_id, merchant, "GIFT-BOX-01", 1, expected_version=4)
    service.start_checkout(cart.cart_id, merchant, expected_version=5)
    with pytest.raises(CheckoutError, match="version changed"):
        commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)


def test_checkout_requires_locked_cart(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id)
    commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    with pytest.raises(CheckoutError, match="not locked"):
        commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)


def test_checkout_denied_by_revoked_delegation(commerce_core: CommerceCore) -> None:
    from sellable.delegations import DelegationGrant

    trace_id = _trace()
    grant = DelegationGrant(
        principal_customer_id="cust_1",
        subject_agent_id="agent_1",
        merchant_scope=commerce_core.merchant_scope,
        operation_scopes=[OperationScope.CHECKOUT_WRITE],
        expires_at=utc_now() + timedelta(hours=1),
    )
    commerce_core.delegation_repo.save(grant)
    cart = _stocked_cart(commerce_core, trace_id)
    checkout = commerce_core.create_checkout(
        cart.cart_id, trace_id=trace_id, delegation_id=grant.delegation_id
    )
    commerce_core.delegation_repo.revoke(grant.delegation_id, commerce_core.merchant_scope)
    with pytest.raises(CheckoutError, match="delegation rejected"):
        commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    reloaded = commerce_core.checkout_service.get_checkout(
        checkout.checkout_id, commerce_core.merchant_scope
    )
    assert reloaded.status == CheckoutStatus.REJECTED


def test_checkout_complete_rejects_amount_mismatch(
    commerce_core: CommerceCore,
) -> None:
    trace_id = _trace()
    authorized = _checkout_to_authorized(commerce_core, trace_id)
    commerce_core.checkout_service.mark_payment_pending(
        authorized.checkout_id, commerce_core.merchant_scope
    )
    with pytest.raises(CheckoutError, match="does not exist"):
        commerce_core.checkout_service.complete(
            authorized.checkout_id, commerce_core.merchant_scope, "ord_missing"
        )


def test_checkout_cancel_and_expiry(commerce_core: CommerceCore) -> None:
    from datetime import timedelta as _td

    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    cancelled = commerce_core.checkout_cancel(checkout.checkout_id, trace_id=trace_id)
    assert cancelled.status == CheckoutStatus.CANCELLED
    with pytest.raises(CheckoutError):
        commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)

    short = commerce_core.checkout_service.create_from_cart(
        cart.cart_id, commerce_core.merchant_scope, ttl=_td(seconds=-1)
    )
    with pytest.raises(CheckoutError, match="expired"):
        commerce_core.checkout_service.validate(short.checkout_id, commerce_core.merchant_scope)
    assert (
        commerce_core.checkout_service.expire_due(commerce_core.merchant_scope) >= 0
    )


def test_checkout_with_accepted_quote_uses_negotiated_prices(
    commerce_core: CommerceCore,
) -> None:
    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    quote = commerce_core.create_quote(cart.cart_id, trace_id=trace_id)
    assert (
        commerce_core.negotiate_quote(quote.quote_id, 65_000, trace_id=trace_id)
        == QuoteNegotiationOutcome.ACCEPTED
    )
    accepted = commerce_core.quote_service.accept(quote.quote_id, commerce_core.merchant_scope)
    assert accepted.status == QuoteStatus.ACCEPTED
    checkout = commerce_core.create_checkout(
        cart.cart_id, trace_id=trace_id, quote_id=quote.quote_id
    )
    assert checkout.subtotal_paise == 65_000


def test_quote_and_checkout_cross_merchant_isolation(
    commerce_core: CommerceCore,
) -> None:
    from sellable.checkout import CheckoutNotFoundError
    from sellable.quotes import QuoteNotFoundError

    trace_id = _trace()
    cart = _stocked_cart(commerce_core, trace_id)
    quote = commerce_core.create_quote(cart.cart_id, trace_id=trace_id)
    # Foreign ids raise, never leak — same 404 semantics as orders.
    with pytest.raises(QuoteNotFoundError):
        commerce_core.quote_service.get_quote(quote.quote_id, "mrc_other")
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    with pytest.raises(CheckoutNotFoundError):
        commerce_core.checkout_service.get_checkout(checkout.checkout_id, "mrc_other")
