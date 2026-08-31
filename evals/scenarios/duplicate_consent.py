"""Scenario: re-using a single-use consent is rejected."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from sellable.contracts import IntentMandate, CartItem, CartMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


def run() -> dict:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)

    intent = IntentMandate(
        buyer_agent_id="eval_dup_consent",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories"],
        purpose="Eval: duplicate consent",
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

    trace_id = "eval_dup_consent_trace"
    order = core.create_order(
        cart=cart, intent=intent, trace_id=trace_id, idempotency_key="eval_dup_consent_001"
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)

    rejected = False
    try:
        core.consume_consent(consent.consent_id, order_id=order.order_id)
    except ValueError:
        rejected = True

    return {
        "passed": rejected,
        "duplicate_rejected": rejected,
    }
