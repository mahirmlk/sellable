"""Policy first-run + correlation-id tests (UPDATE.md §7, Milestone D).

These tests run against a temporary SQLite database with the merchant auth
dependencies overridden, so no production data is touched. They prove:

- A merchant with no persisted policy row gets first-run defaults with
  ``is_default=True`` (an actionable state, never an error or fake data).
- After PUT, the policy reads back with ``is_default=False``.
- Merchants created through onboarding (which writes a policy row) are
  never flagged as default.
- Every console response — success and error — carries an X-Trace-Id
  correlation id, echoed when the caller supplies a valid one.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.ledger import database as ledger_database
from sellable.ledger.service import LedgerRepository
from sellable.merchant_auth import AuthenticatedUser, MerchantSession
from sellable.registry import MerchantRegistry


@pytest.fixture()
def isolated_env(monkeypatch, tmp_path):
    """Temp SQLite DB + patched engines + overridden auth dependencies."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)

    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    import sellable.registry as registry_mod
    import sellable.repositories as repositories_mod

    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    monkeypatch.setattr(registry_mod, "make_engine", lambda config=None: engine)

    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)

    from sellable.config import Settings

    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))

    client = TestClient(main_module.app)
    yield client, engine, test_registry
    client.close()
    main_module.app.dependency_overrides.clear()
    engine.dispose()


DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


def _override_as(app, merchant_id: str, role: str = "owner"):
    user = AuthenticatedUser(auth_user_id=f"usr_{uuid4().hex[:10]}")
    session = MerchantSession(
        merchant_id=merchant_id, auth_user_id=user.auth_user_id, role=role
    )
    app.dependency_overrides[merchant_auth.get_merchant_session] = lambda: session
    app.dependency_overrides[merchant_auth.get_authenticated_user] = lambda: user
    return session


def _clear(app):
    app.dependency_overrides.clear()


def test_first_run_defaults_flagged(isolated_env):
    client, engine, registry = isolated_env
    # Fresh demo store has no persisted policy row: defaults + flag.
    r = client.get("/console/policy", headers=DEMO_H)
    assert r.status_code == 200, r.text
    assert r.json()["is_default"] is True

    # Saving activates: the flag clears and survives registry invalidation.
    r = client.put(
        "/console/policy", headers=DEMO_H, json={"max_discount_percent": 15}
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_default"] is False
    assert r.json()["max_discount_percent"] == 15

    registry.invalidate("mrc_demo_store")
    r = client.get("/console/policy", headers=DEMO_H)
    assert r.json()["is_default"] is False
    assert r.json()["max_discount_percent"] == 15


def test_onboarded_merchant_never_default(isolated_env):
    client, engine, registry = isolated_env
    # POST /console/onboarding writes a real policy row at creation.
    merchant_id, _ = registry.create_merchant(name="Fresh Store")
    _override_as(main_module.app, merchant_id)
    try:
        r = client.get("/console/policy", headers=DEMO_H)
        assert r.status_code == 200, r.text
        assert r.json()["merchant_id"] == merchant_id
        assert r.json()["is_default"] is False
    finally:
        _clear(main_module.app)


def test_trace_id_echoed_on_success_and_error(isolated_env):
    client, engine, registry = isolated_env
    # Caller-supplied trace id echoes back verbatim.
    mine = "trc_" + "a" * 32
    r = client.get("/console/policy", headers={**DEMO_H, "X-Trace-Id": mine})
    assert r.status_code == 200, r.text
    assert r.headers.get("x-trace-id") == mine

    # Missing/invalid trace ids still get a minted correlation id —
    # including on auth failures, so support can trace any report.
    r = client.get("/console/policy")
    assert r.status_code == 401
    trace_id = r.headers.get("x-trace-id", "")
    assert trace_id.startswith("trc_")

    r = client.get("/console/policy", headers={"X-Trace-Id": "garbage"})
    assert r.headers.get("x-trace-id", "").startswith("trc_")
    assert r.headers["x-trace-id"] != "garbage"
