"""Tests for the WORKFLOW.md §48/§55 additions: HMAC auth, agent endpoints,
bounded retry, merchant sessions, and dashboard API aliases.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.auth import sign_request
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
from sellable.main import app
from sellable.payments.razorpay import RazorpayAdapter
from sellable.payments.service import PaymentService

AGENT_KEY = "sellable_demo_key_001"
H = {"X-Agent-Key": AGENT_KEY}


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def buyer_intent(budget_ceiling_paise: int = 600_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_workflow",
        budget_ceiling_paise=budget_ceiling_paise,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Workflow integration test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def test_hmac_signed_request_is_authenticated_and_replay_is_rejected(
    commerce_core: CommerceCore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sellable.main import get_agent_gateway
    from sellable.gateway import AgentGateway
    from sellable.agents.seller import SellerAgent

    gateway = AgentGateway(commerce_core, SellerAgent(commerce_core))
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    secret = "test_hmac_secret"

    import sellable.auth as auth_module

    monkeypatch.setattr(
        auth_module,
        "settings",
        Settings(agent_hmac_secret=secret, agent_api_key_hashes=()),
    )
    try:
        with TestClient(app) as client:
            body = json.dumps({"query": "coffee", "categories": []}, separators=(",", ":")).encode(
                "utf-8"
            )
            timestamp = str(int(time.time()))
            nonce = "nonce_workflow_001"
            signature = sign_request(
                agent_id="buyer_hmac",
                method="POST",
                path="/agent/catalog.search",
                timestamp=timestamp,
                nonce=nonce,
                secret=secret,
                body=body,
            )
            headers = {
                "Authorization": f"Bearer {AGENT_KEY}",
                "X-Agent-Id": "buyer_hmac",
                "X-Timestamp": timestamp,
                "X-Nonce": nonce,
                "X-Signature": signature,
                "Content-Type": "application/json",
            }
            first = client.post("/agent/catalog.search", content=body, headers=headers)
            replay = client.post("/agent/catalog.search", content=body, headers=headers)
            stale = client.post(
                "/agent/catalog.search",
                content=body,
                headers={
                    **headers,
                    "X-Timestamp": str(int(time.time()) - 400),
                },
            )
            tampered = client.post(
                "/agent/catalog.search",
                content=json.dumps({"query": "tea", "categories": []}, separators=(",", ":")).encode("utf-8"),
                headers=headers,
            )
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 200
    assert any("COFFEE" in p["sku"] for p in first.json())
    assert replay.status_code == 401
    assert stale.status_code == 401
    assert tampered.status_code == 401


def test_agent_order_and_consent_flow(
    commerce_core: CommerceCore,
) -> None:
    from sellable.main import get_agent_gateway, get_commerce
    from sellable.gateway import AgentGateway
    from sellable.agents.seller import SellerAgent

    gateway = AgentGateway(commerce_core, SellerAgent(commerce_core))
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    app.dependency_overrides[get_commerce] = lambda: commerce_core
    intent = buyer_intent()
    try:
        with TestClient(app) as client:
            created = client.post(
                "/agent/orders.create",
                json={
                    "intent": intent.model_dump(mode="json"),
                    "message": "I need coffee for my desk",
                    "idempotency_key": "idem_workflow_order_0001",
                    "request_upsell": True,
                },
                headers=H,
            )
            assert created.status_code == 200, created.text
            order = created.json()
            assert order["status"] == OrderStatus.AWAITING_CONSENT.value
            order_id = order["order_id"]

            duplicate = client.post(
                "/agent/orders.create",
                json={
                    "intent": intent.model_dump(mode="json"),
                    "message": "I need coffee for my desk",
                    "idempotency_key": "idem_workflow_order_0001",
                    "request_upsell": True,
                },
                headers=H,
            )
            assert duplicate.status_code == 200
            assert duplicate.json()["order_id"] == order_id
            assert duplicate.json()["replayed"] is True

            consent = client.post("/agent/consents.request", json={"order_id": order_id}, headers=H)
            assert consent.status_code == 200
            assert consent.json()["single_use"] is True

            status = client.post("/agent/orders.status", json={"order_id": order_id}, headers=H)
            assert status.status_code == 200
            assert status.json()["status"] == OrderStatus.AWAITING_CONSENT.value
    finally:
        app.dependency_overrides.clear()


def test_dashboard_aliases_match_workflow_spec(
    commerce_core: CommerceCore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Hermetic demo-mode merchant session: the console endpoints must accept the
    # demo X-Agent-Key fallback even when Supabase is configured in .env.
    import sellable.merchant_auth as merchant_auth

    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    with TestClient(app) as client:
        assert client.get("/agents/status", headers=H).status_code == 200
        assert client.get("/activity", headers=H).status_code == 200
        assert client.get("/transactions", headers=H).status_code == 200
        assert client.get("/approvals", headers=H).status_code == 200
        assert client.get("/growth", headers=H).status_code == 200
        # privileged action requires merchant session; missing key -> 401
        assert client.post("/approvals/does-not-exist/approve").status_code == 401
        assert client.post("/approvals/does-not-exist/approve", headers=H).status_code == 400


def test_refund_requires_paid_order(commerce_core: CommerceCore, monkeypatch: pytest.MonkeyPatch) -> None:
    # Demo-mode merchant session so the X-Agent-Key grants a dev session.
    import sellable.merchant_auth as merchant_auth

    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    order = commerce_core.create_order(
        cart=CartMandate(
            intent_ref="im_refund",
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
        ),
        intent=buyer_intent(),
        trace_id="trc_refund_workflow",
        idempotency_key="idem_refund_workflow_01",
    )
    with TestClient(app) as client:
        response = client.post(
            "/agent/refunds.create", json={"order_id": order.order_id, "reason": "test"}, headers=H
        )
    assert response.status_code == 400


class _FakePaymentLinks:
    def __init__(self) -> None:
        self.calls = 0

    def create(self, data: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        return {
            "id": f"plink_retry_{self.calls}",
            "short_url": f"https://rzp.io/i/retry_{self.calls}",
            "amount": data["amount"],
            "currency": "INR",
            "status": "created",
            # Razorpay creates an internal order for every payment link;
            # payment.captured/failed webhooks reference it via order_id.
            "order_id": f"order_test_{self.calls}",
        }


class _FakeUtility:
    def verify_webhook_signature(self, body: str, signature: str, secret: str) -> bool:
        expected = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            from razorpay.errors import SignatureVerificationError

            raise SignatureVerificationError("mismatch")
        return True


class _FakeClient:
    def __init__(self) -> None:
        self.payment_link = _FakePaymentLinks()
        self.utility = _FakeUtility()


def _settings() -> object:
    from sellable.config import Settings

    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        razorpay_key_id="rzp_test_retry",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="webhook_secret",
    )


def _webhook(event: str, provider_order_id: str = "order_test_1") -> tuple[bytes, str]:
    """Signature-valid payment.captured/failed payload referencing the fake
    payment link's internal Razorpay order id."""
    payload = {
        "event": event,
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_retry_{event}_{provider_order_id}",
                    "order_id": provider_order_id,
                    "status": "captured" if event == "payment.captured" else "failed",
                    "error_description": "declined",
                }
            }
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(b"webhook_secret", body, hashlib.sha256).hexdigest()
    return body, signature


def test_bounded_retry_is_idempotent_and_aborts_after_limit(commerce_core: CommerceCore) -> None:
    intent = buyer_intent()
    cart = CartMandate(
        intent_ref="im_retry",
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
    order = commerce_core.create_order(
        cart=cart, intent=intent, trace_id="trc_retry_workflow", idempotency_key="idem_retry_workflow_0001"
    )
    consent = commerce_core.issue_consent(order.order_id)

    client = _FakeClient()
    payments = PaymentService(commerce_core, RazorpayAdapter(_settings(), client=client))

    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    body, signature = _webhook("payment.failed")
    payments.handle_webhook(body, signature)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED

    retried = payments.retry_payment(order_id=order.order_id)
    assert retried.status is PaymentStatus.PAYMENT_PENDING
    assert client.payment_link.calls == 2

    # The retried attempt fails again, then the bounded limit is reached.
    body2, signature2 = _webhook("payment.failed", provider_order_id="order_test_2")
    payments.handle_webhook(body2, signature2)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED

    with pytest.raises(ValueError, match="Retry limit"):
        payments.retry_payment(order_id=order.order_id)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.ABORTED

    actions = [e.action for e in commerce_core.ledger.for_trace(order.trace_id)]
    assert "retry.started" in actions
    assert "retry.aborted" in actions
    assert "order.aborted" in actions


def test_high_value_order_is_held_until_merchant_approval(commerce_core: CommerceCore) -> None:
    """HITL guardrail: an order above the threshold is created, consent is gated,
    and merchant approval unblocks it."""
    cart = CartMandate(
        intent_ref="im_hitl",
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
    intent = buyer_intent(budget_ceiling_paise=300_000)
    order = commerce_core.create_order(
        cart=cart, intent=intent, trace_id="trc_hitl_flow", idempotency_key="idem_hitl_flow_0001"
    )

    assert order.requires_approval is True
    with pytest.raises(ValueError, match="requires merchant approval"):
        commerce_core.issue_consent(order.order_id)

    approved = commerce_core.approve_order(order.order_id)
    assert approved.requires_approval is False
    assert approved.approved_at is not None

    consent = commerce_core.issue_consent(order.order_id)
    assert consent.order_id == order.order_id

    actions = [e.action for e in commerce_core.ledger.for_trace(order.trace_id)]
    assert "human.approval_granted" in actions


def test_policy_update_revalidates_cross_field_constraints(commerce_core: CommerceCore) -> None:
    """M1: raising the approval threshold above the max order value must be rejected."""
    with pytest.raises(Exception):
        commerce_core.update_policy(human_approval_threshold_paise=999_999)


def test_webhook_amount_mismatch_does_not_settle(commerce_core: CommerceCore) -> None:
    """M4: a captured amount that differs from the order amount must not mark PAID."""
    from sellable.payments.razorpay import RazorpayAdapter
    from sellable.payments.service import PaymentService

    intent = buyer_intent()
    cart = CartMandate(
        intent_ref="im_mismatch",
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
    order = commerce_core.create_order(
        cart=cart, intent=intent, trace_id="trc_mismatch", idempotency_key="idem_mismatch_0001"
    )
    consent = commerce_core.issue_consent(order.order_id)

    client = _FakeClient()
    payments = PaymentService(commerce_core, RazorpayAdapter(_settings(), client=client))
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)

    payload = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_mismatch_1",
                    "order_id": "order_test_1",
                    "status": "captured",
                    "amount": 69_999,
                }
            }
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(b"webhook_secret", body, hashlib.sha256).hexdigest()
    result = payments.handle_webhook(body, signature)

    assert result.status is PaymentStatus.PAYMENT_PENDING
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING
    actions = [e.action for e in commerce_core.ledger.for_trace(order.trace_id)]
    assert "webhook.amount_mismatch" in actions