"""Phase 8 sweep: onboarding readiness validation (§10.3) and agent run
telemetry on the bus (§29 + §34.2)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.event_bus import build_bus, drain_once
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.notifications import WebhookDispatcher
from sellable.onboarding import READINESS_CHECKS, validate_readiness
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


# --- Readiness -----------------------------------------------------------------------


def test_validate_readiness_covers_all_checks(commerce_core: CommerceCore) -> None:
    core = commerce_core
    results = validate_readiness(
        catalog=core.catalog,
        policy=core.policy,
        promotion_repo=core.promotion_repo,
        shipping_service=core.shipping_service,
        merchant_id=core.merchant_scope,
        payment_configured=True,
        webhook_configured=True,
    )
    assert set(results) == set(READINESS_CHECKS)
    assert results["catalog_completeness"] is True
    assert results["policy_consistency"] is True
    assert results["shipping_availability"] is True
    assert results["agent_capability_profile_validity"] is True
    assert results["payment_health"] is True
    assert results["sandbox_transaction"] is False  # no sandbox runs yet


def test_refresh_records_passing_checks(commerce_core: CommerceCore) -> None:
    core = commerce_core
    trace_id = _trace()
    results = core.refresh_onboarding_readiness(
        trace_id=trace_id, payment_configured=True, webhook_configured=True
    )
    onboarding = core.onboarding_repo.get(core.merchant_scope)
    assert onboarding is not None
    assert all(c in onboarding.completed_checks for c, ok in results.items() if ok)
    assert "sandbox_transaction" not in onboarding.completed_checks
    actions = [e.action for e in core.ledger.for_trace(trace_id)]
    assert "onboarding.validated" in actions


def test_exclusive_overlap_detected(commerce_core: CommerceCore) -> None:
    from datetime import timedelta as _td

    from sellable.contracts import Promotion, PromotionType, StackingRule
    from sellable.onboarding import _exclusive_overlap

    base = {
        "merchant_id": commerce_core.merchant_scope,
        "kind": PromotionType.FIXED_DISCOUNT,
        "title": "x",
        "amount_paise": 100,
        "stacking": StackingRule.EXCLUSIVE,
        "start_at": utc_now() - _td(hours=1),
    }
    assert _exclusive_overlap([]) is False
    first = Promotion(**base)
    disjoint = Promotion(
        **{**base, "start_at": utc_now() - _td(hours=3), "end_at": utc_now() - _td(hours=2)}
    )
    assert _exclusive_overlap([first, disjoint]) is False
    overlapping = Promotion(**{**base, "promotion_id": "promo_other"})
    assert _exclusive_overlap([first, overlapping]) is True


# --- Agent run telemetry -----------------------------------------------------------------


def test_seller_run_publishes_completion(commerce_core: CommerceCore) -> None:
    from agents.seller.agent import SellerAgent, SellerRequest

    core = commerce_core
    intent = IntentMandate(
        buyer_agent_id="buyer_run_bus",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories"],
        purpose="run telemetry test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    SellerAgent(core).respond(
        SellerRequest(message="I need coffee for my desk", intent=intent),
        trace_id=_trace(),
    )
    engine = _engine_of(core)
    outbox = OutboxRepository(engine=engine)
    assert outbox.pending_count(core.merchant_scope) >= 1
    bus = build_bus(
        outbox_repo=outbox,
        analytics_repo=AnalyticsRepository(engine=engine),
        notification_repo=NotificationRepository(engine=engine),
        webhook_dispatcher=WebhookDispatcher(WebhookRepository(engine=engine)),
        core_resolver=lambda merchant_id: core,
    )
    stats = drain_once(bus)
    assert stats["failed"] == 0
    analytics = AnalyticsRepository(engine=engine)
    rows = analytics.overview(core.merchant_scope)
    assert rows["checkouts_completed"] == 0  # run events are facts, not checkouts
    assert outbox.pending_count(core.merchant_scope) == 0
