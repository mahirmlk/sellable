"""Integration tests — test the full API + commerce core stack."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.main import app, get_agent_gateway, get_seller_agent
from sellable.agents.seller import SellerAgent, SellerRequest
from sellable.gateway import AgentGateway


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def test_full_quote_to_ledger_flow(commerce_core: CommerceCore) -> None:
    """End-to-end: seller agent → policy → ledger trace."""
    agent = SellerAgent(commerce_core)
    request = SellerRequest(
        message="I need coffee for my desk",
        intent=IntentMandate(
            buyer_agent_id="buyer_integration_test",
            budget_ceiling_paise=200_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="Buy coffee",
            expires_at=utc_now() + timedelta(minutes=10),
        ),
    )
    result = agent.respond(request)

    assert result.cart is not None
    assert result.policy_decision is not None
    events = commerce_core.ledger.for_trace(result.trace_id)
    actions = [e.action for e in events]
    assert "catalog.search" in actions
    assert "quote.created" in actions
    assert "policy.checked" in actions


def test_agent_gateway_discovery_endpoint(commerce_core: CommerceCore) -> None:
    """GET /.well-known/agents.json returns valid manifest."""
    agent = SellerAgent(commerce_core)
    gateway = AgentGateway(commerce_core, agent)
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    try:
        with TestClient(app) as client:
            response = client.get("/.well-known/agents.json")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    manifest = response.json()
    assert "merchant_id" in manifest
    assert "capabilities" in manifest
    assert "catalog.search" in manifest["capabilities"]


def test_catalog_search_endpoint(commerce_core: CommerceCore) -> None:
    """POST /agent/catalog.search returns products."""
    agent = SellerAgent(commerce_core)
    gateway = AgentGateway(commerce_core, agent)
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    try:
        with TestClient(app) as client:
            response = client.post(
                "/agent/catalog.search",
                json={"query": "coffee", "categories": []},
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    products = response.json()
    assert len(products) > 0
    assert any("COFFEE" in p["sku"] for p in products)


def test_quote_create_endpoint(commerce_core: CommerceCore) -> None:
    """POST /agent/quotes.create returns a policy-evaluated decision."""
    agent = SellerAgent(commerce_core)
    gateway = AgentGateway(commerce_core, agent)
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    intent = IntentMandate(
        buyer_agent_id="buyer_integration_test",
        budget_ceiling_paise=200_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy coffee",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/agent/quotes.create",
                json={
                    "message": "I need coffee",
                    "intent": intent.model_dump(mode="json"),
                    "request_upsell": False,
                },
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    decision = response.json()
    assert decision["action"] in ("QUOTE_READY", "COUNTERED", "DENIED", "NO_MATCH")
