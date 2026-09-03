"""Safety-invariant tests for the SELLABLE trust layer.

These tests mirror the fixture patterns in tests/unit/test_payments.py (fake
Razorpay payment-link client + in-memory sqlite commerce core) and prove the
hard guardrails that must hold regardless of agent behaviour:

Consent rails
- Expired consent blocks payment; the order stays AWAITING_CONSENT.
- A consumed consent can never be reused by a fresh service instance.
- start_payment is idempotent for the same order.
- Consents bound to a wrong amount, wrong payee, or an unknown id are rejected.

Webhook rails
- An unknown provider payment link mutates nothing (status + ledger).
- Duplicate payment_link.paid and duplicate payment.captured (via the
  provider's internal order id) are idempotent: exactly one order.paid and
  one webhook.reconciled.
- An amount-mismatched webhook neither settles nor burns the delivery key;
  a later correct capture settles.

Policy rails
- Over-budget carts are denied and never persisted (OVER_BUDGET).
- Below-floor offers are countered at a policy-valid price, never below the
  floor; a below-floor cart is denied (BELOW_FLOOR_PRICE) and not persisted.
- Orders above the human-approval threshold hold consent until approve_order.
- An idempotency key cannot be reused for a different transaction.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.agents.seller import SellerAction, SellerAgent, SellerRequest
from sellable.consent import ConsentValidationError
from sellable.contracts import (
    CartItem,
    CartMandate,
    Consent,
    ConsentStatus,
    IntentMandate,
    OrderStatus,
    PaymentStatus,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments.service import PaymentService, UnknownProviderOrderError
from sellable.payments.razorpay import RazorpayAdapter

from test_payments import (
    razorpay_adapter,
    payment_link_paid_payload,
    razorpay_adapter,
    signed_webhook,
)


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def buyer_intent(budget_ceiling_paise: int = 200_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_safety_test",
        budget_ceiling_paise=budget_ceiling_paise,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Safety invariant test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def travel_case_cart(offered_price_paise: int = 69_900) -> CartMandate:
    return CartMandate(
        intent_ref="im_safety",
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
        negotiation_round=0,
    )


def gift_box_cart() -> CartMandate:
    return CartMandate(
        intent_ref="im_safety_gift",
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


def create_order(
    core: CommerceCore,
    cart: CartMandate,
    intent: IntentMandate,
    *,
    trace_id: str,
    idempotency_key: str,
):
    return core.create_order(
        cart=cart, intent=intent, trace_id=trace_id, idempotency_key=idempotency_key
    )


def ledger_actions(core: CommerceCore, trace_id: str) -> list[str]:
    return [event.action for event in core.ledger.for_trace(trace_id)]


def payment_captured_via_internal_order_payload(
    payment_id: str = "pay_capture_01",
) -> dict[str, object]:
    """payment.captured referencing the fake link's internal Razorpay order id."""
    return {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "order_id": "order_razorpay_test_01",
                    "status": "captured",
                    "amount": 69_900,
                }
            }
        },
    }


def payment_link_paid_with_amount(
    reference_id: str, amount_paise: int, payment_id: str = "pay_link_01"
) -> dict[str, object]:
    return {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_test_0001",
                    "reference_id": reference_id,
                    "status": "paid",
                }
            },
            "payment": {
                "entity": {
                    "id": payment_id,
                    "amount": amount_paise,
                    "status": "captured",
                }
            },
        },
    }


# ---------------------------------------------------------------------------
# Consent rails
# ---------------------------------------------------------------------------


def test_expired_consent_blocks_payment_and_order_stays_awaiting_consent(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_expired",
        idempotency_key="idem_safety_expired_01",
    )
    consent = commerce_core.issue_consent(order.order_id)

    # Force expiry by tampering the stored consent's expires_at to the past.
    expired = consent.model_copy(update={"expires_at": utc_now() - timedelta(minutes=1)})
    commerce_core.consent_service._consents[consent.consent_id] = expired

    payments = PaymentService(commerce_core, razorpay_adapter())
    with pytest.raises(ConsentValidationError, match="expired"):
        payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.AWAITING_CONSENT
    assert (
        commerce_core.consent_service._consents[consent.consent_id].status
        is ConsentStatus.EXPIRED
    )


def test_reused_consent_is_rejected_and_start_payment_is_idempotent(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_reuse",
        idempotency_key="idem_safety_reuse_01",
    )
    consent = commerce_core.issue_consent(order.order_id)
    payments = PaymentService(commerce_core, razorpay_adapter())

    first = payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    second = payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    assert second == first
    assert second.status is PaymentStatus.PAYMENT_PENDING

    # The consent is single-use: a fresh service (no cached attempt) cannot
    # consume it a second time.
    stored = commerce_core.consent_service._consents[consent.consent_id]
    assert stored.status is ConsentStatus.USED
    fresh = PaymentService(commerce_core, razorpay_adapter())
    with pytest.raises(ConsentValidationError, match="not available"):
        fresh.start_payment(order_id=order.order_id, consent_id=consent.consent_id)


def test_consent_bound_to_wrong_amount_is_rejected(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_amount",
        idempotency_key="idem_safety_amount_01",
    )
    raw = Consent(
        order_id=order.order_id,
        amount_paise=order.amount_paise + 1,
        payee_id=order.merchant_id,
        purpose="single_transaction",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    commerce_core.consent_service.issue(raw)

    with pytest.raises(ConsentValidationError, match="not bound"):
        commerce_core.consume_consent(raw.consent_id, order_id=order.order_id)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.AWAITING_CONSENT


def test_consent_bound_to_wrong_payee_is_rejected(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_payee",
        idempotency_key="idem_safety_payee_01",
    )
    raw = Consent(
        order_id=order.order_id,
        amount_paise=order.amount_paise,
        payee_id="mrc_someone_else",
        purpose="single_transaction",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    commerce_core.consent_service.issue(raw)

    with pytest.raises(ConsentValidationError, match="not bound"):
        commerce_core.consume_consent(raw.consent_id, order_id=order.order_id)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.AWAITING_CONSENT


def test_unknown_consent_id_blocks_payment(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_unknown_consent",
        idempotency_key="idem_safety_unknown_01",
    )
    payments = PaymentService(commerce_core, razorpay_adapter())

    with pytest.raises(ConsentValidationError, match="does not exist"):
        payments.start_payment(order_id=order.order_id, consent_id="con_missing")

    assert commerce_core.get_order(order.order_id).status is OrderStatus.AWAITING_CONSENT


# ---------------------------------------------------------------------------
# Webhook rails
# ---------------------------------------------------------------------------


def test_webhook_for_unknown_payment_link_mutates_nothing(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_unknown_plink",
        idempotency_key="idem_safety_plink_01",
    )
    consent = commerce_core.issue_consent(order.order_id)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    unknown = {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_unknown_9999",
                    "reference_id": "ord_unknown_9999",
                    "status": "paid",
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_unknown_01",
                    "amount": 69_900,
                    "status": "captured",
                }
            },
        },
    }
    body, signature = signed_webhook(unknown)
    actions_before = ledger_actions(commerce_core, order.trace_id)

    with pytest.raises(UnknownProviderOrderError):
        payments.handle_webhook(body, signature)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING
    assert ledger_actions(commerce_core, order.trace_id) == actions_before


def test_duplicate_payment_link_paid_is_idempotent(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_dup_link",
        idempotency_key="idem_safety_duplink_1",
    )
    consent = commerce_core.issue_consent(order.order_id)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    body, signature = signed_webhook(payment_link_paid_payload(reference_id=order.order_id))
    settled = payments.handle_webhook(body, signature)
    duplicate = payments.handle_webhook(body, signature)

    assert settled.status is PaymentStatus.CAPTURED
    assert duplicate == settled
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    actions = ledger_actions(commerce_core, order.trace_id)
    assert actions.count("order.paid") == 1
    assert actions.count("webhook.reconciled") == 1


def test_duplicate_payment_captured_via_internal_order_id_is_idempotent(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_dup_capture",
        idempotency_key="idem_safety_dupcap_01",
    )
    consent = commerce_core.issue_consent(order.order_id)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    body, signature = signed_webhook(payment_captured_via_internal_order_payload())
    settled = payments.handle_webhook(body, signature)
    duplicate = payments.handle_webhook(body, signature)

    assert settled.status is PaymentStatus.CAPTURED
    assert duplicate == settled
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    actions = ledger_actions(commerce_core, order.trace_id)
    assert actions.count("order.paid") == 1
    assert actions.count("webhook.reconciled") == 1


def test_webhook_amount_mismatch_does_not_burn_the_delivery_key(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_mismatch",
        idempotency_key="idem_safety_mismatch_1",
    )
    consent = commerce_core.issue_consent(order.order_id)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    mismatch_body, mismatch_signature = signed_webhook(
        payment_link_paid_with_amount(
            reference_id=order.order_id, amount_paise=69_999, payment_id="pay_late_01"
        )
    )
    result = payments.handle_webhook(mismatch_body, mismatch_signature)

    assert result.status is PaymentStatus.PAYMENT_PENDING
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING
    assert "webhook.amount_mismatch" in ledger_actions(commerce_core, order.trace_id)

    # The same payment id captured for the correct amount settles later: the
    # mismatched delivery did not burn the delivery key.
    correct_body, correct_signature = signed_webhook(
        payment_link_paid_with_amount(
            reference_id=order.order_id, amount_paise=69_900, payment_id="pay_late_01"
        )
    )
    settled = payments.handle_webhook(correct_body, correct_signature)

    assert settled.status is PaymentStatus.CAPTURED
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    actions = ledger_actions(commerce_core, order.trace_id)
    assert actions.count("order.paid") == 1
    assert actions.count("webhook.amount_mismatch") == 1


# ---------------------------------------------------------------------------
# Policy rails
# ---------------------------------------------------------------------------


def test_over_budget_cart_is_denied_and_not_persisted(commerce_core: CommerceCore) -> None:
    intent = buyer_intent(budget_ceiling_paise=60_000)
    cart = travel_case_cart()

    with pytest.raises(ValueError, match="OVER_BUDGET"):
        create_order(
            commerce_core,
            cart,
            intent,
            trace_id="trc_safety_overbudget",
            idempotency_key="idem_safety_overbudg_1",
        )

    assert commerce_core.all_orders() == []
    assert commerce_core.get_order_by_idempotency_key("idem_safety_overbudg_1") is None


def test_seller_tool_counters_below_floor_and_never_quotes_under_it(
    commerce_core: CommerceCore,
) -> None:
    """AUDIO-CASE-01: list 69900, floor 59900, max discount 10% -> 62910."""
    agent = SellerAgent(commerce_core)
    result = agent.respond(
        SellerRequest(
            message="I need a headphone travel case",
            intent=buyer_intent(),
            buyer_offer_paise=59_000,
            request_upsell=False,
        )
    )

    assert result.action is SellerAction.COUNTERED
    assert result.cart is not None
    offered = result.cart.items[0].offered_price_paise
    assert offered == 62_910
    assert offered >= commerce_core.catalog.get("AUDIO-CASE-01").floor_paise
    # A countered quote is not yet an order.
    assert commerce_core.all_orders() == []


def test_below_floor_cart_is_denied_and_not_persisted(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    cart = travel_case_cart(offered_price_paise=50_000)

    with pytest.raises(ValueError, match="BELOW_FLOOR_PRICE"):
        create_order(
            commerce_core,
            cart,
            intent,
            trace_id="trc_safety_belowfloor",
            idempotency_key="idem_safety_belowfl_1",
        )

    assert commerce_core.all_orders() == []
    assert commerce_core.get_order_by_idempotency_key("idem_safety_belowfl_1") is None


def test_high_value_order_holds_consent_until_merchant_approval(
    commerce_core: CommerceCore,
) -> None:
    """GIFT-BOX-01 at 249900 >= 200000 threshold: consent is gated by HITL."""
    intent = buyer_intent(budget_ceiling_paise=300_000)
    order = create_order(
        commerce_core,
        gift_box_cart(),
        intent,
        trace_id="trc_safety_hitl",
        idempotency_key="idem_safety_hitl_001",
    )

    assert order.requires_approval is True
    with pytest.raises(ValueError, match="merchant approval"):
        commerce_core.issue_consent(order.order_id)

    approved = commerce_core.approve_order(order.order_id)
    assert approved.requires_approval is False
    consent = commerce_core.issue_consent(order.order_id)
    assert consent.order_id == order.order_id

    payments = PaymentService(commerce_core, razorpay_adapter())
    started = payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    assert started.status is PaymentStatus.PAYMENT_PENDING


def test_idempotency_key_reuse_with_different_cart_is_rejected(
    commerce_core: CommerceCore,
) -> None:
    intent = buyer_intent()
    first = create_order(
        commerce_core,
        travel_case_cart(),
        intent,
        trace_id="trc_safety_reuse_guard",
        idempotency_key="idem_safety_reuseg_01",
    )
    coffee_cart = CartMandate(
        intent_ref="im_safety_coffee",
        items=[
            CartItem(
                sku="SNACK-COFFEE-01",
                quantity=1,
                unit_price_paise=84_900,
                offered_price_paise=84_900,
            )
        ],
        subtotal_paise=84_900,
        discount_paise=0,
        total_paise=84_900,
        negotiation_round=0,
    )

    with pytest.raises(ValueError, match="Idempotency key"):
        create_order(
            commerce_core,
            coffee_cart,
            intent,
            trace_id="trc_safety_reuse_guard",
            idempotency_key="idem_safety_reuseg_01",
        )

    # The original order is untouched and no duplicate was created.
    assert commerce_core.get_order(first.order_id).amount_paise == 69_900
    assert len(commerce_core.all_orders()) == 1

# ---------------------------------------------------------------------------
# Restart-proof webhook settlement (spec §12 — audit trail after payment)
# ---------------------------------------------------------------------------


def test_webhook_settlement_survives_process_restart(commerce_core: CommerceCore) -> None:
    """A Razorpay webhook must settle the order even when the process that
    created the payment link is gone (deploy/restart) — provider refs are
    persisted on the order row and the correct merchant core is rebuilt."""
    cart = travel_case_cart()
    intent = buyer_intent()
    order = create_order(
        commerce_core,
        cart,
        intent,
        trace_id="trc_restart_proof",
        idempotency_key="idem_restart_proof_0001",
    )
    consent = commerce_core.issue_consent(order.order_id)

    service = PaymentService(commerce_core, razorpay_adapter())
    attempt = service.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    assert attempt.payment_url is not None

    # Simulate a process restart: brand-new service instance with EMPTY
    # in-memory maps, resolving cores through the registry-style resolver.
    def resolver(merchant_id: str) -> CommerceCore:
        assert merchant_id == commerce_core.policy.merchant_id
        return commerce_core

    restarted = PaymentService(commerce_core, razorpay_adapter(), core_resolver=resolver)

    body, signature = signed_webhook(
        payment_link_paid_payload(
            reference_id=order.order_id,
            payment_id="pay_restart_0001",
        )
    )
    settled = restarted.handle_webhook(body, signature)
    assert settled.status is PaymentStatus.CAPTURED
    assert settled.provider_payment_id == "pay_restart_0001"
    paid = commerce_core.get_order(order.order_id)
    assert paid.status is OrderStatus.PAID
    actions = ledger_actions(commerce_core, order.trace_id)
    assert actions.count("order.paid") == 1
    assert "webhook.reconciled" in actions
