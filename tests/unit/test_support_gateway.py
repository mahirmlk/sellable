"""Phase 3: human-escalation cases (§26.3) and gateway delegation
enforcement (403 deny / 409 hold, legacy path untouched)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.agent_identity import AgentIdentity, AgentType
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    SupportCasePriority,
    SupportCaseStatus,
    SupportCategory,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.delegations import (
    ApprovalMode,
    DelegationGrant,
    OperationScope,
)
from sellable.gateway import (
    DelegationDeniedError,
    DelegationHoldError,
    enforce_delegation,
)
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.support import CaseError, build_escalation_payload


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


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def _grant(merchant: str, **overrides) -> DelegationGrant:
    base = {
        "principal_customer_id": "cust_1",
        "subject_agent_id": "agent_gw",
        "merchant_scope": merchant,
        "operation_scopes": [OperationScope.CHECKOUT_WRITE, OperationScope.CART_WRITE],
        "amount_limit_paise": 500_000,
        "expires_at": utc_now() + timedelta(hours=1),
    }
    base.update(overrides)
    return DelegationGrant(**base)


def _buyer_intent() -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_gw",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="gateway delegation test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


# --- Escalation payload and case lifecycle -------------------------------------


def test_escalation_payload_shape() -> None:
    trace_id = _trace()
    payload = build_escalation_payload(
        customer_summary="Customer was charged twice for one checkout.",
        issue_classification="billing",
        order_context={"order_id": "ord_1", "status": "PAID"},
        actions_attempted=["verified webhook deliveries", "checked idempotency keys"],
        policy_constraints=["order_state:PAID"],
        risk_flags=["FAILED_PAYMENTS_ELEVATED"],
        recommended_next_action="Issue a partial refund for the duplicate capture.",
        trace_id=trace_id,
    )
    dumped = payload.model_dump()
    for field in (
        "customer_summary",
        "issue_classification",
        "order_context",
        "actions_attempted",
        "policy_constraints",
        "risk_flags",
        "recommended_next_action",
    ):
        assert dumped[field]
    assert dumped["trace_id"] == trace_id


def test_escalate_flow_with_context_and_fanout(
    commerce_core: CommerceCore,
) -> None:
    core = commerce_core
    trace_id = _trace()
    case = core.escalate_support(
        trace_id=trace_id,
        customer_summary="Payment succeeded but checkout shows pending.",
        issue_classification="billing",
        recommended_next_action="Reconcile the provider payment and complete the checkout.",
        order_id="ord_missing_is_fine",
        category=SupportCategory.BILLING,
        priority=SupportCasePriority.HIGH,
        actions_attempted=["checked order status"],
        risk_flags=["NONE"],
    )
    assert case.status == SupportCaseStatus.ESCALATED
    assert case.context["escalation"]["issue_classification"] == "billing"
    assert case.context["escalation"]["trace_id"] == trace_id

    fetched = core.support_case_get(case.case_id)
    assert fetched.case_id == case.case_id
    assert len(core.support_cases_open()) == 1
    actions = [e.action for e in core.ledger.for_trace(trace_id)]
    assert "support.case.escalated" in actions

    from sellable.repositories import OutboxRepository

    outbox = OutboxRepository(engine=core.case_repo._engine)
    assert "support.case.updated" in [
        e.event_type for e in outbox.claim_unpublished(limit=50)
    ]


def test_case_lifecycle_and_isolation(commerce_core: CommerceCore) -> None:
    core = commerce_core
    case = core.case_service.open_case(
        core.merchant_scope, "Where is my order?", category=SupportCategory.ORDER_STATUS
    )
    assert core.case_service.begin_work(case.case_id, core.merchant_scope).status == (
        SupportCaseStatus.IN_PROGRESS
    )
    resolved = core.case_service.resolve(case.case_id, core.merchant_scope)
    assert resolved.status == SupportCaseStatus.RESOLVED
    assert core.support_cases_open() == []
    with pytest.raises(CaseError):
        core.case_service.begin_work(case.case_id, core.merchant_scope)
    with pytest.raises(Exception):
        core.support_case_get("case_missing")
    from sellable.support import CaseNotFoundError

    with pytest.raises(CaseNotFoundError):
        core.case_service.get_case(case.case_id, "mrc_other")


# --- Gateway enforcement (unit level) --------------------------------------------


def test_enforce_none_when_no_header(commerce_core: CommerceCore) -> None:
    assert (
        enforce_delegation(
            commerce_core,
            delegation_id=None,
            scope=OperationScope.CHECKOUT_WRITE,
            trace_id=_trace(),
            route="agent.orders.create",
        )
        is None
    )


def test_enforce_allow_deny_hold(commerce_core: CommerceCore) -> None:
    core = commerce_core
    merchant = core.merchant_scope
    trace_id = _trace()
    core.delegation_repo.save(_grant(merchant))
    decision = enforce_delegation(
        core,
        delegation_id=core.delegation_repo.active_for_agent(merchant, "agent_gw")[0].delegation_id,
        scope=OperationScope.CART_WRITE,
        trace_id=trace_id,
        route="agent.quotes.create",
    )
    assert decision is not None
    assert decision.outcome.value == "ALLOW"

    with pytest.raises(DelegationDeniedError) as denied:
        enforce_delegation(
            core,
            delegation_id="dlg_unknown",
            scope=OperationScope.CART_WRITE,
            trace_id=trace_id,
            route="agent.quotes.create",
        )
    assert denied.value.reason_code == "DELEGATION_UNKNOWN"

    hold_grant = _grant(merchant, approval_mode=ApprovalMode.REQUIRE_HUMAN)
    core.delegation_repo.save(hold_grant)
    with pytest.raises(DelegationHoldError) as held:
        enforce_delegation(
            core,
            delegation_id=hold_grant.delegation_id,
            scope=OperationScope.CART_WRITE,
            trace_id=trace_id,
            route="agent.quotes.create",
        )
    assert held.value.outcome == "REQUIRE_HUMAN"

    pay_grant = _grant(
        merchant, operation_scopes=[OperationScope.PAYMENT_AUTHORIZE]
    )
    core.delegation_repo.save(pay_grant)
    with pytest.raises(DelegationHoldError) as pay_held:
        enforce_delegation(
            core,
            delegation_id=pay_grant.delegation_id,
            scope=OperationScope.PAYMENT_AUTHORIZE,
            amount_paise=10_000,
            trace_id=trace_id,
            route="agent.consents.request",
        )
    assert pay_held.value.outcome == "REQUIRE_CUSTOMER"

    actions = [e.action for e in core.ledger.for_trace(trace_id)]
    assert "authorization.checked" in actions
    assert "authorization.denied" in actions
    assert "authorization.held" in actions


# --- Gateway enforcement (HTTP level) ----------------------------------------------


def _overridden_client(commerce_core: CommerceCore) -> TestClient:
    from sellable.agents.seller import SellerAgent
    from sellable.gateway import AgentGateway
    from sellable.main import app, get_agent_gateway, get_commerce

    gateway = AgentGateway(commerce_core, SellerAgent(commerce_core))
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    app.dependency_overrides[get_commerce] = lambda: commerce_core
    return TestClient(app)


def _order_body() -> dict:
    return {
        "intent": _buyer_intent().model_dump(mode="json"),
        "message": "I need coffee for my desk",
        "idempotency_key": f"idem_gw_{uuid4().hex}",
        "request_upsell": True,
    }


def test_quotes_route_rejects_bad_delegation(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _overridden_client(commerce_core)
    try:
        body = {
            "message": "I need coffee for my desk",
            "intent": _buyer_intent().model_dump(mode="json"),
        }
        denied = client.post(
            "/agent/quotes.create",
            json=body,
            headers={**H, "X-Delegation-Id": "dlg_unknown"},
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["detail"]["reason_code"] == "DELEGATION_UNKNOWN"

        hold_grant = _grant(
            commerce_core.merchant_scope, approval_mode=ApprovalMode.REQUIRE_HUMAN
        )
        commerce_core.delegation_repo.save(hold_grant)
        held = client.post(
            "/agent/quotes.create",
            json=body,
            headers={**H, "X-Delegation-Id": hold_grant.delegation_id},
        )
        assert held.status_code == 403, held.text
        assert held.json()["detail"]["outcome"] == "REQUIRE_HUMAN"
    finally:
        app.dependency_overrides.clear()


def test_orders_route_hold_and_allow(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    core = commerce_core
    hold_grant = _grant(core.merchant_scope, approval_mode=ApprovalMode.REQUIRE_HUMAN)
    core.delegation_repo.save(hold_grant)
    allow_grant = _grant(core.merchant_scope)
    core.delegation_repo.save(allow_grant)
    client = _overridden_client(core)
    try:
        held = client.post(
            "/agent/orders.create",
            json=_order_body(),
            headers={**H, "X-Delegation-Id": hold_grant.delegation_id},
        )
        assert held.status_code == 409, held.text
        assert held.json()["detail"]["outcome"] == "REQUIRE_HUMAN"

        allowed = client.post(
            "/agent/orders.create",
            json=_order_body(),
            headers={**H, "X-Delegation-Id": allow_grant.delegation_id},
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["status"] == "AWAITING_CONSENT"
    finally:
        app.dependency_overrides.clear()


def test_consents_route_rejects_revoked_delegation(
    commerce_core: CommerceCore,
) -> None:
    from sellable.main import app

    core = commerce_core
    mandate = CartMandate(
        intent_ref="im_gw",
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
        cart=mandate,
        intent=_buyer_intent(),
        trace_id=_trace(),
        idempotency_key=f"idem_gwcon_{uuid4().hex}",
    )
    grant = _grant(core.merchant_scope)
    core.delegation_repo.save(grant)
    core.delegation_repo.revoke(grant.delegation_id, core.merchant_scope)
    client = _overridden_client(core)
    try:
        denied = client.post(
            "/agent/consents.request",
            json={"order_id": order.order_id},
            headers={**H, "X-Delegation-Id": grant.delegation_id},
        )
        assert denied.status_code == 403, denied.text

        missing = client.post(
            "/agent/consents.request",
            json={"order_id": "ord_nope"},
            headers={**H, "X-Delegation-Id": grant.delegation_id},
        )
        assert missing.status_code == 409
    finally:
        app.dependency_overrides.clear()
