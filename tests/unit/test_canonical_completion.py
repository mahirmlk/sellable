"""Canonical API completion (§42): delegation lifecycle, agent registry,
identity sessions, and the remaining canonical commerce reads — end to end
over HTTP with an isolated per-test database."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.config import Settings
from sellable.contracts import utc_now
from sellable.ledger import database as ledger_database
from sellable.ledger.service import LedgerRepository
from sellable.protocols.identity import IdentityLinkService
from sellable.protocols.sessions import ProtocolSessionService
from sellable.registry import DEMO_MERCHANT_ID, MerchantRegistry
from sellable.repositories import ProtocolSessionRepository

import sellable.repositories as repositories_mod


AGENT_KEY = "sellable_demo_key_001"
H = {"X-Agent-Key": AGENT_KEY}


@pytest.fixture
def env(monkeypatch, tmp_path):
    db_path = tmp_path / "canonical_completion.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)
    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", registry)
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    core = registry.get(DEMO_MERCHANT_ID)
    # Module-level services were built against the import-time engine; rebind
    # them to the isolated engine so identity/session routes stay isolated.
    monkeypatch.setattr(
        main_module, "identity_service", IdentityLinkService(core.identity_repo)
    )
    monkeypatch.setattr(
        main_module,
        "session_service",
        ProtocolSessionService(ProtocolSessionRepository(engine=engine)),
    )
    session = merchant_auth.MerchantSession(
        merchant_id=DEMO_MERCHANT_ID, role="owner", auth_user_id="user_cc"
    )
    main_module.app.dependency_overrides[
        merchant_auth.get_merchant_session
    ] = lambda: session
    main_module.app.dependency_overrides[
        merchant_auth.get_authenticated_user
    ] = lambda: user_stub()
    try:
        with TestClient(main_module.app) as client:
            yield client, core
    finally:
        main_module.app.dependency_overrides.clear()


def user_stub():
    return merchant_auth.AuthenticatedUser(auth_user_id="user_cc")


def _delegation_body(**overrides) -> dict:
    body: dict = {
        "principal_customer_id": "cust_deleg_1",
        "subject_agent_id": "buyer_demo_01",
        "operation_scopes": ["cart:write", "checkout:write"],
        "amount_limit_paise": 500_000,
        "expires_at": (utc_now() + timedelta(hours=2)).isoformat(),
    }
    body.update(overrides)
    return body


# --- Delegation lifecycle (§14, §42) -------------------------------------------


def test_delegation_create_list_get_revoke(env) -> None:
    client, core = env
    created = client.post(
        "/v1/delegations",  # /v1 alias must reach the canonical route
        json=_delegation_body(),
    )
    assert created.status_code == 200, created.text
    grant = created.json()
    assert grant["merchant_scope"] == DEMO_MERCHANT_ID
    assert grant["status"] == "ACTIVE"

    listed = client.get("/delegations", params={"customer_id": "cust_deleg_1"})
    assert listed.status_code == 200
    assert [g["delegation_id"] for g in listed.json()] == [grant["delegation_id"]]

    fetched = client.get(f"/delegations/{grant['delegation_id']}", headers=H)
    assert fetched.status_code == 200
    assert fetched.json()["delegation_id"] == grant["delegation_id"]

    foreign = client.get("/delegations/dlg_missing", headers=H)
    assert foreign.status_code == 404

    revoked = client.post(f"/delegations/{grant['delegation_id']}/revoke")
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "REVOKED"

    actions = [
        e.action
        for e in core.ledger.for_merchant(DEMO_MERCHANT_ID, limit=50)
    ] if hasattr(core.ledger, "for_merchant") else []
    assert revoked.json()["status"] == "REVOKED"


def test_delegation_create_rejects_invalid_scopes(env) -> None:
    client, _ = env
    bad = client.post(
        "/delegations",
        json=_delegation_body(operation_scopes=["not:a:scope"]),
    )
    assert bad.status_code == 400


# --- Agent registry (§13, §42) --------------------------------------------------


def test_agent_register_get_reputation_rotate(env) -> None:
    client, core = env
    registered = client.post(
        "/agents/register",
        json={
            "agent_type": "CUSTOMER_AGENT",
            "issuer": "https://agents.example.com",
            "client_id": "client_123",
            "capability_profile": "ucp-1",
        },
    )
    assert registered.status_code == 200, registered.text
    agent_id = registered.json()["agent_id"]
    assert registered.json()["owner_id"] == DEMO_MERCHANT_ID

    fetched = client.get(f"/agents/{agent_id}")
    assert fetched.status_code == 200
    assert fetched.json()["credential_status"] == "ACTIVE"

    reputation = client.get(f"/agents/{agent_id}/reputation")
    assert reputation.status_code == 200
    assert reputation.json()["has_history"] is False

    rotated = client.post(
        f"/agents/{agent_id}/credentials/rotate", json={"credential_ttl_hours": 48}
    )
    assert rotated.status_code == 200
    assert rotated.json()["credential_status"] == "ACTIVE"
    assert rotated.json()["credential_expires_at"] > utc_now().isoformat()

    missing = client.get("/agents/agent_does_not_exist")
    assert missing.status_code == 404


# --- Identity sessions (§12.1, §15.3) --------------------------------------------


def test_identity_session_from_linked_link(env) -> None:
    client, core = env
    link, code = main_module.identity_service.create_link(
        DEMO_MERCHANT_ID, "cust_sess_1", agent_id="buyer_demo_01"
    )
    approved = main_module.identity_service.approve_link(
        link.link_id, DEMO_MERCHANT_ID, link_code=code
    )
    assert approved.status.value == "LINKED"

    issued = client.post("/identity/sessions", json={"link_id": link.link_id}, headers=H)
    assert issued.status_code == 200, issued.text
    body = issued.json()
    assert body["active_capabilities"], "session must carry negotiated capabilities"
    assert body["auth_context"]["agent_identity"]["customer_id"] == "cust_sess_1"

    pending_link, _ = main_module.identity_service.create_link(
        DEMO_MERCHANT_ID, "cust_sess_2"
    )
    pending = client.post(
        "/identity/sessions", json={"link_id": pending_link.link_id}, headers=H
    )
    assert pending.status_code == 409


# --- Commerce reads and cancel-request (§42) -------------------------------------


def _cart_and_checkout(core) -> tuple[str, str]:
    cart = core.create_cart(trace_id=_trace(), customer_id="cust_read_1")
    updated = core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=cart.version, trace_id=_trace()
    )
    core.cart_start_checkout(
        updated.cart_id, expected_version=updated.version, trace_id=_trace()
    )
    checkout = core.create_checkout(updated.cart_id, trace_id=_trace())
    return updated.cart_id, checkout.checkout_id


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def test_cart_and_checkout_reads(env) -> None:
    client, core = env
    cart_id, checkout_id = _cart_and_checkout(core)
    cart = client.get(f"/carts/{cart_id}", headers=H)
    assert cart.status_code == 200
    assert cart.json()["cart_id"] == cart_id
    checkout = client.get(f"/checkouts/{checkout_id}", headers=H)
    assert checkout.status_code == 200
    assert checkout.json()["checkout_id"] == checkout_id
    missing = client.get("/carts/cart_missing", headers=H)
    assert missing.status_code == 404


def test_order_cancel_request_aborts_unpaid_only(env) -> None:
    client, core = env
    from sellable.contracts import IntentMandate, CartMandate, CartItem

    order = core.create_order(
        cart=CartMandate(
            intent_ref="im_cancel",
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
        ),
        intent=IntentMandate(
            buyer_agent_id="buyer_demo_01",
            budget_ceiling_paise=200_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="cancel-request test",
            expires_at=utc_now() + timedelta(minutes=10),
        ),
        trace_id=_trace(),
        idempotency_key=f"idem_cancel_{uuid4().hex}",
    )
    cancelled = client.post(
        f"/orders/{order.order_id}/cancel-request",
        json={"reason": "changed mind"},
        headers=H,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "ABORTED"

    # Settled orders stay merchant-owned.
    settled = core.create_order(
        cart=CartMandate(
            intent_ref="im_cancel2",
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
        ),
        intent=IntentMandate(
            buyer_agent_id="buyer_demo_01",
            budget_ceiling_paise=200_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="cancel-request settled test",
            expires_at=utc_now() + timedelta(minutes=10),
        ),
        trace_id=_trace(),
        idempotency_key=f"idem_cancel2_{uuid4().hex}",
    )
    consent = core.issue_consent(settled.order_id)
    core.consume_consent(consent.consent_id, order_id=settled.order_id)
    core.mark_payment_pending(settled.order_id)
    core.mark_paid(settled.order_id, provider_ref="pay_cancel_test")
    refused = client.post(
        f"/orders/{settled.order_id}/cancel-request", json={}, headers=H
    )
    assert refused.status_code == 409


def test_timeline_refund_case_promotion_tracking(env) -> None:
    client, core = env
    from sellable.contracts import CartMandate, CartItem, IntentMandate

    order = core.create_order(
        cart=CartMandate(
            intent_ref="im_timeline",
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
        ),
        intent=IntentMandate(
            buyer_agent_id="buyer_demo_01",
            budget_ceiling_paise=200_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="timeline test",
            expires_at=utc_now() + timedelta(minutes=10),
        ),
        trace_id=_trace(),
        idempotency_key=f"idem_timeline_{uuid4().hex}",
    )
    timeline = client.get(f"/orders/{order.order_id}/timeline", headers=H)
    assert timeline.status_code == 200
    body = timeline.json()
    assert body["trace_id"] == order.trace_id
    assert any(e["action"] == "order.created" for e in body["events"])

    missing_refund = client.get("/refunds/ref_missing", headers=H)
    assert missing_refund.status_code == 404
    missing_case = client.get("/support/cases/case_missing", headers=H)
    assert missing_case.status_code == 404
    missing_promotion = client.get("/promotions/prm_missing", headers=H)
    assert missing_promotion.status_code == 404
    missing_tracking = client.get("/shipping/ff_missing", headers=H)
    assert missing_tracking.status_code == 404
