"""Phase 2c: the canonical money path — cart → checkout → order → consent →
payment → auto-completed checkout (§40)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

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
from sellable.ledger.database import Base, CatalogProductRecord, InventoryReservationRecord
from sellable.ledger.service import LedgerRepository
from sellable.repositories import CatalogRepository, InsufficientStockError


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



def test_inventory_reservation_prevents_oversell_and_releases_aborted_order(
    commerce_core: CommerceCore,
) -> None:
    catalog_repo = CatalogRepository(engine=commerce_core.order_repo._engine)
    product = commerce_core.catalog.get("AUDIO-CASE-01")
    catalog_repo.upsert_many([product.model_copy(update={"stock": 1})])

    first_checkout = _authorized_checkout(commerce_core, _trace())
    second_checkout = _authorized_checkout(commerce_core, _trace())
    first_key = f"idem_stock_first_{uuid4().hex}"
    first_order = commerce_core.create_order_from_checkout(
        first_checkout.checkout_id,
        intent=_intent(),
        idempotency_key=first_key,
        trace_id=_trace(),
    )
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 0
    assert commerce_core.catalog.get("AUDIO-CASE-01").stock == 0

    # A retry for the same order reuses its reservation and never decrements twice.
    replay = commerce_core.create_order_from_checkout(
        first_checkout.checkout_id,
        intent=_intent(),
        idempotency_key=first_key,
        trace_id=_trace(),
    )
    assert replay.order_id == first_order.order_id
    assert commerce_core.inventory_repo.status_for_order(
        commerce_core.merchant_scope, first_order.order_id
    ) == {"AUDIO-CASE-01": "RESERVED"}

    with pytest.raises(InsufficientStockError, match="insufficient stock"):
        commerce_core.inventory_repo.reserve_for_order(
            commerce_core.merchant_scope,
            f"ord_competing_{uuid4().hex}",
            [("AUDIO-CASE-01", 1)],
        )
    with pytest.raises(ValueError, match="INSUFFICIENT_STOCK"):
        commerce_core.create_order_from_checkout(
            second_checkout.checkout_id,
            intent=_intent(),
            idempotency_key=f"idem_stock_second_{uuid4().hex}",
            trace_id=_trace(),
        )

    # An aborted order releases exactly once; the next distinct order can reserve.
    commerce_core.mark_aborted(first_order.order_id, reason="test cancellation")
    commerce_core.mark_aborted(first_order.order_id, reason="duplicate cancellation")
    available = next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    )
    assert available == 1
    assert commerce_core.catalog.get("AUDIO-CASE-01").stock == 1

    second_order = commerce_core.create_order_from_checkout(
        second_checkout.checkout_id,
        intent=_intent(),
        idempotency_key=f"idem_stock_retry_{uuid4().hex}",
        trace_id=_trace(),
    )
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 0
    consent = commerce_core.issue_consent(second_order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=second_order.order_id)
    commerce_core.mark_payment_pending(second_order.order_id)
    commerce_core.mark_payment_failed(second_order.order_id, reason="retryable test failure")
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 0
    commerce_core.mark_payment_pending(second_order.order_id)
    commerce_core.mark_paid(second_order.order_id, provider_ref="pay_stock_1")
    assert commerce_core.inventory_repo.status_for_order(
        commerce_core.merchant_scope, second_order.order_id
    ) == {"AUDIO-CASE-01": "COMMITTED"}

    # A connector refresh that still reports the pre-sale source quantity
    # must not restore locally committed stock.
    catalog_repo.upsert_many([product.model_copy(update={"stock": 1})])
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 0
    # Once the source snapshot reflects the sale, the local offset is reconciled;
    # a later restock becomes available.
    catalog_repo.upsert_many([product.model_copy(update={"stock": 0})])
    catalog_repo.upsert_many([product.model_copy(update={"stock": 1})])
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 1


def test_orphaned_reservation_is_released_after_order_insert_crash(
    commerce_core: CommerceCore,
) -> None:
    merchant_id = commerce_core.merchant_scope
    order_id = f"ord_missing_{uuid4().hex}"
    sku = "AUDIO-CASE-01"
    with Session(commerce_core.order_repo._engine) as session:
        catalog_row = session.get(CatalogProductRecord, f"{merchant_id}:{sku}")
        assert catalog_row is not None
        catalog_row.reserved_stock = 1
        session.add(
            InventoryReservationRecord(
                reservation_id="a" * 64,
                merchant_id=merchant_id,
                order_id=order_id,
                sku=sku,
                quantity=1,
                status="RESERVED",
                created_at=utc_now() - timedelta(minutes=10),
            )
        )
        session.commit()

    released = commerce_core.inventory_repo.release_orphaned_reservations(
        merchant_id, before=utc_now() - timedelta(minutes=5)
    )
    assert released == 1
    assert commerce_core.inventory_repo.status_for_order(merchant_id, order_id) == {
        sku: "RELEASED"
    }


def test_stale_consent_stage_order_releases_its_stock_hold(
    commerce_core: CommerceCore,
) -> None:
    catalog_repo = CatalogRepository(engine=commerce_core.order_repo._engine)
    product = commerce_core.catalog.get("AUDIO-CASE-01")
    catalog_repo.upsert_many([product.model_copy(update={"stock": 1})])
    authorized = _authorized_checkout(commerce_core, _trace())
    order = commerce_core.create_order_from_checkout(
        authorized.checkout_id,
        intent=_intent(),
        idempotency_key=f"idem_stock_expire_{uuid4().hex}",
        trace_id=_trace(),
    )
    stale = order.model_copy(update={"created_at": utc_now() - timedelta(minutes=16)})
    commerce_core.order_repo.save(stale)

    assert commerce_core.expire_stale_unpaid_orders() == 1
    assert commerce_core.get_order(order.order_id).status is OrderStatus.ABORTED
    assert commerce_core.inventory_repo.status_for_order(
        commerce_core.merchant_scope, order.order_id
    ) == {"AUDIO-CASE-01": "RELEASED"}
    assert next(
        p.stock
        for p in catalog_repo.list(commerce_core.merchant_scope)
        if p.sku == "AUDIO-CASE-01"
    ) == 1


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
