"""Tests for the backend-driven /agents/status semantics.

The status endpoint must reflect real configuration state — never hardcoded
green. These tests lock in the CONNECTED / UNCONFIGURED / DEGRADED / ERROR
semantics for the mock and unconfigured-LLM cases.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from sellable.config import Settings
from sellable.main import app

import sellable.merchant_auth as merchant_auth
import sellable.status as status_module

DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


def _fake_settings(**overrides) -> SimpleNamespace:
    base = {
        "environment": "development",
        "llm_provider": "mock",
        "llm_model": None,
        "llm_is_configured": True,
        "llm_api_key": None,
        "agent_api_key_hashes": (),
        "razorpay_is_configured": False,
        "razorpay_webhook_secret": None,
        "database_url": "postgresql+psycopg://example:5432/db",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Hermetic demo-mode merchant session so the console endpoints accept the
    # demo X-Agent-Key, exactly like the existing dashboard-alias tests.
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    # Each test mutates status settings; drop cached snapshots so one test's
    # payload can never leak into another's assertions.
    status_module._status_snapshots.clear()
    with TestClient(app) as c:
        yield c
    status_module._status_snapshots.clear()


def test_status_requires_merchant_auth(client: TestClient) -> None:
    assert client.get("/agents/status").status_code == 401


def test_status_mock_provider_reports_connected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(status_module, "settings", _fake_settings())
    response = client.get("/agents/status", headers=DEMO_H)
    assert response.status_code == 200
    body = response.json()
    for key in ("seller_agent", "buyer_agent", "agent_gateway", "policy_engine", "ledger"):
        assert body[key]["state"] == "CONNECTED", body[key]
    assert body["llm"]["state"] == "CONNECTED"
    assert body["llm"]["status"] == "scripted"
    assert body["llm"]["provider"] == "mock"
    assert body["payment_rail"]["state"] == "UNCONFIGURED"


def test_status_opencode_without_key_reports_unconfigured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        status_module,
        "settings",
        _fake_settings(
            llm_provider="opencode",
            llm_model="mimo-v2.5-free",
            llm_is_configured=False,
            llm_api_key=None,
        ),
    )
    response = client.get("/agents/status", headers=DEMO_H)
    assert response.status_code == 200
    body = response.json()
    assert body["llm"]["state"] == "UNCONFIGURED"
    assert body["llm"]["model"] == "mimo-v2.5-free"
    assert body["llm"]["reason"] == "LLM_API_KEY missing"
    # The seller agent still runs on the deterministic runtime but is not "online".
    assert body["seller_agent"]["state"] == "DEGRADED"


def test_status_buyer_agent_unconfigured_when_auth_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        status_module,
        "settings",
        _fake_settings(
            environment="production",
            agent_api_key_hashes=(),
        ),
    )
    response = client.get("/agents/status", headers=DEMO_H)
    assert response.status_code == 200
    assert response.json()["buyer_agent"]["state"] == "UNCONFIGURED"