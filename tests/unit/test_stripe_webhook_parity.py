"""Stripe webhook parity tests (UPDATE.md §8-§9, Milestone E).

The Stripe rail settles through the same orchestrated boundary as Razorpay:
HMAC-verified webhooks, tenant-aware resolution, persisted idempotent
delivery claims, exact amount matching, strict state-machine settlement,
and auditable ledger rows. These tests mirror the Razorpay hardening
coverage in test_payment_webhook_hardening.py for the Stripe event shape.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    OrderStatus,
    PaymentStatus,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments.service import (
    PaymentService,
    UnexpectedOrderStateError,
    UnknownProviderOrderError,
)
from sellable.payments.stripe import (
    InvalidStripeSignatureError,
    StripeAdapter,
)
from test_payments import razorpay_adapter


ORDER_TOTAL = 69_900


def stripe_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        stripe_secret_key="sk_test_123",
        stripe_webhook_secret="whsec_123",
    )


def stripe_adapter() -> StripeAdapter:
    return StripeAdapter(stripe_settings())


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def create_pending_order(core: CommerceCore, key: str):
    intent = IntentMandate(
        buyer_agent_id="buyer_stripe_test",
        budget_ceiling_paise=100_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Stripe parity purchase",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    cart = CartMandate(
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
    order = core.create_order(
        cart=cart,
        intent=intent,
        trace_id="trc_stripe_test",
        idempotency_key=key,
    )
    consent = core.issue_consent(order.order_id)
    payments = PaymentService(core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    return order, payments


def sign(body: bytes, secret: str = "whsec_123") -> str:
    timestamp = int(time.time())
    digest = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.{body.decode('utf-8')}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"t={timestamp},v1={digest}"


def succeeded_payload(order_id: str, *, payment_id="pi_stripe_01", amount=ORDER_TOTAL):
    return {
        "id": "evt_stripe_01",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": payment_id,
                "amount_received": amount,
                "metadata": {"local_order_id": order_id},
            }
        },
    }


def failed_payload(order_id: str, *, payment_id="pi_stripe_02", reason="Card declined in test mode"):
    return {
        "id": "evt_stripe_02",
        "type": "payment_intent.payment_failed",
        "data": {
            "object": {
                "id": payment_id,
                "amount": ORDER_TOTAL,
                "metadata": {"local_order_id": order_id},
                "last_payment_error": {"message": reason},
            }
        },
    }


def signed(payload: dict) -> tuple[bytes, str]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return body, sign(body)


def ledger_actions(core: CommerceCore, trace_id: str) -> list[str]:
    return [r.action for r in core.ledger.for_trace(trace_id)]


def ledger_events(core: CommerceCore, trace_id: str):
    return list(core.ledger.for_trace(trace_id))


def test_verified_stripe_webhook_settles_and_is_idempotent(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0001")
    body, signature = signed(succeeded_payload(order.order_id))
    settled = payments.handle_stripe_webhook(body, signature, stripe_adapter=stripe_adapter())
    duplicate = payments.handle_stripe_webhook(body, signature, stripe_adapter=stripe_adapter())
    assert settled is not None and settled.status is PaymentStatus.CAPTURED
    assert duplicate is not None and duplicate.status is PaymentStatus.CAPTURED
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    assert ledger_actions(commerce_core, order.trace_id).count("webhook.reconciled") == 1


def test_invalid_stripe_signature_cannot_settle(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0002")
    body, _ = signed(succeeded_payload(order.order_id))
    with pytest.raises(InvalidStripeSignatureError):
        payments.handle_stripe_webhook(body, "t=1,v1=bad", stripe_adapter=stripe_adapter())
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING


def test_stripe_amount_mismatch_does_not_burn_delivery_key(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0003")
    adapter = stripe_adapter()
    bad_body, bad_sig = signed(succeeded_payload(order.order_id, amount=ORDER_TOTAL - 100))
    result = payments.handle_stripe_webhook(bad_body, bad_sig, stripe_adapter=adapter)
    assert result is not None and result.status is PaymentStatus.PAYMENT_PENDING
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING
    assert "webhook.amount_mismatch" in ledger_actions(commerce_core, order.trace_id)

    good_body, good_sig = signed(succeeded_payload(order.order_id))
    settled = payments.handle_stripe_webhook(good_body, good_sig, stripe_adapter=adapter)
    assert settled is not None and settled.status is PaymentStatus.CAPTURED
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID


def test_stripe_failure_is_explicit(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0004")
    body, signature = signed(failed_payload(order.order_id))
    result = payments.handle_stripe_webhook(body, signature, stripe_adapter=stripe_adapter())
    assert result is not None and result.status is PaymentStatus.FAILED
    assert result.failure_reason == "Card declined in test mode"
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED


def test_stripe_webhook_for_unknown_order_settles_nothing(commerce_core):
    payments = PaymentService(commerce_core, razorpay_adapter())
    body, signature = signed(succeeded_payload("ord_missing"))
    with pytest.raises(UnknownProviderOrderError):
        payments.handle_stripe_webhook(body, signature, stripe_adapter=stripe_adapter())


def test_stripe_success_after_failure_is_a_409_not_a_settlement(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0005")
    adapter = stripe_adapter()
    fail_body, fail_sig = signed(failed_payload(order.order_id))
    payments.handle_stripe_webhook(fail_body, fail_sig, stripe_adapter=adapter)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED

    late_body, late_sig = signed(succeeded_payload(order.order_id))
    with pytest.raises(UnexpectedOrderStateError):
        payments.handle_stripe_webhook(late_body, late_sig, stripe_adapter=adapter)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED
    assert "webhook.unexpected_state" in ledger_actions(commerce_core, order.trace_id)


def test_stripe_settlement_uses_stripe_actor(commerce_core):
    order, payments = create_pending_order(commerce_core, "idem_stripe_0006")
    body, signature = signed(succeeded_payload(order.order_id))
    payments.handle_stripe_webhook(body, signature, stripe_adapter=stripe_adapter())
    actors = {
        e.actor
        for e in ledger_events(commerce_core, order.trace_id)
        if e.action == "webhook.reconciled"
    }
    assert actors == {"stripe"}


def test_stripe_route_settles_through_the_service_boundary(commerce_core):
    import sellable.main as main_module
    from fastapi.testclient import TestClient

    service = PaymentService(commerce_core, razorpay_adapter())
    original_settings = main_module.settings
    main_module.settings = stripe_settings()
    main_module.app.dependency_overrides[main_module.get_payment_service] = lambda: service
    client = TestClient(main_module.app)
    try:
        order, consent = create_pending_order(commerce_core, "idem_stripe_route_01")
        _ = consent
        body, signature = signed(succeeded_payload(order.order_id))
        response = client.post(
            "/webhooks/stripe",
            content=body,
            headers={"Stripe-Signature": signature, "Content-Type": "application/json"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "CAPTURED"
        assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID

        # Unknown order → 404, never a settlement attempt.
        unknown_body, unknown_sig = signed(succeeded_payload("ord_missing"))
        missing = client.post(
            "/webhooks/stripe",
            content=unknown_body,
            headers={"Stripe-Signature": unknown_sig, "Content-Type": "application/json"},
        )
        assert missing.status_code == 404
    finally:
        main_module.settings = original_settings
        main_module.app.dependency_overrides.clear()
        client.close()
