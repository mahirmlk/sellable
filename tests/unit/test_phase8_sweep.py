"""Residue sweep: versioning, delegation bounds, receipts, bot abuse,
privacy, replay, metrics, readiness."""

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
        buyer_agent_id="buyer_sweep",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="sweep test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _grant(core: CommerceCore, **overrides):
    base = {
        "principal_customer_id": "cust_sweep",
        "subject_agent_id": "agent_sweep",
        "merchant_scope": core.merchant_scope,
        "operation_scopes": [OperationScope.CHECKOUT_WRITE, OperationScope.CART_WRITE],
        "amount_limit_paise": 500_000,
        "expires_at": utc_now() + timedelta(hours=1),
    }
    base.update(overrides)
    grant = DelegationGrant(**base)
    core.delegation_repo.save(grant)
    return grant


def _mandate(total: int = 69_900) -> CartMandate:
    return CartMandate(
        intent_ref="im_sweep",
        items=[
            CartItem(
                sku="AUDIO-CASE-01", quantity=1,
                unit_price_paise=69_900, offered_price_paise=total,
            )
        ],
        subtotal_paise=69_900, discount_paise=69_900 - total, total_paise=total,
        negotiation_round=0,
    )


# --- Delegation bounds ---------------------------------------------------------------------


def test_category_scope_enforced(commerce_core: CommerceCore) -> None:
    core = commerce_core
    grant = _grant(core, category_scopes=["accessories"])
    assert grant.covers(
        OperationScope.CART_WRITE, merchant_id=core.merchant_scope,
        categories=["accessories"],
    ) is True
    assert grant.covers(
        OperationScope.CART_WRITE, merchant_id=core.merchant_scope,
        categories=["gifting"],
    ) is False
    # Unscoped grants still cover everything (opt-in restriction).
    open_grant = _grant(core)
    assert open_grant.covers(
        OperationScope.CART_WRITE, merchant_id=core.merchant_scope,
        categories=["gifting"],
    ) is True
    # End to end: gifting categories denied under an accessories-only grant.
    decision = core.authorization_service.authorize(
        delegation_id=grant.delegation_id,
        scope=OperationScope.CHECKOUT_WRITE,
        merchant_id=core.merchant_scope,
        amount_paise=10_000,
        categories=["gifting"],
    )
    assert decision.outcome.value == "DENY"
    assert decision.reason_code == "CATEGORY_SCOPE_MISMATCH"


def test_frequency_limit_enforced(commerce_core: CommerceCore) -> None:
    core = commerce_core
    grant = _grant(core, frequency_limit=1)
    first = core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=_trace(),
        idempotency_key=f"idem_freq1_{uuid4().hex}",
        delegation_id=grant.delegation_id,
    )
    assert first.status.value == "AWAITING_CONSENT"
    with pytest.raises(ValueError, match="FREQUENCY_LIMIT_EXCEEDED"):
        core.create_order(
            cart=_mandate(), intent=_intent(), trace_id=_trace(),
            idempotency_key=f"idem_freq2_{uuid4().hex}",
            delegation_id=grant.delegation_id,
        )


# --- Receipt ---------------------------------------------------------------------------------


def test_payment_receipt_binds_evidence(commerce_core: CommerceCore) -> None:
    core = commerce_core
    order = core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=_trace(),
        idempotency_key=f"idem_rcpt_{uuid4().hex}",
    )
    with pytest.raises(ValueError, match="settled"):
        core.payment_receipt(order.order_id)
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_rcpt_9")
    receipt = core.payment_receipt(order.order_id)
    assert receipt.order_id == order.order_id
    assert receipt.amount_paise == order.amount_paise
    assert receipt.currency == "INR"
    assert receipt.authorization_reference == consent.consent_id
    assert receipt.trace_id == order.trace_id
    assert receipt.provider_reference == "pay_rcpt_9"


# --- Bot abuse ----------------------------------------------------------------------------------


def test_cart_burst_steps_up(commerce_core: CommerceCore) -> None:
    core = commerce_core
    for _ in range(10):
        core.create_cart(trace_id=_trace())
    assessment = core.risk_service.assess(
        merchant_id=core.merchant_scope,
        amount_paise=10_000,
        subject_id="cust_burst",
    )
    assert assessment.level.value == "STEP_UP_AUTH"
    assert "BOT_CART_ELEVATED" in assessment.reasons


# --- Privacy ----------------------------------------------------------------------------------------


def test_pii_scrubbed_on_case_paths(commerce_core: CommerceCore) -> None:
    from sellable.privacy import redact_pii, scrub_mapping

    assert redact_pii("mail me at jane@example.com please") == (
        "mail me at [redacted-email] please"
    )
    assert redact_pii("call +1 415-555-0132") == "call [redacted-phone]"
    assert redact_pii("no identifiers here") == "no identifiers here"
    assert redact_pii(None) is None
    scrubbed = scrub_mapping({"reason": "my card 4111 1111 1111 1111 failed", "sku": "X"})
    assert scrubbed["reason"] == "my card [redacted-card] failed"
    assert scrubbed["sku"] == "X"

    case = commerce_core.case_service.open_case(
        commerce_core.merchant_scope,
        "Contact jane@example.com about order",
    )
    # Service-level open is raw; agent/core ingress scrubs (assert the tool path).
    from agents.seller.agent import SellerAgent

    tools = SellerAgent(commerce_core).tools
    created = tools.service_create_case(
        summary="Email jane@example.com ASAP", trace_id=_trace()
    )
    fetched = commerce_core.case_service.get_case(
        created.case_id, commerce_core.merchant_scope
    )
    assert fetched is not None
    assert "jane@example.com" not in fetched.summary
    assert "[redacted-email]" in fetched.summary
    _ = case


# --- New tools -----------------------------------------------------------------------------------------


def test_seller_cart_quote_checkout_tools(commerce_core: CommerceCore) -> None:
    from agents.seller.agent import SellerAgent

    core = commerce_core
    tools = SellerAgent(core).tools
    trace_id = _trace()
    cart = tools.cart_create(trace_id=trace_id)
    cart = tools.cart_add_item(
        cart_id=cart.cart_id, sku="AUDIO-CASE-01", quantity=1,
        expected_version=1, trace_id=trace_id,
    )
    assert cart.grand_total_paise == 69_900
    fetched = tools.cart_get(cart_id=cart.cart_id, trace_id=trace_id)
    assert fetched.cart_id == cart.cart_id
    quote = core.create_quote(cart.cart_id, trace_id=trace_id)
    refreshed = tools.quote_refresh(quote_id=quote.quote_id, trace_id=trace_id)
    assert refreshed.quote_id == quote.quote_id
    locked = core.cart_start_checkout(cart.cart_id, expected_version=2, trace_id=trace_id)
    assert locked.status.value == "CHECKOUT_STARTED"
    checkout = tools.checkout_create(cart_id=cart.cart_id, trace_id=trace_id)
    assert checkout.cart_id == cart.cart_id
    status = tools.checkout_get(checkout_id=checkout.checkout_id, trace_id=trace_id)
    assert status.status.value == "CREATED"
    approval = tools.checkout_request_approval(
        checkout_id=checkout.checkout_id, trace_id=trace_id
    )
    assert approval["checkout_id"] == checkout.checkout_id


def test_cs_profile_permissions_reads(commerce_core: CommerceCore) -> None:
    from agents.customer_service.agent import CustomerServiceAgent

    core = commerce_core
    grant = _grant(core)
    agent = CustomerServiceAgent(core)
    auth = agent.tools.customer_authenticate(
        customer_id="cust_sweep", trace_id=_trace()
    )
    assert auth.tier.value == "AUTHENTICATED"
    profile = agent.tools.customer_get_profile(auth=auth, trace_id=_trace())
    assert profile["customer_id"] == "cust_sweep"
    assert "checkout:write" in profile["delegation_scopes"]
    assert profile["linked_agents"] == ["agent_sweep"]
    permissions = agent.tools.customer_get_permissions(auth=auth, trace_id=_trace())
    assert permissions["active_delegations"] == 1
    estimate = agent.tools.shipping_estimate(
        pincode="560001", auth=auth, trace_id=_trace()
    )
    assert estimate["serviceable"] is True
    assert estimate["method"] == "pickup"  # cheapest serviceable option
    assert estimate["price_paise"] == 0
    case = agent.tools.case_create(
        summary="test case", trace_id=_trace(), customer_id="cust_sweep"
    )
    updated = agent.tools.case_update(
        case_id=case.case_id, trace_id=_trace(), begin_work=True
    )
    assert updated.status.value == "IN_PROGRESS"
    with pytest.raises(ValueError, match="exactly one"):
        agent.tools.case_update(case_id=case.case_id, trace_id=_trace())
    _ = grant


# --- Replay / metrics / readiness / versioning ----------------------------------------------------------------


def test_replay_reconstruction(commerce_core: CommerceCore) -> None:
    from sellable.replay import build_replay

    core = commerce_core
    trace_id = _trace()
    order = core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=trace_id,
        idempotency_key=f"idem_replay_{uuid4().hex}",
    )
    replay = build_replay(trace_id, core.merchant_scope, ledger=core.ledger)
    assert replay["order_id"] == order.order_id
    sections = [s["section"] for s in replay["sections"]]
    assert "cart" in sections
    assert "policy" in sections
    assert "order" in sections
    assert replay["event_count"] >= 3
    empty = build_replay(f"trc_{uuid4().hex}", core.merchant_scope, ledger=core.ledger)
    assert empty["sections"] == []
    assert empty["order_id"] is None


def test_metrics_rollups(commerce_core: CommerceCore) -> None:
    from sellable.metrics import agent_metrics, commerce_metrics
    from sellable.repositories import AnalyticsRepository, ObservabilityRepository

    core = commerce_core
    order = core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=_trace(),
        idempotency_key=f"idem_met_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_met_1")

    engine = core.outbox_repo._engine
    agent = agent_metrics(
        observability_repo=ObservabilityRepository(engine=engine),
        ledger=core.ledger,
        merchant_id=core.merchant_scope,
    )
    assert set(agent) == {"window_days", "runs", "reliability", "quality", "economics", "safety"}
    assert agent["runs"] == 0

    commerce = commerce_metrics(
        analytics_repo=AnalyticsRepository(engine=engine),
        promotion_repo=core.promotion_repo,
        merchant_id=core.merchant_scope,
    )
    assert commerce["orders_paid"] == 0  # analytics ingests via bus, not inline
    assert commerce["discount_leakage_bps"] == 0


def test_versioned_routes_and_ready() -> None:
    import sellable.main as main_module
    from fastapi.testclient import TestClient

    main_module.app.dependency_overrides.clear()
    client = TestClient(main_module.app)
    try:
        manifest = client.get("/v1/.well-known/agents.json")
        assert manifest.status_code == 200
        ucp = client.get("/v1/.well-known/ucp")
        assert ucp.status_code == 200
        ready = client.get("/ready")
        assert ready.status_code in (200, 503)
        assert "checks" in ready.json()
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()


def test_provider_currency_mismatch_aborts(commerce_core: CommerceCore) -> None:
    from sellable.config import Settings
    from sellable.payments.razorpay import RazorpayAdapter
    from sellable.payments.service import PaymentService

    class WrongCurrencyLinks:
        def create(self, data: dict) -> dict:
            return {
                "id": "plink_fx_01",
                "short_url": "https://rzp.io/i/fx",
                "amount": data["amount"],
                "currency": "USD",
                "status": "created",
                "order_id": "order_razorpay_test_01",
            }

        def cancel(self, link_id: str) -> None:
            return None

    class WrongCurrencyClient:
        def __init__(self) -> None:
            from test_payments import FakeRazorpayOrders, FakeRazorpayUtility

            self.order = FakeRazorpayOrders()
            self.payment_link = WrongCurrencyLinks()
            self.utility = FakeRazorpayUtility()

    settings = Settings(
        environment="test",
        razorpay_key_id="rzp_test_x",
        razorpay_key_secret="s",
        razorpay_webhook_secret="w",
    )
    service = PaymentService(
        commerce_core, RazorpayAdapter(settings, client=WrongCurrencyClient())
    )
    order = commerce_core.create_order(
        cart=_mandate(), intent=_intent(), trace_id=_trace(),
        idempotency_key=f"idem_fx_{uuid4().hex}",
    )
    consent = commerce_core.issue_consent(order.order_id)
    from sellable.contracts import OrderStatus
    from sellable.payments.razorpay import RazorpayRequestError

    with pytest.raises(RazorpayRequestError, match="amount or currency"):
        service.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    assert commerce_core.get_order(order.order_id).status == OrderStatus.PAYMENT_FAILED
