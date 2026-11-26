"""Phase-4 infrastructure: circuit breakers (§46.2), the §35 email channel,
and multi-tenant discovery surfaces."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.resilience import BreakerState, CircuitBreaker, CircuitOpenError


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


# --- circuit breaker -------------------------------------------------------------


def test_breaker_opens_after_threshold_and_fails_fast() -> None:
    breaker = CircuitBreaker(name="test", failure_threshold=3, cooldown_seconds=60.0)
    for _ in range(3):
        with pytest.raises(ValueError):
            breaker.call(lambda: (_ for _ in ()).throw(ValueError("down")))
    assert breaker.state is BreakerState.OPEN
    with pytest.raises(CircuitOpenError):
        breaker.before_call()


def test_breaker_half_open_probe_recloses() -> None:
    breaker = CircuitBreaker(name="test", failure_threshold=2, cooldown_seconds=0.0)
    for _ in range(2):
        with pytest.raises(ValueError):
            breaker.call(lambda: (_ for _ in ()).throw(ValueError("down")))
    # Cooldown 0.0: immediately ready for the half-open probe.
    assert breaker.state is BreakerState.HALF_OPEN
    # One probe succeeds → closed again.
    assert breaker.call(lambda: "ok") == "ok"
    assert breaker.state is BreakerState.CLOSED


def test_breaker_probe_failure_reopens() -> None:
    breaker = CircuitBreaker(name="test", failure_threshold=1, cooldown_seconds=0.0)
    with pytest.raises(ValueError):
        breaker.call(lambda: (_ for _ in ()).throw(ValueError("down")))
    assert breaker.state is BreakerState.HALF_OPEN  # cooldown 0 → probe allowed
    with pytest.raises(ValueError):
        breaker.call(lambda: (_ for _ in ()).throw(ValueError("down")))  # probe fails
    # The probe failure reopens the circuit (fresh cooldown); with cooldown
    # 0.0 the public state reads HALF_OPEN again instantly, so assert the
    # internal transition.
    assert breaker._state is BreakerState.OPEN


def test_payment_provider_breaker_present(commerce_core: CommerceCore) -> None:
    from sellable.config import Settings
    from sellable.main import payment_service

    assert payment_service.provider_breaker.name.startswith("payment:")
    assert payment_service.provider_breaker.failure_threshold >= 1


# --- email channel ----------------------------------------------------------------


def test_email_channel_disabled_without_config() -> None:
    from sellable.notifications import email_channel_configured

    assert email_channel_configured(Settings(environment="development")) is False


def test_email_channel_sends_urgent_rule_when_configured() -> None:
    from sellable.events import new_event
    from sellable.notifications import notify_for_event
    from sellable.repositories import NotificationRepository

    sent: list[object] = []

    class _FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent.append({"host": host, "port": port})

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            pass

        def send_message(self, message):
            sent.append({"message": message})

    monkey = pytest.MonkeyPatch()
    settings = Settings(
        environment="development",
        smtp_host="localhost",
        smtp_port=2525,
        smtp_from="ops@sellable.shop",
        smtp_recipients="merchant@sellable.shop",
    )
    monkey.setattr("sellable.config.settings", settings)
    core_engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(core_engine)
    core = CommerceCore.from_seed(LedgerRepository(core_engine), engine=core_engine)
    event = new_event(
        event_type="order.created",
        tenant_id=core.merchant_scope,
        merchant_id=core.merchant_scope,
        aggregate_type="order",
        aggregate_id="ord_email_1",
        trace_id=f"trc_{0 * 1:032x}".replace("000", "abc"),
        actor_type="commerce_core",
        actor_id=core.merchant_scope,
        data={"requires_approval": True},
    )
    try:
        monkey.setattr("smtplib.SMTP", _FakeSMTP)
        created = notify_for_event(event, notification_repo=NotificationRepository())
        assert created, "approval-needed rule must fire"
        assert any("host" in item for item in sent), "urgent rule must email when configured"
    finally:
        monkey.undo()


# --- multi-tenant discovery ---------------------------------------------------------


def test_discovery_surfaces_accept_merchant_param() -> None:
    from fastapi.testclient import TestClient

    from sellable.main import app

    with TestClient(app) as client:
        demo = client.get("/agent/capabilities")
        assert demo.status_code == 200
        unknown = client.get("/agent/capabilities", params={"merchant": "mrc_nope"})
        assert unknown.status_code == 404
        profile = client.get("/agent/profile")
        assert profile.status_code == 200
        assert profile.json()["merchant_id"]
