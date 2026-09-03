import hashlib
import hmac
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import CartItem, CartMandate, IntentMandate, OrderStatus, PaymentStatus, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.main import app, get_payment_service
from sellable.payments.razorpay import (
    InvalidWebhookSignatureError,
    RazorpayAdapter,
    RazorpayConfigurationError,
)
from sellable.payments.service import PaymentService


def razorpay_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        razorpay_key_id="rzp_test_sellable",
        razorpay_key_secret="test_key_secret",
        razorpay_webhook_secret="test_webhook_secret",
    )


class FakeRazorpayOrders:
    def create(self, data: dict[str, object]) -> dict[str, object]:
        assert data["currency"] == "INR"
        return {
            "id": "order_razorpay_test_01",
            "amount": data["amount"],
            "currency": "INR",
            "status": "created",
        }


class FakeRazorpayPaymentLinks:
    def create(self, data: dict[str, object]) -> dict[str, object]:
        assert data["currency"] == "INR"
        return {
            "id": "plink_test_0001",
            "short_url": "https://rzp.io/i/testlink",
            "amount": data["amount"],
            "currency": "INR",
            "status": "created",
            # Razorpay creates an internal order for every payment link;
            # payment.captured webhooks reference it via payment.order_id.
            "order_id": "order_razorpay_test_01",
        }


class FakeRazorpayUtility:
    def verify_webhook_signature(self, body: str, signature: str, secret: str) -> bool:
        expected = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            from razorpay.errors import SignatureVerificationError

            raise SignatureVerificationError("signature mismatch")
        return True


class FakeRazorpayClient:
    def __init__(self) -> None:
        self.order = FakeRazorpayOrders()
        self.payment_link = FakeRazorpayPaymentLinks()
        self.utility = FakeRazorpayUtility()


def razorpay_adapter() -> RazorpayAdapter:
    return RazorpayAdapter(razorpay_settings(), client=FakeRazorpayClient())


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def create_consented_order(core: CommerceCore):
    intent = IntentMandate(
        buyer_agent_id="buyer_payment_test",
        budget_ceiling_paise=100_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy a travel case",
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
    order = core.create_order(
        cart=cart,
        intent=intent,
        trace_id="trc_payment_test",
        idempotency_key="idem_payment_test_0001",
    )
    return order, core.issue_consent(order.order_id)


def signed_webhook(payload: dict[str, object]) -> tuple[bytes, str]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(
        b"test_webhook_secret", body, hashlib.sha256
    ).hexdigest()
    return body, signature


def captured_payload() -> dict[str, object]:
    return {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_razorpay_test_01",
                    "order_id": "order_razorpay_test_01",
                    "status": "captured",
                    "amount": 69_900,
                }
            }
        },
    }


def payment_link_paid_payload(
    reference_id: str = "ord_unknown",
    payment_id: str = "pay_test_0001",
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
                    "amount": 69_900,
                    "status": "captured",
                }
            },
        },
    }


def test_verified_webhook_is_authoritative_and_idempotent(commerce_core: CommerceCore) -> None:
    order, consent = create_consented_order(commerce_core)
    payments = PaymentService(commerce_core, razorpay_adapter())

    started = payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    assert started.status is PaymentStatus.PAYMENT_PENDING
    assert started.payment_url == "https://rzp.io/i/testlink"
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING

    body, signature = signed_webhook(payment_link_paid_payload(reference_id=order.order_id))
    settled = payments.handle_webhook(body, signature)
    duplicate = payments.handle_webhook(body, signature)

    assert settled.status is PaymentStatus.CAPTURED
    assert duplicate == settled
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    events = commerce_core.ledger.for_trace(order.trace_id)
    assert [event.action for event in events].count("webhook.reconciled") == 1
    assert [event.action for event in events].count("order.paid") == 1


def test_invalid_webhook_signature_cannot_settle_an_order(commerce_core: CommerceCore) -> None:
    order, consent = create_consented_order(commerce_core)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    body, _ = signed_webhook(captured_payload())

    with pytest.raises(InvalidWebhookSignatureError):
        payments.handle_webhook(body, "not-a-valid-signature")

    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING


def test_missing_test_credentials_do_not_consume_consent(commerce_core: CommerceCore) -> None:
    order, consent = create_consented_order(commerce_core)
    unconfigured = RazorpayAdapter(
        Settings(
            environment="test",
            database_url="sqlite+pysqlite:///:memory:",
            razorpay_key_id=None,
            razorpay_key_secret=None,
            razorpay_webhook_secret=None,
        )
    )
    payments = PaymentService(commerce_core, unconfigured)

    with pytest.raises(RazorpayConfigurationError):
        payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.AWAITING_CONSENT


def test_verified_payment_failure_is_explicit(commerce_core: CommerceCore) -> None:
    order, consent = create_consented_order(commerce_core)
    payments = PaymentService(commerce_core, razorpay_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    # Customer-side failures arrive as payment.failed on the link's internal
    # order (Razorpay's link lifecycle only offers paid/cancelled events).
    body, signature = signed_webhook(
        {
            "event": "payment.failed",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_test_0001",
                        "order_id": "order_razorpay_test_01",
                        "amount": order.amount_paise,
                        "status": "failed",
                        "error_description": "Payment declined in test mode",
                    }
                }
            },
        }
    )

    result = payments.handle_webhook(body, signature)

    assert result.status is PaymentStatus.FAILED
    assert result.failure_reason == "Payment declined in test mode"
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED


def test_payment_and_webhook_endpoints_use_the_verified_service_boundary(
    commerce_core: CommerceCore,
) -> None:
    order, consent = create_consented_order(commerce_core)
    service = PaymentService(commerce_core, razorpay_adapter())
    app.dependency_overrides[get_payment_service] = lambda: service
    body, signature = signed_webhook(payment_link_paid_payload(reference_id=order.order_id))
    try:
        with TestClient(app) as client:
            started = client.post(
                f"/orders/{order.order_id}/payment",
                json={"consent_id": consent.consent_id},
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
            settled = client.post(
                "/webhooks/razorpay",
                content=body,
                headers={"X-Razorpay-Signature": signature},
            )
    finally:
        app.dependency_overrides.clear()

    assert started.status_code == 200
    assert started.json()["status"] == "PAYMENT_PENDING"
    assert settled.status_code == 200
    assert settled.json()["status"] == "CAPTURED"
