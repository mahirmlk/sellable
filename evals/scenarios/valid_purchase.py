"""Scenario: valid purchase within policy, budget, and stock limits."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine

from sellable.contracts import OrderStatus, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


def run() -> dict:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)

    from sellable.contracts import IntentMandate, CartItem, CartMandate

    intent = IntentMandate(
        buyer_agent_id="eval_valid_purchase",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Eval: valid purchase",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    cart = CartMandate(
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

    trace_id = "eval_valid_purchase_trace"
    order = core.create_order(cart=cart, intent=intent, trace_id=trace_id, idempotency_key="eval_valid_purchase_001")
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_eval_001")

    events = core.ledger.for_trace(trace_id)
    actions = [e.action for e in events]

    return {
        "passed": core.get_order(order.order_id).status is OrderStatus.PAID and "order.paid" in actions,
        "order_status": core.get_order(order.order_id).status,
        "event_count": len(events),
        "events": actions,
    }
