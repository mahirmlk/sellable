"""Phase 6: analytics metrics (§34.2) and operations overview (§33)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.event_bus import build_bus, drain_once
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.notifications import WebhookDispatcher
from sellable.repositories import (
    AnalyticsRepository,
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


def _paid_order(core: CommerceCore, amount: int = 69_900):
    intent = IntentMandate(
        buyer_agent_id="buyer_analytics",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="analytics test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=amount,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=69_900 - amount,
        total_paise=amount,
        negotiation_round=0,
    )
    order = core.create_order(
        cart=mandate, intent=intent, trace_id=_trace(),
        idempotency_key=f"idem_an_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    return core.mark_paid(order.order_id, provider_ref="pay_an_1")


def _drained_bus(core: CommerceCore):
    engine = _engine_of(core)
    return build_bus(
        outbox_repo=OutboxRepository(engine=engine),
        analytics_repo=AnalyticsRepository(engine=engine),
        notification_repo=NotificationRepository(engine=engine),
        webhook_dispatcher=WebhookDispatcher(WebhookRepository(engine=engine)),
        core_resolver=lambda merchant_id: core,
    )


# --- Metrics ---------------------------------------------------------------------------


def test_overview_and_timeseries(commerce_core: CommerceCore) -> None:
    core = commerce_core
    engine = _engine_of(core)
    _paid_order(core)
    _paid_order(core)
    drain_once(_drained_bus(core))

    analytics = AnalyticsRepository(engine=engine)
    overview = analytics.overview(core.merchant_scope)
    assert overview["orders_created"] == 2
    assert overview["orders_paid"] == 2
    assert overview["gmv_paise"] == 139_800
    assert overview["aov_paise"] == 69_900
    assert overview["conversion_rate_bps"] == 10_000
    assert overview["refunds_completed"] == 0

    series = analytics.timeseries(core.merchant_scope, days=30)
    assert len(series) == 1
    assert series[0]["gmv_paise"] == 139_800
    assert series[0]["orders"] == 2


def test_refund_and_return_metrics(commerce_core: CommerceCore) -> None:
    core = commerce_core
    engine = _engine_of(core)
    order = _paid_order(core)
    core.mark_refunded(order.order_id, provider_ref="rfnd_an_1")
    drain_once(_drained_bus(core))

    overview = AnalyticsRepository(engine=engine).overview(core.merchant_scope)
    assert overview["refunds_completed"] == 1
    assert overview["refund_amount_paise"] == order.amount_paise


# --- Console HTTP ----------------------------------------------------------------------------


def _merchant_overrides(app, merchant_id: str):
    from sellable import merchant_auth

    session = merchant_auth.MerchantSession(
        merchant_id=merchant_id, role="owner", auth_user_id="user_ops"
    )
    user = merchant_auth.AuthenticatedUser(auth_user_id="user_ops")
    app.dependency_overrides[merchant_auth.get_merchant_session] = lambda: session
    app.dependency_overrides[merchant_auth.get_authenticated_user] = lambda: user


def test_console_analytics_notifications_ops(commerce_core: CommerceCore) -> None:
    import sellable.main as main_module

    core = commerce_core
    _paid_order(core)
    drain_once(_drained_bus(core))

    main_module.app.dependency_overrides[
        main_module.get_commerce
    ] = lambda: core
    _merchant_overrides(main_module.app, core.merchant_scope)
    # Console routes build repositories per-request from make_engine: point
    # them at the in-memory engine.
    import sellable.ledger.database as ledger_database
    import sellable.repositories as repositories_mod

    engine = _engine_of(core)
    ledger_database_original = ledger_database.make_engine
    repositories_original = repositories_mod.make_engine
    ledger_database.make_engine = lambda config=None: engine
    repositories_mod.make_engine = lambda: engine
    client = TestClient(main_module.app)
    try:
        overview = client.get("/console/analytics/overview", params={"days": 30})
        assert overview.status_code == 200, overview.text
        assert overview.json()["orders_paid"] == 1

        series = client.get("/console/analytics/timeseries", params={"days": 30})
        assert series.status_code == 200
        assert series.json()[0]["orders"] == 1

        feed = client.get("/console/notifications")
        assert feed.status_code == 200, feed.text
        assert any(n["event_type"] == "order.paid" for n in feed.json())
        notification_id = feed.json()[0]["notification_id"]
        read = client.post(f"/console/notifications/{notification_id}/read")
        assert read.status_code == 200

        ops = client.get("/console/ops/overview")
        assert ops.status_code == 200, ops.text
        body = ops.json()
        assert body["outbox"]["pending"] == 0
        assert body["outbox"]["dead_lettered"] == 0

        drain = client.post("/console/ops/bus/drain")
        assert drain.status_code == 200
        assert drain.json()["delivered"] >= 0

        dead = client.get("/console/ops/dead-letters")
        assert dead.status_code == 200
        assert dead.json() == []

        subs = client.get("/console/webhooks/subscriptions")
        assert subs.status_code == 200
        assert subs.json() == []
        created = client.post(
            "/console/webhooks/subscriptions",
            json={"url": "https://agents.example.com/hook", "events": ["order.paid"]},
        )
        assert created.status_code == 200, created.text
        assert created.json()["secret"]
        bad = client.post(
            "/console/webhooks/subscriptions",
            json={"url": "https://agents.example.com/hook", "events": ["nope"]},
        )
        assert bad.status_code == 400
        dispatches = client.get("/console/webhooks/dispatches")
        assert dispatches.status_code == 200
        deleted = client.delete(
            f"/console/webhooks/subscriptions/{created.json()['subscription_id']}"
        )
        assert deleted.status_code == 200
    finally:
        ledger_database.make_engine = ledger_database_original
        repositories_mod.make_engine = repositories_original
        main_module.app.dependency_overrides.clear()
        client.close()
