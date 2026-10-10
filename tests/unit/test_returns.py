"""Phase 2c: returns/exchanges/refund asks (§26 seed) through core delegates."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import (
    CartItem,
    CartMandate,
    ExchangeStatus,
    IntentMandate,
    OrderStatus,
    RefundRequestStatus,
    ReturnStatus,
    ShippingMethod,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.returns import ReturnError


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


def _paid_order(core: CommerceCore, amount: int = 69_900):
    intent = IntentMandate(
        buyer_agent_id="buyer_returns",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="returns test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=amount,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=69_900 - amount,
        total_paise=amount,
        negotiation_round=0,
    )
    order = core.create_order(
        cart=mandate, intent=intent, trace_id=_trace(),
        idempotency_key=f"idem_ret_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    return core.mark_paid(order.order_id, provider_ref="pay_ret_1")


def _return_items() -> list[dict[str, object]]:
    return [{"sku": "AUDIO-CASE-01", "quantity": 1}]


def test_return_full_lifecycle_with_fulfillment_mirror(
    commerce_core: CommerceCore,
) -> None:
    trace_id = _trace()
    order = _paid_order(commerce_core)
    fulfillment = commerce_core.create_fulfillment(
        order.order_id, ShippingMethod.STANDARD, trace_id=trace_id
    )
    commerce_core.ship_fulfillment(fulfillment.fulfillment_id, trace_id=trace_id)

    case = commerce_core.request_return(
        order.order_id, _return_items(), "defective", trace_id=trace_id
    )
    assert case.status == ReturnStatus.REQUESTED
    approved = commerce_core.decide_return(case.return_id, approve=True, trace_id=trace_id)
    assert approved.status == ReturnStatus.APPROVED
    received = commerce_core.receive_return(case.return_id, trace_id=trace_id)
    assert received.status == ReturnStatus.RECEIVED
    completed = commerce_core.complete_return(case.return_id, trace_id=trace_id)
    assert completed.status == ReturnStatus.COMPLETED

    mirrored = commerce_core.fulfillment_service.get(
        fulfillment.fulfillment_id, commerce_core.merchant_scope
    )
    assert mirrored.status.value == "RETURNED"

    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    for expected in (
        "fulfillment.created",
        "return.requested",
        "return.approved",
        "return.received",
        "return.completed",
    ):
        assert expected in actions


def test_return_rejected_and_gated(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    order = _paid_order(commerce_core)
    case = commerce_core.request_return(
        order.order_id, _return_items(), "changed mind", trace_id=trace_id
    )
    rejected = commerce_core.decide_return(case.return_id, approve=False, trace_id=trace_id)
    assert rejected.status == ReturnStatus.REJECTED
    with pytest.raises(ReturnError):
        commerce_core.receive_return(case.return_id, trace_id=trace_id)

    # Unpaid orders cannot be returned.
    from sellable.contracts import CartItem as _CI, CartMandate as _CM, IntentMandate as _IM

    intent = _IM(
        buyer_agent_id="b",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="x",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = _CM(
        intent_ref=intent.mandate_id,
        items=[_CI(sku="AUDIO-CASE-01", quantity=1, unit_price_paise=69_900, offered_price_paise=69_900)],
        subtotal_paise=69_900,
        discount_paise=0,
        total_paise=69_900,
        negotiation_round=0,
    )
    unpaid = commerce_core.create_order(
        cart=mandate, intent=intent, trace_id=_trace(),
        idempotency_key=f"idem_unpaid_{uuid4().hex}",
    )
    assert unpaid.status == OrderStatus.AWAITING_CONSENT
    with pytest.raises(ReturnError, match="settled order"):
        commerce_core.request_return(
            unpaid.order_id, _return_items(), "too early", trace_id=trace_id
        )


def test_exchange_flow(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    order = _paid_order(commerce_core)
    case = commerce_core.request_return(
        order.order_id, _return_items(), "wrong size", trace_id=trace_id
    )
    commerce_core.decide_return(case.return_id, approve=True, trace_id=trace_id)
    exchange = commerce_core.request_exchange(
        case.return_id, "GIFT-BOX-01", 1, trace_id=trace_id
    )
    assert exchange.status == ExchangeStatus.REQUESTED
    decided = commerce_core.decide_exchange(exchange.exchange_id, approve=True, trace_id=trace_id)
    assert decided.status == ExchangeStatus.APPROVED
    fulfilled = commerce_core.fulfill_exchange(exchange.exchange_id, trace_id=trace_id)
    assert fulfilled.status == ExchangeStatus.FULFILLED


def test_refund_ask_gate(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    order = _paid_order(commerce_core)
    with pytest.raises(ReturnError, match="within the order total"):
        commerce_core.request_refund(
            order.order_id, order.amount_paise + 1, "too much", trace_id=trace_id
        )
    ask = commerce_core.request_refund(
        order.order_id, order.amount_paise, "defective", trace_id=trace_id
    )
    assert ask.status == RefundRequestStatus.PENDING
    approved = commerce_core.decide_refund(
        ask.refund_request_id, approve=True, decided_by="merchant_owner", trace_id=trace_id
    )
    assert approved.status == RefundRequestStatus.APPROVED
    settled = commerce_core.return_service.settle_refund(
        ask.refund_request_id, commerce_core.merchant_scope, provider_ref="rfnd_1"
    )
    assert settled.status == RefundRequestStatus.SETTLED
    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert "refund.requested" in actions
    assert "refund_request.approved" in actions
