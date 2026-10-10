"""Phase 2c: the canonical money path — cart → checkout → order → consent →
payment → auto-completed checkout (§40)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import (
    CheckoutStatus,
    IntentMandate,
    OrderStatus,
    Promotion,
    PromotionType,
    ShippingMethod,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


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


def _intent(budget: int = 200_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_new_path",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="canonical path test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _authorized_checkout(core: CommerceCore, trace_id: str, **price_kwargs):
    cart = core.create_cart(trace_id=trace_id)
    cart = core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    checkout = core.create_checkout(cart.cart_id, trace_id=trace_id)
    core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    core.checkout_price(checkout.checkout_id, trace_id=trace_id, **price_kwargs)
    return core.checkout_authorize(checkout.checkout_id, trace_id=trace_id)


def test_canonical_path_with_tax_and_shipping(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id)
    cart = commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = commerce_core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    commerce_core.checkout_price(checkout.checkout_id, trace_id=trace_id)

    taxed = commerce_core.checkout_apply_tax_shipping(
        checkout.checkout_id,
        trace_id=trace_id,
        merchant_state="KA",
        customer_state="KA",
        method=ShippingMethod.STANDARD,
        pincode="560001",
    )
    # 69_900 + 18% GST (6_291 + 6_291) + standard shipping 4_900.
    assert taxed.tax_total_paise == 12_582
    assert taxed.shipping_total_paise == 4_900
    assert taxed.grand_total_paise == 69_900 + 12_582 + 4_900
    reauthorized = commerce_core.checkout_authorize(taxed.checkout_id, trace_id=trace_id)
    assert reauthorized.status == CheckoutStatus.AUTHORIZED

    order = commerce_core.create_order_from_checkout(
        reauthorized.checkout_id,
        intent=_intent(),
        idempotency_key=f"idem_canon_{uuid4().hex}",
        trace_id=trace_id,
    )
    assert order.amount_paise == taxed.grand_total_paise
    assert order.status == OrderStatus.AWAITING_CONSENT
    assert not order.requires_approval

    linked = commerce_core.checkout_service.get_checkout(
        reauthorized.checkout_id, commerce_core.merchant_scope
    )
    assert linked.status == CheckoutStatus.PAYMENT_PENDING
    assert linked.order_id == order.order_id

    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    paid = commerce_core.mark_paid(order.order_id, provider_ref="pay_canon_1")
    assert paid.status == OrderStatus.PAID

    completed = commerce_core.checkout_service.get_checkout(
        reauthorized.checkout_id, commerce_core.merchant_scope
    )
    assert completed.status == CheckoutStatus.COMPLETED
    assert completed.order_id == order.order_id

    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    for expected in (
        "cart.created",
        "checkout.created",
        "checkout.validated",
        "checkout.priced",
        "checkout.tax_shipping_applied",
        "checkout.authorized",
        "order.created",
        "order.paid",
        "checkout.completed",
    ):
        assert expected in actions


def test_order_from_checkout_promotion_redeemed_on_payment(
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
    authorized = _authorized_checkout(commerce_core, trace_id)
    assert authorized.grand_total_paise == 64_900

    order = commerce_core.create_order_from_checkout(
        authorized.checkout_id,
        intent=_intent(),
        idempotency_key=f"idem_promopath_{uuid4().hex}",
        trace_id=trace_id,
    )
    assert order.amount_paise == 64_900
    assert (
        commerce_core.promotion_repo.usage(commerce_core.merchant_scope).get(
            promotion.promotion_id, {"count": 0}
        )["count"]
        == 0
    )
    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    commerce_core.mark_paid(order.order_id, provider_ref="pay_promo_1")
    usage = commerce_core.promotion_repo.usage(commerce_core.merchant_scope)
    assert usage[promotion.promotion_id]["count"] == 1
    assert usage[promotion.promotion_id]["discount_paise"] == 5_000


def test_order_from_checkout_gates(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id)
    cart = commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = commerce_core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)

    # Not authorized yet.
    with pytest.raises(ValueError, match="AUTHORIZED checkout"):
        commerce_core.create_order_from_checkout(
            checkout.checkout_id,
            intent=_intent(),
            idempotency_key=f"idem_gate_{uuid4().hex}",
            trace_id=trace_id,
        )

    commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    commerce_core.checkout_price(checkout.checkout_id, trace_id=trace_id)
    authorized = commerce_core.checkout_authorize(checkout.checkout_id, trace_id=trace_id)

    # Grand total above the buyer budget is denied, nothing persisted.
    key = f"idem_gate2_{uuid4().hex}"
    with pytest.raises(ValueError, match="OVER_BUDGET"):
        commerce_core.create_order_from_checkout(
            authorized.checkout_id,
            intent=_intent(budget=1_000),
            idempotency_key=key,
            trace_id=trace_id,
        )
    assert commerce_core.order_repo.for_idempotency_key(
        commerce_core.merchant_scope, key
    ) is None

    # Replay with the same key and same total returns the same order.
    good_key = f"idem_gate3_{uuid4().hex}"
    first = commerce_core.create_order_from_checkout(
        authorized.checkout_id,
        intent=_intent(),
        idempotency_key=good_key,
        trace_id=trace_id,
    )
    second = commerce_core.create_order_from_checkout(
        authorized.checkout_id,
        intent=_intent(),
        idempotency_key=good_key,
        trace_id=trace_id,
    )
    assert first.order_id == second.order_id


def test_legacy_orders_do_not_touch_checkouts(commerce_core: CommerceCore) -> None:
    # The pre-checkout flow keeps working with zero checkout side effects.
    from sellable.contracts import CartItem, CartMandate

    intent = _intent()
    mandate = CartMandate(
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
        cart=mandate, intent=intent, trace_id=_trace(),
        idempotency_key=f"idem_legacy_{uuid4().hex}",
    )
    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    commerce_core.mark_paid(order.order_id, provider_ref="pay_legacy_1")
    assert (
        commerce_core.checkout_repo.for_order(order.order_id, commerce_core.merchant_scope)
        is None
    )
