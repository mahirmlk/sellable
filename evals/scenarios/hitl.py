"""Scenario: high-value cart triggers human-in-the-loop approval."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine

from sellable.contracts import CartItem, CartMandate, IntentMandate, PolicyVerdict, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


def run() -> dict:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)

    intent = IntentMandate(
        buyer_agent_id="eval_hitl",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Eval: HITL",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    cart = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="GIFT-BOX-01",
                quantity=1,
                unit_price_paise=249_900,
                offered_price_paise=249_900,
            )
        ],
        subtotal_paise=249_900,
        discount_paise=0,
        total_paise=249_900,
        negotiation_round=0,
    )

    trace_id = "eval_hitl_trace"
    products = {p.sku: p for p in core.catalog.all()}
    decision = core.policy_engine.evaluate_cart(
        cart=cart, intent=intent, policy=core.policy, products=products
    )

    return {
        "passed": decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL,
        "verdict": decision.verdict,
        "reason_code": decision.reason_code,
    }
