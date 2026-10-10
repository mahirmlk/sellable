"""Phase 5: canonical /commerce/* API, MCP/A2A/UCP surfaces, and
session-gated enforcement — end to end over HTTP."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


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


def _client(commerce_core: CommerceCore) -> TestClient:
    from sellable.agents.seller import SellerAgent
    from sellable.gateway import AgentGateway
    from sellable.main import app, get_agent_gateway, get_commerce

    gateway = AgentGateway(commerce_core, SellerAgent(commerce_core))
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    app.dependency_overrides[get_commerce] = lambda: commerce_core
    return TestClient(app)


def _intent() -> dict:
    return IntentMandate(
        buyer_agent_id="buyer_proto",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="protocol test",
        expires_at=utc_now() + timedelta(minutes=10),
    ).model_dump(mode="json")


# --- Discovery -------------------------------------------------------------------------------


def test_discovery_surfaces(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        ucp = client.get("/.well-known/ucp")
        assert ucp.status_code == 200, ucp.text
        doc = ucp.json()
        assert doc["merchant"]["id"] == commerce_core.merchant_scope
        assert "rest" in doc["protocols"]
        assert doc["identity_linking"]["supported"] is True

        profile = client.get("/agent/profile")
        assert profile.status_code == 200
        assert len(profile.json()["agents"]) == 2

        caps = client.get("/agent/capabilities")
        assert caps.status_code == 200
        ids = {c["capability_id"] for c in caps.json()["capabilities"]}
        assert "checkout.authorize" in ids
    finally:
        app.dependency_overrides.clear()


# --- Full canonical flow ---------------------------------------------------------------------------


def test_canonical_commerce_flow(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        search = client.post(
            "/commerce/search", json={"query": "coffee"}, headers=H
        )
        assert search.status_code == 200, search.text
        assert search.json()

        lookup = client.post(
            "/commerce/catalog/lookup", json={"sku": "AUDIO-CASE-01"}, headers=H
        )
        assert lookup.status_code == 200
        assert lookup.json()["sku"] == "AUDIO-CASE-01"

        reco = client.post(
            "/commerce/recommendations", json={"sku": "AUDIO-CASE-01"}, headers=H
        )
        assert reco.status_code == 200

        cart = client.post("/commerce/cart", json={}, headers=H)
        assert cart.status_code == 200, cart.text
        cart_id = cart.json()["cart_id"]

        add = client.post(
            "/commerce/cart/items",
            json={
                "cart_id": cart_id,
                "op": "add",
                "sku": "AUDIO-CASE-01",
                "quantity": 1,
                "expected_version": 1,
            },
            headers=H,
        )
        assert add.status_code == 200, add.text
        assert add.json()["version"] == 2

        quote = client.post("/commerce/quotes", json={"cart_id": cart_id}, headers=H)
        assert quote.status_code == 200, quote.text
        quote_id = quote.json()["quote_id"]

        neg = client.post(
            "/commerce/quotes/negotiate",
            json={"quote_id": quote_id, "proposed_total_paise": 65_000},
            headers=H,
        )
        assert neg.status_code == 200, neg.text
        assert neg.json()["outcome"] == "ACCEPTED"

        promo = client.post(
            "/commerce/promotions/evaluate", json={"cart_id": cart_id}, headers=H
        )
        assert promo.status_code == 200, promo.text

        checkout = client.post(
            "/commerce/checkout", json={"cart_id": cart_id}, headers=H
        )
        assert checkout.status_code == 200, checkout.text
        checkout_id = checkout.json()["checkout_id"]

        authorized = client.post(
            "/commerce/checkout/authorize",
            json={
                "checkout_id": checkout_id,
                "merchant_state": "KA",
                "customer_state": "KA",
                "shipping_method": "standard",
                "pincode": "560001",
            },
            headers=H,
        )
        assert authorized.status_code == 200, authorized.text
        assert authorized.json()["status"] == "AUTHORIZED"
        assert authorized.json()["grand_total_paise"] == 69_900 + 12_582 + 4_900

        order = client.post(
            "/commerce/orders",
            json={
                "checkout_id": checkout_id,
                "intent": _intent(),
                "idempotency_key": f"idem_canon_{uuid4().hex}",
            },
            headers=H,
        )
        assert order.status_code == 200, order.text
        order_id = order.json()["order_id"]

        fetched = client.get(f"/commerce/orders/{order_id}", headers=H)
        assert fetched.status_code == 200
        assert fetched.json()["status"] == "AWAITING_CONSENT"
    finally:
        app.dependency_overrides.clear()


# --- Session gating -------------------------------------------------------------------------------


def test_session_gates_unnegotiated_capability(
    commerce_core: CommerceCore,
) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        neg = client.post(
            "/commerce/sessions/negotiate",
            json={
                "agent_id": "agent_ext_9",
                "protocol": "ucp",
                "capabilities": ["catalog.search"],
            },
            headers=H,
        )
        assert neg.status_code == 200, neg.text
        session_id = neg.json()["session_id"]
        assert neg.json()["active_capabilities"] == ["catalog.search"]

        ok = client.post(
            "/commerce/search",
            json={"query": "coffee"},
            headers={**H, "X-Session-Id": session_id},
        )
        assert ok.status_code == 200

        denied = client.post(
            "/commerce/cart", json={},
            headers={**H, "X-Session-Id": session_id},
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["detail"]["reason_code"] == "CAPABILITY_NOT_NEGOTIATED"

        fetched = client.get(f"/commerce/sessions/{session_id}", headers=H)
        assert fetched.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_delegation_deny_at_canonical_layer(
    commerce_core: CommerceCore,
) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        denied = client.post(
            "/commerce/cart", json={},
            headers={**H, "X-Delegation-Id": "dlg_unknown"},
        )
        assert denied.status_code == 403, denied.text
    finally:
        app.dependency_overrides.clear()


# --- Post-purchase + identity over HTTP ---------------------------------------------------------------


def test_returns_refunds_cases_identity_http(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    core = commerce_core
    client = _client(core)
    try:
        link = client.post(
            "/commerce/identity/link",
            json={"customer_id": "cust_http", "agent_id": "agent_ext_9"},
            headers=H,
        )
        assert link.status_code == 200, link.text
        link_id = link.json()["link_id"]
        code = link.json()["link_code"]

        me_before = client.get(
            "/commerce/identity/me", params={"link_id": link_id}, headers=H
        )
        assert me_before.status_code == 404

        approved = client.post(
            "/commerce/identity/link/approve",
            json={"link_id": link_id, "link_code": code},
            headers=H,
        )
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "LINKED"

        me = client.get(
            "/commerce/identity/me", params={"link_id": link_id}, headers=H
        )
        assert me.status_code == 200
        assert me.json()["customer_id"] == "cust_http"

        case = client.post(
            "/commerce/support/cases",
            json={"summary": "Where is my order?"},
            headers=H,
        )
        assert case.status_code == 200, case.text
        assert case.json()["case_id"].startswith("case_")
    finally:
        app.dependency_overrides.clear()


# --- MCP / A2A / UCP -------------------------------------------------------------------------------------


def test_mcp_bridge(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        tools = client.get("/mcp/tools", headers=H)
        assert tools.status_code == 200, tools.text
        names = {t["name"] for t in tools.json()}
        assert "catalog_search" in names
        assert "checkout_authorize" in names

        result = client.post(
            "/mcp/call",
            json={"tool": "catalog_lookup", "arguments": {"sku": "AUDIO-CASE-01"}},
            headers=H,
        )
        assert result.status_code == 200, result.text
        assert result.json()["result"]["sku"] == "AUDIO-CASE-01"

        unknown = client.post(
            "/mcp/call", json={"tool": "nope", "arguments": {}}, headers=H
        )
        assert unknown.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_a2a_bridge(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        card = client.get("/a2a/card")
        assert card.status_code == 200
        assert {a["actor"] for a in card.json()["actors"]} == {"seller", "service"}

        task = client.post(
            "/a2a/tasks",
            json={
                "actor": "seller",
                "input": {
                    "message": "I need coffee for my desk",
                    "intent": _intent(),
                },
            },
            headers=H,
        )
        assert task.status_code == 200, task.text
        assert task.json()["decision"]["action"] == "QUOTE_READY"

        service_task = client.post(
            "/a2a/tasks",
            json={
                "actor": "service",
                "input": {"message": "what is your discount policy?"},
            },
            headers=H,
        )
        assert service_task.status_code == 200, service_task.text
        assert service_task.json()["decision"]["action"] == "ANSWERED"

        unknown = client.post(
            "/a2a/tasks", json={"actor": "ghost", "input": {}}, headers=H
        )
        assert unknown.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_ucp_negotiate(commerce_core: CommerceCore) -> None:
    from sellable.main import app

    client = _client(commerce_core)
    try:
        neg = client.post(
            "/ucp/negotiate",
            json={
                "agent_id": "agent_ucp_1",
                "protocol": "ucp",
                "capabilities": ["catalog.search", "orders.read"],
            },
            headers={**H, "X-Protocol": "ucp"},
        )
        assert neg.status_code == 200, neg.text
        assert neg.json()["protocol"] == "ucp"
        assert neg.json()["active_capabilities"] == ["catalog.search", "orders.read"]
    finally:
        app.dependency_overrides.clear()
