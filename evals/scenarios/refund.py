"""Scenario: paid order refunds through the provider rail; unpaid orders are refused."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine

from sellable.contracts import CartItem, CartMandate, IntentMandate, OrderStatus, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments.razorpay import ProviderRefund
from sellable.refunds import RefundService
from sellable.repositories import RefundRepository

ORDER_TOTAL = 69_900


class _StubRefundRail:
    """Test-mode refund rail stand-in: records calls, settles immediately."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def refund(
        self, payment_id: str, amount_paise: int, *, notes: dict[str, str] | None = None
    ) -> ProviderRefund:
        self.calls.append((payment_id, amount_paise))
        return ProviderRefund(
            provider_refund_id=f"rfnd_eval_{len(self.calls):04d}",
            provider_payment_id=payment_id,
            amount_paise=amount_paise,
            currency="INR",
            status="processed",
        )


def _intent(buyer_agent_id: str) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id=buyer_agent_id,
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories"],
        purpose="Eval: refund",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _cart(intent: IntentMandate) -> CartMandate:
    return CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=ORDER_TOTAL,
                offered_price_paise=ORDER_TOTAL,
            )
        ],
        subtotal_paise=ORDER_TOTAL,
        discount_paise=0,
        total_paise=ORDER_TOTAL,
        negotiation_round=0,
    )


def run() -> dict:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    rail = _StubRefundRail()
    refunds = RefundService(core, rail, RefundRepository(engine))  # type: ignore[arg-type]

    # An unpaid order must be refused (mirrors test_refund_requires_paid_order).
    unpaid_intent = _intent("eval_refund_unpaid")
    unpaid = core.create_order(
        cart=_cart(unpaid_intent),
        intent=unpaid_intent,
        trace_id="eval_refund_unpaid_trace",
        idempotency_key="eval_refund_unpaid_001",
    )
    try:
        refunds.initiate_refund(order_id=unpaid.order_id, reason="eval unpaid refund")
        unpaid_refused = False
    except ValueError as exc:
        unpaid_refused = "PAID or FULFILLED" in str(exc)

    # Settle a paid order, then refund it in full through the rail.
    intent = _intent("eval_refund")
    order = core.create_order(
        cart=_cart(intent),
        intent=intent,
        trace_id="eval_refund_trace",
        idempotency_key="eval_refund_paid_0001",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_eval_refund_001")

    result = refunds.initiate_refund(order_id=order.order_id, reason="eval full refund")
    settled = core.get_order(order.order_id)
    actions = [e.action for e in core.ledger.for_trace("eval_refund_trace")]

    return {
        "passed": unpaid_refused
        and len(rail.calls) == 1
        and rail.calls[0] == ("pay_eval_refund_001", ORDER_TOTAL)
        and result["refund_status"] == "processed"
        and settled.status is OrderStatus.REFUNDED
        and "refund.settled" in actions,
        "unpaid_refused": unpaid_refused,
        "rail_calls": rail.calls,
        "refund_status": result["refund_status"],
        "order_status": settled.status,
        "settled_in_ledger": "refund.settled" in actions,
    }
