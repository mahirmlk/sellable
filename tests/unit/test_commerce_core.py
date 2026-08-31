from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine

from sellable.contracts import CartItem, CartMandate, IntentMandate, OrderStatus, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def valid_intent() -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_demo",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy a desk accessory",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def travel_case_cart(offered_price_paise: int = 69_900) -> CartMandate:
    return CartMandate(
        intent_ref="im_demo",
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=offered_price_paise,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=69_900 - offered_price_paise,
        total_paise=offered_price_paise,
        negotiation_round=1,
    )


def test_valid_cart_creates_consumable_consent_and_full_ledger_trace(
    commerce_core: CommerceCore,
) -> None:
    trace_id = f"trc_{uuid4().hex}"
    order = commerce_core.create_order(
        cart=travel_case_cart(),
        intent=valid_intent(),
        trace_id=trace_id,
        idempotency_key="idem_valid_purchase_0001",
    )
    consent = commerce_core.issue_consent(order.order_id)
    updated_order = commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)

    assert updated_order.status is OrderStatus.CONSENTED
    assert [event.action for event in commerce_core.ledger.for_trace(trace_id)] == [
        "quote.received",
        "policy.checked",
        "order.created",
        "consent.issued",
        "consent.used",
    ]


def test_below_floor_offer_cannot_create_an_order(commerce_core: CommerceCore) -> None:
    with pytest.raises(ValueError, match="BELOW_FLOOR_PRICE"):
        commerce_core.create_order(
            cart=travel_case_cart(offered_price_paise=59_800),
            intent=valid_intent(),
            trace_id=f"trc_{uuid4().hex}",
            idempotency_key="idem_below_floor_0001",
        )


def test_duplicate_consent_is_rejected(commerce_core: CommerceCore) -> None:
    order = commerce_core.create_order(
        cart=travel_case_cart(),
        intent=valid_intent(),
        trace_id=f"trc_{uuid4().hex}",
        idempotency_key="idem_duplicate_consent_01",
    )
    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)

    with pytest.raises(ValueError, match="not available"):
        commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)


def test_idempotent_order_creation_returns_the_original_order(commerce_core: CommerceCore) -> None:
    trace_id = f"trc_{uuid4().hex}"
    first = commerce_core.create_order(
        cart=travel_case_cart(),
        intent=valid_intent(),
        trace_id=trace_id,
        idempotency_key="idem_single_transaction_01",
    )
    second = commerce_core.create_order(
        cart=travel_case_cart(),
        intent=valid_intent(),
        trace_id=trace_id,
        idempotency_key="idem_single_transaction_01",
    )

    assert second.order_id == first.order_id
