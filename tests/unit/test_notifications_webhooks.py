"""Phase 6: notification rules (§35), signed webhook fan-out (§36.2),
and the carrier inbound webhook."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import ShippingMethod, utc_now
from sellable.core import CommerceCore
from sellable.events import new_event
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.notifications import (
    SUBSCRIBABLE_EVENTS,
    WebhookDispatcher,
    merchant_notifications_for,
    notify_for_event,
    sign_payload,
)
from sellable.repositories import (
    NotificationRepository,
    OutboxRepository,
    WebhookRepository,
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


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def _engine_of(core: CommerceCore):
    return core.outbox_repo._engine


def _event(core: CommerceCore, event_type: str, **data):
    return new_event(
        event_type=event_type,
        tenant_id=core.merchant_scope,
        merchant_id=core.merchant_scope,
        aggregate_type="order",
        aggregate_id="ord_1",
        trace_id=_trace(),
        actor_type="commerce_core",
        actor_id=core.merchant_scope,
        data=dict(data),
    )


# --- Rules -------------------------------------------------------------------------------


def test_notification_rules(commerce_core: CommerceCore) -> None:
    core = commerce_core
    paid = merchant_notifications_for(_event(core, "order.paid", amount_paise=69_900))
    assert len(paid) == 1
    assert "69" in paid[0]["title"] or "paid" in paid[0]["title"].lower()

    held = merchant_notifications_for(
        _event(core, "order.created", requires_approval=True)
    )
    assert held and held[0]["urgency"] == "URGENT"

    quiet = merchant_notifications_for(_event(core, "cart.updated"))
    assert quiet == []

    risk = merchant_notifications_for(
        _event(core, "risk.action_taken", reasons=["AMOUNT_OVER_MAX"])
    )
    assert risk and risk[0]["urgency"] == "URGENT"
    assert set(SUBSCRIBABLE_EVENTS) >= {
        "order.paid",
        "refund.completed",
        "support.case.updated",
        "risk.action_taken",
    }


def test_notify_persists_feed(commerce_core: CommerceCore) -> None:
    engine = _engine_of(commerce_core)
    repo = NotificationRepository(engine=engine)
    created = notify_for_event(
        _event(commerce_core, "order.paid", amount_paise=1_000),
        notification_repo=repo,
    )
    assert len(created) == 1
    feed = repo.list_for_merchant(commerce_core.merchant_scope)
    assert len(feed) == 1
    assert repo.mark_read(feed[0]["notification_id"], commerce_core.merchant_scope)
    assert repo.list_for_merchant(
        commerce_core.merchant_scope, unread_only=True
    ) == []
    assert repo.mark_read("ntf_missing", commerce_core.merchant_scope) is False


# --- Signed fan-out ----------------------------------------------------------------------------


def test_signature_verifies() -> None:
    secret = "s3cret"
    body = b'{"event_id":"evt_1"}'
    signature = sign_payload(secret, body)
    import hashlib
    import hmac

    assert hmac.compare_digest(
        signature, hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    )


def test_webhook_dispatch_with_fake_post(commerce_core: CommerceCore) -> None:
    engine = _engine_of(commerce_core)
    webhooks = WebhookRepository(engine=engine)
    subscription = webhooks.create_subscription(
        merchant_id=commerce_core.merchant_scope,
        url="https://agents.example.com/hook",
        events=["order.paid"],
        secret="s3cret",
    )
    posted: list[dict] = []

    def fake_post(url: str, payload: dict, headers: dict) -> int:
        posted.append({"url": url, "payload": payload, "headers": headers})
        return 200

    dispatcher = WebhookDispatcher(webhooks, post_fn=fake_post)
    notify_for_event(
        _event(commerce_core, "order.paid", amount_paise=1_000),
        notification_repo=NotificationRepository(engine=engine),
        webhook_dispatcher=dispatcher,
    )
    assert len(posted) == 1
    assert posted[0]["headers"]["X-Sellable-Event"] == "order.paid"
    assert posted[0]["headers"]["X-Sellable-Signature"]
    dispatches = webhooks.recent_dispatches(commerce_core.merchant_scope)
    assert len(dispatches) == 1
    assert dispatches[0]["status"] == "SENT"

    def failing_post(url: str, payload: dict, headers: dict) -> int:
        raise RuntimeError("connection refused")

    failing = WebhookDispatcher(webhooks, post_fn=failing_post, max_attempts=2)
    failing.dispatch(_event(commerce_core, "order.paid"))
    failures = [
        d for d in webhooks.recent_dispatches(commerce_core.merchant_scope)
        if d["status"] == "FAILED"
    ]
    assert len(failures) == 1
    assert failures[0]["attempts"] == 2
    assert webhooks.delete_subscription(
        subscription.subscription_id, commerce_core.merchant_scope
    ) is True


def test_subscription_validation(commerce_core: CommerceCore) -> None:
    from sellable.contracts import WebhookSubscription

    with pytest.raises(Exception):
        WebhookSubscription(
            merchant_id="m", url="ftp://example.com/hook", events=["order.paid"]
        )


# --- Carrier inbound -------------------------------------------------------------------------------


def test_carrier_webhook_route(monkeypatch, tmp_path) -> None:
    import sellable.main as main_module
    import sellable.repositories as repositories_mod
    from sellable import merchant_auth
    from sellable.config import Settings
    from sellable.contracts import (
        CartItem,
        CartMandate,
        IntentMandate,
        ShippingMethod,
    )
    from sellable.ledger import database as ledger_database
    from sellable.registry import DEMO_MERCHANT_ID, MerchantRegistry

    db_path = tmp_path / "carrier.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)
    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)
    monkeypatch.setattr(
        merchant_auth, "settings", Settings(environment="development")
    )
    monkeypatch.setattr(
        main_module,
        "settings",
        Settings(environment="development", shipping_webhook_secret="carrier-secret"),
    )

    core = test_registry.get(DEMO_MERCHANT_ID)
    intent = IntentMandate(
        buyer_agent_id="buyer_carrier",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="carrier test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
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
        cart=mandate, intent=intent, trace_id=_trace(),
        idempotency_key=f"idem_carrier_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_carrier_1")
    fulfillment = core.create_fulfillment(
        order.order_id, ShippingMethod.STANDARD, trace_id=_trace()
    )
    shipped = core.ship_fulfillment(fulfillment.fulfillment_id, trace_id=_trace())

    client = TestClient(main_module.app)
    try:
        denied = client.post(
            "/webhooks/shipping/acme",
            json={
                "tracking_reference": shipped.tracking_reference,
                "status": "IN_TRANSIT",
            },
            headers={"X-Carrier-Secret": "wrong"},
        )
        assert denied.status_code == 401

        unknown_status = client.post(
            "/webhooks/shipping/acme",
            json={"tracking_reference": shipped.tracking_reference, "status": "WARPED"},
            headers={"X-Carrier-Secret": "carrier-secret"},
        )
        assert unknown_status.status_code == 400

        ok = client.post(
            "/webhooks/shipping/acme",
            json={
                "tracking_reference": shipped.tracking_reference,
                "status": "IN_TRANSIT",
                "location": "Bengaluru hub",
            },
            headers={"X-Carrier-Secret": "carrier-secret"},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["status"] == "IN_TRANSIT"

        missing = client.post(
            "/webhooks/shipping/acme",
            json={"tracking_reference": "trk_nope", "status": "IN_TRANSIT"},
            headers={"X-Carrier-Secret": "carrier-secret"},
        )
        assert missing.status_code == 404
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()
        engine.dispose()
