"""Phase 1a foundation contracts: agent identity (§13), delegation (§14),
event envelope (§27.3), merchant onboarding (§10).

Pure-contract tests — no database, no network. These lock the target
architecture's field shapes so Phase 1b persistence and Phase 3
authorization build on one definition.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from pydantic import ValidationError

from sellable.agent_identity import (
    AgentIdentity,
    AgentReputation,
    AgentType,
    CredentialStatus,
)
from sellable.contracts import utc_now
from sellable.delegations import (
    AuthorizationDecision,
    AuthorizationOutcome,
    DelegationGrant,
    DelegationStatus,
    OperationScope,
)
from sellable.events import CANONICAL_EVENT_TYPES, PlatformEvent, new_event
from sellable.onboarding import (
    READINESS_CHECKS,
    MerchantOnboarding,
    OnboardingStage,
    next_stage,
)


def _trace() -> str:
    return "trc_" + "a" * 32


# --- Agent identity (§13) -------------------------------------------------


def test_agent_identity_usable_when_active_and_unexpired() -> None:
    identity = AgentIdentity(
        agent_type=AgentType.CUSTOMER_AGENT,
        owner_id="owner_1",
        issuer="https://agents.example.com",
        credential_expires_at=utc_now() + timedelta(hours=1),
    )
    assert identity.is_credential_usable() is True


def test_agent_identity_unusable_when_revoked_or_expired() -> None:
    revoked = AgentIdentity(
        agent_type=AgentType.CUSTOMER_AGENT,
        owner_id="owner_1",
        issuer="https://agents.example.com",
        credential_status=CredentialStatus.REVOKED,
    )
    assert revoked.is_credential_usable() is False
    expired = AgentIdentity(
        agent_type=AgentType.CUSTOMER_AGENT,
        owner_id="owner_1",
        issuer="https://agents.example.com",
        credential_expires_at=utc_now() - timedelta(seconds=1),
    )
    assert expired.is_credential_usable() is False


def test_agent_reputation_requires_history_for_score() -> None:
    with pytest.raises(ValidationError):
        AgentReputation(agent_id="agent_1", reputation_score_bps=5_000)


def test_agent_reputation_accepts_counters() -> None:
    reputation = AgentReputation(
        agent_id="agent_1",
        successful_transactions=10,
        policy_denials=1,
        reputation_score_bps=8_000,
        score_confidence_bps=6_000,
    )
    assert reputation.successful_transactions == 10


# --- Delegation and authorization (§14) -------------------------------------


def _grant(**overrides) -> DelegationGrant:
    now = utc_now()
    base = {
        "principal_customer_id": "cust_1",
        "subject_agent_id": "agent_1",
        "merchant_scope": "mrc_demo",
        "operation_scopes": [OperationScope.CART_WRITE, OperationScope.ORDER_READ],
        "expires_at": now + timedelta(hours=1),
    }
    base.update(overrides)
    return DelegationGrant(**base)


def test_delegation_window_must_be_positive() -> None:
    now = utc_now()
    with pytest.raises(ValidationError):
        _grant(valid_from=now, expires_at=now - timedelta(seconds=1))


def test_revoked_delegation_requires_revoked_at() -> None:
    with pytest.raises(ValidationError):
        _grant(status=DelegationStatus.REVOKED)


def test_revoked_delegation_invalidates_future_actions() -> None:
    grant = _grant(
        status=DelegationStatus.REVOKED, revoked_at=utc_now() - timedelta(minutes=1)
    )
    assert grant.is_usable() is False
    assert (
        grant.covers(OperationScope.CART_WRITE, merchant_id="mrc_demo") is False
    )


def test_delegation_covers_scope_merchant_and_amount() -> None:
    grant = _grant(amount_limit_paise=100_000)
    assert grant.covers(OperationScope.CART_WRITE, merchant_id="mrc_demo") is True
    assert grant.covers(OperationScope.CHECKOUT_WRITE, merchant_id="mrc_demo") is False
    assert grant.covers(OperationScope.CART_WRITE, merchant_id="mrc_other") is False
    assert (
        grant.covers(
            OperationScope.CART_WRITE,
            merchant_id="mrc_demo",
            amount_paise=200_000,
        )
        is False
    )
    assert (
        grant.covers(
            OperationScope.CART_WRITE,
            merchant_id="mrc_demo",
            amount_paise=50_000,
        )
        is True
    )


def test_authorization_decision_expiry_is_executable() -> None:
    now = utc_now()
    decision = AuthorizationDecision(
        scope_used=OperationScope.PAYMENT_AUTHORIZE,
        outcome=AuthorizationOutcome.ALLOW,
        reason_code="DELEGATION_VALID",
        created_at=now - timedelta(minutes=10),
        expires_at=now - timedelta(minutes=1),
    )
    assert decision.is_expired is True
    live = AuthorizationDecision(
        scope_used=OperationScope.CART_WRITE,
        outcome=AuthorizationOutcome.REQUIRE_HUMAN,
        reason_code="ABOVE_APPROVAL_THRESHOLD",
        expires_at=now + timedelta(minutes=5),
    )
    assert live.is_expired is False
    assert live.outcome == AuthorizationOutcome.REQUIRE_HUMAN


def test_all_four_authorization_outcomes_exist() -> None:
    assert {o.value for o in AuthorizationOutcome} == {
        "ALLOW",
        "DENY",
        "REQUIRE_CUSTOMER",
        "REQUIRE_HUMAN",
    }


# --- Event envelope (§27.3) --------------------------------------------------


def test_event_envelope_requires_well_formed_trace() -> None:
    with pytest.raises(ValidationError):
        PlatformEvent(
            event_type="order.paid",
            tenant_id="tenant_1",
            merchant_id="mrc_demo",
            aggregate_type="order",
            aggregate_id="order_1",
            trace_id="not-a-trace",
            actor={"type": "agent", "id": "agent_1"},
        )


def test_new_event_builds_canonical_envelope() -> None:
    event = new_event(
        event_type="order.paid",
        tenant_id="tenant_1",
        merchant_id="mrc_demo",
        aggregate_type="order",
        aggregate_id="order_1",
        trace_id=_trace(),
        actor_type="agent",
        actor_id="agent_1",
    )
    assert event.event_id.startswith("evt_")
    assert event.event_version == 1
    assert event.data == {}


def test_canonical_outbound_types_cover_lifecycle() -> None:
    for required in (
        "order.paid",
        "refund.completed",
        "support.case.updated",
        "risk.action_taken",
    ):
        assert required in CANONICAL_EVENT_TYPES


# --- Merchant onboarding (§10) ----------------------------------------------


def test_onboarding_advances_one_stage_in_order() -> None:
    onboarding = MerchantOnboarding(merchant_id="mrc_1")
    assert onboarding.stage == OnboardingStage.CREATED
    advanced = onboarding.advance()
    assert advanced.stage == OnboardingStage.BUSINESS_PROFILED
    assert onboarding.stage == OnboardingStage.CREATED  # immutable source


def test_onboarding_live_is_terminal() -> None:
    onboarding = MerchantOnboarding(
        merchant_id="mrc_1", stage=OnboardingStage.LIVE
    )
    assert next_stage(OnboardingStage.LIVE) is None
    with pytest.raises(ValueError):
        onboarding.advance()


def test_onboarding_activation_requires_all_readiness_checks() -> None:
    onboarding = MerchantOnboarding(merchant_id="mrc_1")
    assert onboarding.is_activation_ready is False
    for check in READINESS_CHECKS:
        onboarding = onboarding.record_check(check)
    assert onboarding.is_activation_ready is True
    with pytest.raises(ValueError):
        onboarding.record_check("not_a_check")


def test_readiness_checks_cover_target_catalogue() -> None:
    assert "sandbox_transaction" in READINESS_CHECKS
    assert "agent_capability_profile_validity" in READINESS_CHECKS
    assert len(READINESS_CHECKS) == 10
