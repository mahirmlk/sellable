"""Scenario: buyer offer below merchant floor price is denied."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from sellable.contracts import CartItem, CartMandate, IntentMandate, PolicyVerdict, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.policy import PolicyEngine


def run() -> dict:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)

    intent = IntentMandate(
        buyer_agent_id="eval_below_floor",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories"],
        purpose="Eval: below floor",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    cart = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=40_000,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=29_900,
        total_paise=40_000,
        negotiation_round=1,
    )

    trace_id = "eval_below_floor_trace"
    products = {p.sku: p for p in core.catalog.all()}
    decision = core.policy_engine.evaluate_cart(
        cart=cart, intent=intent, policy=core.policy, products=products
    )

    return {
        "passed": decision.verdict is PolicyVerdict.DENY and decision.reason_code == "BELOW_FLOOR_PRICE",
        "verdict": decision.verdict,
        "reason_code": decision.reason_code,
    }
