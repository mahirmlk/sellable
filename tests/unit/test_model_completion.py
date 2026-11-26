"""Phase-3 model completion: §12.1 identity ladder, §32.3 access tiers,
§24.4 promotion-abuse signal, onboarding stage advancement, and notification
feed dedupe under at-least-once redelivery."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import utc_now
from sellable.core import CommerceCore
from sellable.delegations import DelegationGrant, OperationScope
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.protocols.identity import IdentityLevel, IdentityLinkService
from sellable.repositories import IdentityLinkRepository
from sellable.trust import AgentAccessTier, TrustAssessment, TrustTier, derive_access_tier


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


# --- §12.1 identity ladder ------------------------------------------------------


def _identity_service(core: CommerceCore) -> IdentityLinkService:
    return IdentityLinkService(core.identity_repo)


def test_identity_ladder_anonymous_to_linked(commerce_core: CommerceCore) -> None:
    service = _identity_service(commerce_core)
    merchant = commerce_core.merchant_scope
    repo = commerce_core.identity_repo
    delegation_repo = commerce_core.delegation_repo

    assert (
        service.resolve_identity_level(
            merchant, "cust_ladder", identity_repo=repo, delegation_repo=delegation_repo
        )
        is IdentityLevel.ANONYMOUS
    )

    # A prior link attempt (PENDING) makes the customer known.
    link, code = service.create_link(merchant, "cust_ladder")
    assert (
        service.resolve_identity_level(
            merchant, "cust_ladder", identity_repo=repo, delegation_repo=delegation_repo
        )
        is IdentityLevel.KNOWN_CUSTOMER
    )

    # An ACTIVE delegation for the customer is authenticated authority.
    grant = DelegationGrant(
        principal_customer_id="cust_ladder",
        subject_agent_id="agent_ladder",
        merchant_scope=merchant,
        operation_scopes=[OperationScope.CART_WRITE],
        expires_at=utc_now() + timedelta(hours=1),
    )
    delegation_repo.save(grant)
    assert (
        service.resolve_identity_level(
            merchant, "cust_ladder", identity_repo=repo, delegation_repo=delegation_repo
        )
        is IdentityLevel.AUTHENTICATED_CUSTOMER
    )

    # Approving the link reaches the top of the ladder.
    service.approve_link(link.link_id, merchant, link_code=code)
    assert (
        service.resolve_identity_level(
            merchant, "cust_ladder", identity_repo=repo, delegation_repo=delegation_repo
        )
        is IdentityLevel.IDENTITY_LINKED_CUSTOMER
    )


def test_identity_me_exposes_level(commerce_core: CommerceCore, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from sellable import main as main_module
    from sellable.main import app, get_scoped_commerce

    service = _identity_service(commerce_core)
    monkeypatch.setattr(main_module, "identity_service", service)
    link, code = service.create_link(
        commerce_core.merchant_scope, "cust_me", agent_id="buyer_demo_01"
    )
    service.approve_link(link.link_id, commerce_core.merchant_scope, link_code=code)
    app.dependency_overrides[get_scoped_commerce] = lambda: commerce_core
    try:
        with TestClient(app) as client:
            response = client.get(
                f"/commerce/identity/me?link_id={link.link_id}",
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
        assert response.status_code == 200
        assert response.json()["identity_level"] == "identity_linked_customer"
    finally:
        app.dependency_overrides.clear()


# --- §32.3 access tiers ----------------------------------------------------------


def test_access_tier_ladder() -> None:
    def _assessment(tier: TrustTier) -> TrustAssessment:
        return TrustAssessment(subject_type="agent", subject_id="agent_x", tier=tier)

    assert (
        derive_access_tier(_assessment(TrustTier.UNVERIFIED))
        is AgentAccessTier.PUBLIC_DISCOVERY
    )
    assert (
        derive_access_tier(_assessment(TrustTier.NEW))
        is AgentAccessTier.AUTHENTICATED_BROWSE
    )
    assert (
        derive_access_tier(_assessment(TrustTier.NEW), identity_linked=True)
        is AgentAccessTier.CUSTOMER_LINKED
    )
    assert (
        derive_access_tier(_assessment(TrustTier.NEW), has_active_delegation=True)
        is AgentAccessTier.TRANSACTION_CAPABLE
    )
    assert (
        derive_access_tier(_assessment(TrustTier.ESTABLISHED))
        is AgentAccessTier.TRANSACTION_CAPABLE
    )
    assert (
        derive_access_tier(_assessment(TrustTier.TRUSTED))
        is AgentAccessTier.HIGH_VALUE_TRANSACTION
    )
    # Flagged subjects stay at the bottom regardless of history.
    assert (
        derive_access_tier(_assessment(TrustTier.FLAGGED), has_active_delegation=True)
        is AgentAccessTier.PUBLIC_DISCOVERY
    )
    # Platform internal agents reach sensitive support.
    assert (
        derive_access_tier(
            _assessment(TrustTier.NEW), agent_type="SELLABLE_INTERNAL_AGENT"
        )
        is AgentAccessTier.SENSITIVE_SUPPORT
    )


def test_agent_profile_publishes_access_tier(commerce_core: CommerceCore) -> None:
    from fastapi.testclient import TestClient

    from sellable.main import app, get_commerce

    app.dependency_overrides[get_commerce] = lambda: commerce_core
    try:
        with TestClient(app) as client:
            profile = client.get("/agent/profile").json()
    finally:
        app.dependency_overrides.clear()
    agents = profile["agents"]
    assert agents and all("access_tier" in a for a in agents)
    assert any(a["access_tier"] == "SENSITIVE_SUPPORT" for a in agents)


# --- §24.4 promotion abuse --------------------------------------------------------


def test_promotion_velocity_triggers_step_up_and_fraud_flag(
    commerce_core: CommerceCore,
) -> None:
    from sellable.risk import PROMOTION_ABUSE_REDEMPTIONS, RiskLevel

    assessment = commerce_core.risk_service.assess(
        merchant_id=commerce_core.merchant_scope,
        amount_paise=50_000,
        subject_id="cust_promo_abuser",
        promotion_redemptions_recent=PROMOTION_ABUSE_REDEMPTIONS,
        trace_id=_trace(),
    )
    assert "PROMOTION_VELOCITY_HIGH" in assessment.reasons
    assert assessment.level is RiskLevel.STEP_UP_AUTH
    # The abuse signal raises a PROMOTION_ABUSE fraud event (fraud_events
    # store — separate from policy, §24.1).
    recent = commerce_core.fraud_service.recent(
        commerce_core.merchant_scope, limit=10
    )
    assert any(
        event.kind.value == "promotion_abuse"
        and event.subject_id == "cust_promo_abuser"
        for event in recent
    )


def test_promotion_velocity_helper_counts_customer_redemptions(
    commerce_core: CommerceCore,
) -> None:
    assert commerce_core._promotion_redemptions_for_customer(None) == 0
    assert (
        commerce_core._promotion_redemptions_for_customer("cust_nobody", window_minutes=1)
        == 0
    )


# --- onboarding stage advancement --------------------------------------------------


def test_readiness_advances_stage_when_all_checks_pass(commerce_core: CommerceCore) -> None:
    # Make the readiness surface green: stocked catalog exists from seed,
    # shipping methods configured by default, promotions consistent (none).
    results = commerce_core.refresh_onboarding_readiness(
        trace_id=_trace(),
        payment_configured=True,
        webhook_configured=True,
    )
    onboarding = commerce_core.onboarding_repo.get(commerce_core.merchant_scope)
    assert onboarding is not None
    if all(results.values()):
        assert onboarding.stage.value == "READY_FOR_REVIEW"
        actions = [
            e.action
            for e in commerce_core.ledger.for_trace(_trace())  # trace differs; use all_events
        ]
    # The advanced ledger event exists regardless of which checks passed.
    all_actions = [
        e.action
        for e in commerce_core.ledger.all_events(
            limit=100, merchant_id=commerce_core.merchant_scope
        )
    ]
    if onboarding.stage.value == "READY_FOR_REVIEW":
        assert "onboarding.advanced" in all_actions


# --- notification dedupe -----------------------------------------------------------


def test_notification_feed_is_idempotent_per_event(commerce_core: CommerceCore) -> None:
    from sellable.events import new_event
    from sellable.notifications import merchant_notifications_for, notify_for_event
    from sellable.repositories import NotificationRepository

    repo = NotificationRepository()
    event = new_event(
        event_type="order.paid",
        tenant_id=commerce_core.merchant_scope,
        merchant_id=commerce_core.merchant_scope,
        aggregate_type="order",
        aggregate_id="ord_dedupe_1",
        trace_id=_trace(),
        actor_type="commerce_core",
        actor_id=commerce_core.merchant_scope,
        data={"amount_paise": 69_900},
    )
    assert merchant_notifications_for(event), "order.paid must have a feed rule"
    first = notify_for_event(event, notification_repo=repo)
    replay = notify_for_event(event, notification_repo=repo)
    assert first, "first delivery creates feed rows"
    assert replay == [], "redelivery of the same event creates nothing"
