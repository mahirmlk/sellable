"""Phase 6: event bus (§27) — outbox fan-out with idempotent consumers,
retries, and dead letters."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    ShippingMethod,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.event_bus import EventBus, build_bus, drain_once
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


def _bus(core: CommerceCore, **overrides) -> EventBus:
    engine = _engine_of(core)
    params = {
        "outbox_repo": OutboxRepository(engine=engine),
        "analytics_repo": AnalyticsRepository(engine=engine),
        "notification_repo": NotificationRepository(engine=engine),
        "webhook_dispatcher": WebhookDispatcher(WebhookRepository(engine=engine)),
        "core_resolver": lambda merchant_id: core,
    }
    params.update(overrides)
    return build_bus(**params)


def _paid_order(core: CommerceCore, amount: int = 69_900):
    intent = IntentMandate(
        buyer_agent_id="buyer_bus",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="bus test",
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
        idempotency_key=f"idem_bus_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    return core.mark_paid(order.order_id, provider_ref="pay_bus_1")


# --- Fan-out -------------------------------------------------------------------------


def test_paid_order_fans_out_to_all_consumers(commerce_core: CommerceCore) -> None:
    core = commerce_core
    engine = _engine_of(core)
    order = _paid_order(core)
    assert OutboxRepository(engine=engine).pending_count(core.merchant_scope) >= 1

    stats = drain_once(_bus(core))
    assert stats["claimed"] >= 2  # order.created + order.paid
    assert stats["failed"] == 0
    assert OutboxRepository(engine=engine).pending_count(core.merchant_scope) == 0

    # Analytics normalized the payment with the order amount.
    analytics = AnalyticsRepository(engine=engine)
    overview = analytics.overview(core.merchant_scope)
    assert overview["orders_paid"] == 1
    assert overview["gmv_paise"] == order.amount_paise
    assert overview["conversion_rate_bps"] == 10_000

    # Merchant was notified.
    feed = NotificationRepository(engine=engine).list_for_merchant(core.merchant_scope)
    assert any(n["event_type"] == "order.paid" for n in feed)

    # Fulfillment started automatically (idempotent).
    fulfillment = core.fulfillment_repo.for_order(order.order_id, core.merchant_scope)
    assert fulfillment is not None
    assert fulfillment.method.value == "standard"


def test_redelivery_is_idempotent(commerce_core: CommerceCore) -> None:
    core = commerce_core
    engine = _engine_of(core)
    order = _paid_order(core)
    bus = _bus(core)
    first = drain_once(bus)
    assert first["delivered"] >= 2

    # Simulate redelivery: the same envelopes through consumers twice.
    analytics = AnalyticsRepository(engine=engine)
    before = analytics.overview(core.merchant_scope)["orders_paid"]
    # Direct redeliver of the same envelopes through consumers:
    from sellable.events import new_event

    event = new_event(
        event_type="order.paid",
        tenant_id=core.merchant_scope,
        merchant_id=core.merchant_scope,
        aggregate_type="order",
        aggregate_id=order.order_id,
        trace_id=order.trace_id,
        actor_type="commerce_core",
        actor_id=core.merchant_scope,
        data={},
    )
    from sellable.event_bus import make_analytics_consumer

    make_analytics_consumer(analytics, lambda merchant_id: core)(event)
    make_analytics_consumer(analytics, lambda merchant_id: core)(event)
    after = analytics.overview(core.merchant_scope)["orders_paid"]
    assert after == before == 1


def test_failing_consumer_retries_then_dead_letters(
    commerce_core: CommerceCore,
) -> None:
    core = commerce_core
    engine = _engine_of(core)
    _paid_order(core)
    outbox = OutboxRepository(engine=engine)

    def boom(event) -> None:
        raise RuntimeError("consumer down")

    bus = EventBus(outbox, max_attempts=2)
    bus.subscribe("order.paid", boom)
    stats = drain_once(bus)
    assert stats["failed"] >= 1
    # order.created has no subscriber → delivered; order.paid failed once.
    assert outbox.pending_count(core.merchant_scope) >= 1
    stats = drain_once(bus)
    assert stats["dead_lettered"] >= 1
    assert outbox.dead_letter_count(core.merchant_scope) >= 1

    dead = outbox.list_dead_letters(core.merchant_scope)
    assert dead and dead[0]["attempts"] >= 2
    assert outbox.reset_delivery(dead[0]["event_id"], core.merchant_scope) is True
    assert outbox.dead_letter_count(core.merchant_scope) == 0
    assert outbox.pending_count(core.merchant_scope) >= 1


def test_unsubscribed_events_drain_cleanly(commerce_core: CommerceCore) -> None:
    core = commerce_core
    engine = _engine_of(core)
    cart = core.create_cart(trace_id=_trace())
    bus = EventBus(OutboxRepository(engine=engine))
    stats = drain_once(bus)
    assert stats["claimed"] >= 1
    assert stats["delivered"] == stats["claimed"]
    assert stats["failed"] == 0
    _ = cart
