"""Phase 1b: delegation persistence, authorization decisions (§14.4), and
CommerceCore wiring (deny-path only) plus outbox publishing (§27).

Orders created WITHOUT a delegation behave exactly as before — the
authorization check only runs when ``delegation_id`` is supplied.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.agent_identity import AgentIdentity, AgentReputation, AgentType
from sellable.authorization import AuthorizationService, decide
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    OrderStatus,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.delegations import (
    ApprovalMode,
    AuthorizationOutcome,
    DelegationGrant,
    DelegationStatus,
    OperationScope,
)
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.onboarding import MerchantOnboarding
from sellable.repositories import (
    AgentIdentityRepository,
    DelegationRepository,
    MerchantOnboardingRepository,
    OutboxRepository,
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


def _intent() -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_phase1b",
        budget_ceiling_paise=200_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Phase 1b authorization test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _cart() -> CartMandate:
    return CartMandate(
        intent_ref="im_phase1b",
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


def _grant(merchant_scope: str, **overrides) -> DelegationGrant:
    base = {
        "principal_customer_id": "cust_1",
        "subject_agent_id": "agent_1",
        "merchant_scope": merchant_scope,
        "operation_scopes": [OperationScope.CHECKOUT_WRITE, OperationScope.CART_WRITE],
        "amount_limit_paise": 200_000,
        "expires_at": utc_now() + timedelta(hours=1),
    }
    base.update(overrides)
    return DelegationGrant(**base)


# --- Pure decision rules (§14.4) ---------------------------------------------


def test_decide_allow_for_valid_low_risk_delegation(commerce_core: CommerceCore) -> None:
    decision = decide(
        _grant(commerce_core.merchant_scope),
        scope=OperationScope.CART_WRITE,
        merchant_id=commerce_core.merchant_scope,
        amount_paise=69_900,
    )
    assert decision.outcome == AuthorizationOutcome.ALLOW
    assert decision.reason_code == "DELEGATION_VALID"


def test_decide_high_risk_scope_requires_customer(commerce_core: CommerceCore) -> None:
    decision = decide(
        _grant(
            commerce_core.merchant_scope,
            operation_scopes=[OperationScope.PAYMENT_AUTHORIZE],
        ),
        scope=OperationScope.PAYMENT_AUTHORIZE,
        merchant_id=commerce_core.merchant_scope,
        amount_paise=69_900,
    )
    assert decision.outcome == AuthorizationOutcome.REQUIRE_CUSTOMER
    assert decision.reason_code == "HIGH_RISK_SCOPE_REQUIRES_CUSTOMER"


def test_decide_deny_paths(commerce_core: CommerceCore) -> None:
    merchant = commerce_core.merchant_scope
    assert (
        decide(None, scope=OperationScope.CART_WRITE, merchant_id=merchant).reason_code
        == "DELEGATION_UNKNOWN"
    )
    assert (
        decide(
            _grant(merchant, status=DelegationStatus.REVOKED, revoked_at=utc_now()),
            scope=OperationScope.CART_WRITE,
            merchant_id=merchant,
        ).reason_code
        == "DELEGATION_REVOKED"
    )
    expired = DelegationGrant(
        principal_customer_id="cust_1",
        subject_agent_id="agent_1",
        merchant_scope=merchant,
        operation_scopes=[OperationScope.CART_WRITE],
        valid_from=utc_now() - timedelta(hours=2),
        expires_at=utc_now() - timedelta(hours=1),
    )
    assert (
        decide(expired, scope=OperationScope.CART_WRITE, merchant_id=merchant).reason_code
        == "DELEGATION_EXPIRED"
    )
    assert (
        decide(
            _grant(merchant),
            scope=OperationScope.PAYMENT_AUTHORIZE,
            merchant_id=merchant,
        ).reason_code
        == "SCOPE_NOT_GRANTED"
    )
    assert (
        decide(
            _grant(merchant), scope=OperationScope.CART_WRITE, merchant_id="mrc_other"
        ).reason_code
        == "MERCHANT_SCOPE_MISMATCH"
    )
    assert (
        decide(
            _grant(merchant),
            scope=OperationScope.CART_WRITE,
            merchant_id=merchant,
            amount_paise=500_000,
        ).reason_code
        == "AMOUNT_EXCEEDS_LIMIT"
    )


def test_decide_approval_mode_require_human(commerce_core: CommerceCore) -> None:
    merchant = commerce_core.merchant_scope
    decision = decide(
        _grant(merchant, approval_mode=ApprovalMode.REQUIRE_HUMAN),
        scope=OperationScope.CART_WRITE,
        merchant_id=merchant,
    )
    assert decision.outcome == AuthorizationOutcome.REQUIRE_HUMAN


# --- Repository round-trips --------------------------------------------------


def test_delegation_repository_save_get_revoke(commerce_core: CommerceCore) -> None:
    repo: DelegationRepository = commerce_core.delegation_repo
    grant = _grant(commerce_core.merchant_scope)
    repo.save(grant)

    loaded = repo.get(grant.delegation_id)
    assert loaded is not None
    assert loaded.delegation_id == grant.delegation_id
    assert OperationScope.CHECKOUT_WRITE in loaded.operation_scopes

    service = AuthorizationService(delegation_lookup=repo)
    assert (
        service.authorize(
            delegation_id=grant.delegation_id,
            scope=OperationScope.CHECKOUT_WRITE,
            merchant_id=commerce_core.merchant_scope,
            amount_paise=69_900,
        ).outcome
        == AuthorizationOutcome.ALLOW
    )
    assert (
        service.authorize(
            delegation_id="dlg_unknown",
            scope=OperationScope.CHECKOUT_WRITE,
            merchant_id=commerce_core.merchant_scope,
        ).outcome
        == AuthorizationOutcome.DENY
    )

    active = repo.active_for_agent(commerce_core.merchant_scope, "agent_1")
    assert [g.delegation_id for g in active] == [grant.delegation_id]

    repo.revoke(grant.delegation_id, commerce_core.merchant_scope)
    assert (
        service.authorize(
            delegation_id=grant.delegation_id,
            scope=OperationScope.CHECKOUT_WRITE,
            merchant_id=commerce_core.merchant_scope,
        ).reason_code
        == "DELEGATION_REVOKED"
    )
    assert repo.active_for_agent(commerce_core.merchant_scope, "agent_1") == []

    with pytest.raises(LookupError):
        repo.revoke(grant.delegation_id, "mrc_other")


def test_agent_identity_and_reputation_roundtrip(commerce_core: CommerceCore) -> None:
    engine = commerce_core.delegation_repo._engine
    repo = AgentIdentityRepository(engine=engine)
    identity = AgentIdentity(
        agent_type=AgentType.CUSTOMER_AGENT,
        owner_id="owner_1",
        issuer="https://agents.example.com",
    )
    repo.register(identity)
    loaded = repo.get(identity.agent_id)
    assert loaded is not None
    assert loaded.is_credential_usable() is True
    repo.touch_last_seen(identity.agent_id)
    assert repo.get(identity.agent_id).last_seen_at is not None

    repo.save_reputation(
        AgentReputation(agent_id=identity.agent_id, successful_transactions=3)
    )
    reputation = repo.reputation(identity.agent_id)
    assert reputation is not None
    assert reputation.successful_transactions == 3
    assert repo.reputation("agent_unknown") is None


def test_onboarding_repository_roundtrip(commerce_core: CommerceCore) -> None:
    engine = commerce_core.delegation_repo._engine
    repo = MerchantOnboardingRepository(engine=engine)
    assert repo.get("mrc_new") is None
    onboarding = MerchantOnboarding(merchant_id="mrc_new").advance().record_check(
        "catalog_completeness"
    )
    repo.save(onboarding)
    loaded = repo.get("mrc_new")
    assert loaded is not None
    assert loaded.stage.value == "BUSINESS_PROFILED"
    assert loaded.completed_checks == ["catalog_completeness"]


# --- CommerceCore wiring (deny-path only) -------------------------------------


def test_core_order_without_delegation_is_unchanged(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    order = commerce_core.create_order(
        cart=_cart(),
        intent=_intent(),
        trace_id=trace_id,
        idempotency_key=f"idem_no_dlg_{uuid4().hex}",
    )
    assert order.status == OrderStatus.AWAITING_CONSENT
    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert not [a for a in actions if a.startswith("authorization.")]
    # Outbox still publishes lifecycle events (no delegation involved).
    outbox = OutboxRepository(engine=commerce_core.delegation_repo._engine)
    assert outbox.pending_count(commerce_core.merchant_scope) == 1


def test_core_order_with_valid_delegation(commerce_core: CommerceCore) -> None:
    grant = _grant(commerce_core.merchant_scope)
    commerce_core.delegation_repo.save(grant)
    trace_id = _trace()
    order = commerce_core.create_order(
        cart=_cart(),
        intent=_intent(),
        trace_id=trace_id,
        idempotency_key=f"idem_allow_{uuid4().hex}",
        delegation_id=grant.delegation_id,
    )
    assert order.status == OrderStatus.AWAITING_CONSENT
    assert not order.requires_approval
    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert "authorization.checked" in actions


def test_core_order_blocked_by_unknown_delegation(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    key = f"idem_deny_{uuid4().hex}"
    with pytest.raises(ValueError, match="blocked by authorization"):
        commerce_core.create_order(
            cart=_cart(),
            intent=_intent(),
            trace_id=trace_id,
            idempotency_key=key,
            delegation_id="dlg_nope",
        )
    assert commerce_core.order_repo.for_idempotency_key(
        commerce_core.merchant_scope, key
    ) is None
    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert "authorization.denied" in actions


def test_core_order_held_by_require_human_delegation(
    commerce_core: CommerceCore,
) -> None:
    grant = _grant(
        commerce_core.merchant_scope, approval_mode=ApprovalMode.REQUIRE_HUMAN
    )
    commerce_core.delegation_repo.save(grant)
    order = commerce_core.create_order(
        cart=_cart(),
        intent=_intent(),
        trace_id=_trace(),
        idempotency_key=f"idem_hold_{uuid4().hex}",
        delegation_id=grant.delegation_id,
    )
    assert order.requires_approval is True


# --- Outbox (§27) --------------------------------------------------------------


def test_outbox_lifecycle_events_and_claim(commerce_core: CommerceCore) -> None:
    outbox = OutboxRepository(engine=commerce_core.delegation_repo._engine)
    trace_id = _trace()
    order = commerce_core.create_order(
        cart=_cart(),
        intent=_intent(),
        trace_id=trace_id,
        idempotency_key=f"idem_outbox_{uuid4().hex}",
    )
    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    commerce_core.mark_paid(order.order_id, provider_ref="pay_test_1")
    commerce_core.mark_paid(order.order_id, provider_ref="pay_test_1")  # idempotent

    claimed = outbox.claim_unpublished(limit=10)
    types = [e.event_type for e in claimed]
    assert types.count("order.created") == 1
    assert types.count("order.paid") == 1  # duplicate transition publishes once
    paid = next(e for e in claimed if e.event_type == "order.paid")
    assert paid.trace_id == trace_id
    assert paid.aggregate_id == order.order_id
    assert paid.tenant_id == commerce_core.merchant_scope

    assert outbox.pending_count(commerce_core.merchant_scope) == 2
    for event in claimed:
        outbox.mark_published(event.event_id)
    assert outbox.pending_count(commerce_core.merchant_scope) == 0
