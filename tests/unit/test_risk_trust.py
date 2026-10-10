"""Phase 3: risk/fraud engines (§24), trust tiers (§32), unified
policy-on-grand, and checkout risk gating."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.agent_identity import AgentIdentity, AgentType
from sellable.contracts import (
    CartItem,
    CartMandate,
    CheckoutStatus,
    FraudKind,
    IntentMandate,
    RiskLevel,
    TrustTier,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.delegations import DelegationGrant, OperationScope
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


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


def _intent(budget: int = 500_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_risk",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="risk test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _mandate(total: int = 69_900) -> CartMandate:
    return CartMandate(
        intent_ref="im_risk",
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=min(total, 69_900),
            )
        ],
        subtotal_paise=69_900,
        discount_paise=69_900 - min(total, 69_900),
        total_paise=min(total, 69_900),
        negotiation_round=0,
    )


def _assess(core: CommerceCore, **overrides):
    params = {
        "merchant_id": core.merchant_scope,
        "amount_paise": 50_000,
        "subject_id": "cust_risk",
    }
    params.update(overrides)
    return core.risk_service.assess(**params)


# --- Risk levels ---------------------------------------------------------------


def test_allow_baseline(commerce_core: CommerceCore) -> None:
    assessment = _assess(commerce_core)
    assert assessment.level == RiskLevel.ALLOW
    assert assessment.reasons == ["NO_RISK_SIGNALS"]


def test_amount_gates(commerce_core: CommerceCore) -> None:
    policy = commerce_core.policy
    assert (
        _assess(commerce_core, amount_paise=policy.max_order_value_paise + 1).level
        == RiskLevel.BLOCK
    )
    assert (
        _assess(
            commerce_core,
            amount_paise=policy.human_approval_threshold_paise,
        ).level
        == RiskLevel.REQUIRE_HUMAN
    )


def test_order_velocity_step_up_then_block(commerce_core: CommerceCore) -> None:
    core = commerce_core
    for index in range(3):
        core.create_order(
            cart=_mandate(),
            intent=_intent(),
            trace_id=_trace(),
            idempotency_key=f"idem_vel_{index}_{uuid4().hex}",
        )
    # Buyer subject differs (buyer_risk) from assessed subject (cust_risk):
    # assess the actual buyer to trip velocity.
    assert (
        _assess(core, subject_id="buyer_risk").level == RiskLevel.STEP_UP_AUTH
    )
    for index in range(3, 6):
        core.create_order(
            cart=_mandate(),
            intent=_intent(),
            trace_id=_trace(),
            idempotency_key=f"idem_vel_{index}_{uuid4().hex}",
        )
    blocked = _assess(core, subject_id="buyer_risk")
    assert blocked.level == RiskLevel.BLOCK
    assert "ORDER_VELOCITY_HIGH" in blocked.reasons
    flags = core.fraud_service.recent(core.merchant_scope, kind=FraudKind.VELOCITY_ABUSE)
    assert len(flags) == 1
    assert flags[0].subject_id == "buyer_risk"


def _failed_payment(core: CommerceCore):
    order = core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=_trace(),
        idempotency_key=f"idem_fp_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    return core.mark_payment_failed(order.order_id, reason="declined")


def test_failed_payments_escalate(commerce_core: CommerceCore) -> None:
    core = commerce_core
    _failed_payment(core)
    assert _assess(core).level == RiskLevel.LOW_RISK_REVIEW
    _failed_payment(core)
    assert _assess(core).level == RiskLevel.STEP_UP_AUTH


def test_unverified_agent_high_value_steps_up(commerce_core: CommerceCore) -> None:
    assert (
        _assess(
            commerce_core,
            agent_id="agent_ghost",
            amount_paise=150_000,
        ).level
        == RiskLevel.STEP_UP_AUTH
    )
    assert (
        _assess(commerce_core, agent_id="agent_ghost", amount_paise=1_000).level
        == RiskLevel.ALLOW
    )


def test_flagged_tier_blocks(commerce_core: CommerceCore) -> None:
    assert (
        _assess(commerce_core, trust_tier=TrustTier.FLAGGED).level == RiskLevel.BLOCK
    )


def test_payment_testing_pattern_blocks_and_flags(commerce_core: CommerceCore) -> None:
    from sellable.contracts import Product

    core = commerce_core
    core.catalog.add_product(
        Product(
            merchant_id=core.merchant_scope,
            sku="SNACK-SAMPLE-01",
            title="Sample",
            description="Micro tasting sample",
            price_paise=500,
            floor_paise=100,
            stock=100,
            category="snacks",
        )
    )
    small = CartMandate(
        intent_ref="im_small",
        items=[
            CartItem(
                sku="SNACK-SAMPLE-01",
                quantity=1,
                unit_price_paise=500,
                offered_price_paise=500,
            )
        ],
        subtotal_paise=500,
        discount_paise=0,
        total_paise=500,
        negotiation_round=0,
    )
    for index in range(3):
        core.create_order(
            cart=small,
            intent=_intent(),
            trace_id=_trace(),
            idempotency_key=f"idem_pt_{index}_{uuid4().hex}",
        )
    assessment = _assess(core, subject_id="buyer_risk")
    assert assessment.level == RiskLevel.BLOCK
    assert "PAYMENT_TESTING_PATTERN" in assessment.reasons


# --- Trust -----------------------------------------------------------------------


def test_agent_tiers(commerce_core: CommerceCore) -> None:
    trust = commerce_core.trust_service
    merchant = commerce_core.merchant_scope
    assert trust.agent_assessment("ghost", merchant).tier == TrustTier.UNVERIFIED

    trust._agents.register(
        AgentIdentity(
            agent_id="agent_new",
            agent_type=AgentType.CUSTOMER_AGENT,
            owner_id="owner_1",
            issuer="https://agents.example.com",
        )
    )
    assert trust.agent_assessment("agent_new", merchant).tier == TrustTier.NEW
    for _ in range(3):
        trust.record_success("agent_new", merchant_id=merchant)
    assert trust.agent_assessment("agent_new", merchant).tier == TrustTier.ESTABLISHED
    trust.record_fraud_flag("agent_new", merchant_id=merchant)
    assert trust.agent_assessment("agent_new", merchant).tier == TrustTier.FLAGGED
    # Unregistered agents are silently ignored.
    trust.record_success("ghost", merchant_id=merchant)


def test_denial_and_failure_recording(commerce_core: CommerceCore) -> None:
    core = commerce_core
    merchant = core.merchant_scope
    grant = DelegationGrant(
        principal_customer_id="cust_1",
        subject_agent_id="agent_rec",
        merchant_scope=merchant,
        operation_scopes=[OperationScope.CHECKOUT_WRITE],
        expires_at=utc_now() + timedelta(hours=1),
    )
    core.agent_repo.register(
        AgentIdentity(
            agent_id="agent_rec",
            agent_type=AgentType.CUSTOMER_AGENT,
            owner_id="owner_1",
            issuer="https://agents.example.com",
        )
    )
    core.delegation_repo.save(grant)
    with pytest.raises(ValueError, match="OVER_BUDGET"):
        core.create_order(
            cart=_mandate(),
            intent=_intent(budget=1_000),
            trace_id=_trace(),
            idempotency_key=f"idem_deny_{uuid4().hex}",
            delegation_id=grant.delegation_id,
        )
    reputation = core.agent_repo.reputation("agent_rec")
    assert reputation is not None
    assert reputation.policy_denials == 1
    events = core.trust_event_repo.for_agent("agent_rec", merchant)
    assert [e["kind"] for e in events] == ["POLICY_DENIAL"]


def test_revoked_delegation_flags_credential_abuse(
    commerce_core: CommerceCore,
) -> None:
    core = commerce_core
    merchant = core.merchant_scope
    grant = DelegationGrant(
        principal_customer_id="cust_1",
        subject_agent_id="agent_cred",
        merchant_scope=merchant,
        operation_scopes=[OperationScope.CHECKOUT_WRITE],
        expires_at=utc_now() + timedelta(hours=1),
    )
    core.agent_repo.register(
        AgentIdentity(
            agent_id="agent_cred",
            agent_type=AgentType.CUSTOMER_AGENT,
            owner_id="owner_1",
            issuer="https://agents.example.com",
        )
    )
    core.delegation_repo.save(grant)
    core.delegation_repo.revoke(grant.delegation_id, merchant)
    with pytest.raises(ValueError, match="blocked by authorization"):
        core.create_order(
            cart=_mandate(),
            intent=_intent(),
            trace_id=_trace(),
            idempotency_key=f"idem_cred_{uuid4().hex}",
            delegation_id=grant.delegation_id,
        )
    flags = core.fraud_service.recent(merchant, kind=FraudKind.CREDENTIAL_ABUSE)
    assert len(flags) == 1
    assert flags[0].subject_id == "agent_cred"
    assert core.agent_repo.reputation("agent_cred").fraud_flags == 1


def test_merchant_and_customer_tiers(commerce_core: CommerceCore) -> None:
    trust = commerce_core.trust_service
    merchant = commerce_core.merchant_scope
    # No onboarding row yet → provisional.
    assert trust.merchant_assessment(merchant).tier == TrustTier.PROVISIONAL
    assert trust.customer_assessment("cust_fresh", merchant).tier == TrustTier.NEW


# --- Policy-on-grand ---------------------------------------------------------------


def test_policy_binds_grand_total(commerce_core: CommerceCore) -> None:
    products = {p.sku: p for p in commerce_core.catalog.all()}
    decision = commerce_core.policy_engine.evaluate_cart(
        cart=_mandate(),
        intent=_intent(budget=1_000_000),
        policy=commerce_core.policy,
        products=products,
        amount_override_paise=600_000,
    )
    assert decision.reason_code == "MERCHANT_POLICY_LIMIT"
    held = commerce_core.policy_engine.evaluate_cart(
        cart=_mandate(),
        intent=_intent(budget=500_000),
        policy=commerce_core.policy,
        products={p.sku: p for p in commerce_core.catalog.all()},
        amount_override_paise=250_000,
    )
    assert held.reason_code == "ABOVE_APPROVAL_THRESHOLD"
    # Legacy path (no override) still binds the merchandise total.
    legacy = commerce_core.policy_engine.evaluate_cart(
        cart=_mandate(),
        intent=_intent(budget=500_000),
        policy=commerce_core.policy,
        products={p.sku: p for p in commerce_core.catalog.all()},
    )
    assert legacy.verdict.value == "ALLOW"


# --- Checkout risk gating ------------------------------------------------------------


def _priced_checkout(core: CommerceCore, trace_id: str, customer_id: str = "buyer_risk"):
    cart = core.create_cart(trace_id=trace_id, customer_id=customer_id)
    cart = core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    checkout = core.create_checkout(cart.cart_id, trace_id=trace_id)
    core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    return core.checkout_price(checkout.checkout_id, trace_id=trace_id)


def test_checkout_blocked_by_risk_velocity(commerce_core: CommerceCore) -> None:
    core = commerce_core
    for index in range(6):
        core.create_order(
            cart=_mandate(),
            intent=_intent(),
            trace_id=_trace(),
            idempotency_key=f"idem_cb_{index}_{uuid4().hex}",
        )
    trace_id = _trace()
    priced = _priced_checkout(core, trace_id)
    with pytest.raises(ValueError, match="blocked by risk"):
        core.checkout_authorize(priced.checkout_id, trace_id=trace_id)
    reloaded = core.checkout_service.get_checkout(priced.checkout_id, core.merchant_scope)
    assert reloaded.status == CheckoutStatus.REJECTED


def test_checkout_hold_for_high_amount(commerce_core: CommerceCore) -> None:
    core = commerce_core
    trace_id = _trace()
    cart = core.create_cart(trace_id=trace_id)
    cart = core.cart_add_item(
        cart.cart_id, "GIFT-BOX-01", 1, expected_version=1, trace_id=trace_id
    )
    cart = core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    checkout = core.create_checkout(cart.cart_id, trace_id=trace_id)
    core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    priced = core.checkout_price(checkout.checkout_id, trace_id=trace_id)
    assert priced.grand_total_paise == 249_900  # above the 200_000 HITL line
    with pytest.raises(ValueError, match="held by risk"):
        core.checkout_authorize(priced.checkout_id, trace_id=trace_id)
    reloaded = core.checkout_service.get_checkout(priced.checkout_id, core.merchant_scope)
    assert reloaded.status == CheckoutStatus.PRICED  # hold is retryable, not terminal
