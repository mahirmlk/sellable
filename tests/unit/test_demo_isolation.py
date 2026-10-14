"""Demo isolation tests (UPDATE.md §6, Milestone C).

These tests run against temporary SQLite databases with the merchant auth
dependencies overridden, so no production data is touched. They prove:

- The well-known demo key works in development against a LOCAL database
  (existing demo conveniences keep working).
- The demo key is rejected when a development backend points at a REMOTE
  database (the dev-environment + production-data footgun is closed).
- The demo key is rejected in production (existing fail-closed posture).
- Demo-merchant writes through the console touch only the demo merchant's
  own rows — never another merchant's policy, catalog, or orders.
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
    # registry.py binds make_engine by from-import: patch its own reference
    # too, or save_policy_for/load_policy_for hit the developer's real DB.
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


def test_demo_key_works_against_local_db(isolated_env, monkeypatch):
    """Development + local SQLite: the demo session is honoured."""
    from sellable.config import Settings

    monkeypatch.setattr(
        merchant_auth,
        "settings",
        Settings(
            environment="development",
            database_url="sqlite+pysqlite:///./data/sellable.db",
        ),
    )
    client, _, _ = isolated_env
    r = client.get("/console/policy", headers=DEMO_H)
    assert r.status_code == 200, r.text
    assert r.json()["merchant_id"] == "mrc_demo_store"


def test_demo_key_rejected_against_remote_db(isolated_env, monkeypatch):
    """Development + remote Postgres: demo sessions are refused, even with
    the correct demo key. This closes the dev-backend/pointed-at-production
    footgun — no demo-context request may touch shared data."""
    from sellable.config import Settings

    monkeypatch.setattr(
        merchant_auth,
        "settings",
        Settings(
            environment="development",
            database_url="postgresql+psycopg://postgres.ref:secret@aws-0-region.pooler.supabase.com:6543/postgres",
        ),
    )
    client, _, _ = isolated_env
    r = client.get("/console/policy", headers=DEMO_H)
    assert r.status_code == 401, r.text
    assert r.json()["detail"]["code"] == "auth_not_configured"

    r = client.put(
        "/console/policy", headers=DEMO_H, json={"max_discount_percent": 99}
    )
    assert r.status_code == 401, r.text

    r = client.post(
        "/console/onboarding", headers=DEMO_H, json={"store_name": "Intruder"}
    )
    assert r.status_code == 401, r.text


def test_demo_key_rejected_in_production(isolated_env, monkeypatch):
    """Production without Supabase: the demo key never authenticates."""
    from sellable.config import Settings

    monkeypatch.setattr(
        merchant_auth, "settings", Settings(environment="production")
    )
    client, _, _ = isolated_env
    r = client.get("/console/policy", headers=DEMO_H)
    assert r.status_code == 401, r.text
    assert r.json()["detail"]["code"] == "auth_not_configured"


def test_demo_writes_stay_in_demo_merchant(isolated_env):
    """A demo-session policy write changes only the demo merchant's row."""
    client, engine, registry = isolated_env
    merchant_b, _ = registry.create_merchant(name="Real Store")

    before_b = None
    _override_as(main_module.app, merchant_b)
    try:
        before_b = client.get("/console/policy", headers=DEMO_H).json()
    finally:
        _clear(main_module.app)

    # Demo session writes through the same console endpoint.
    _override_as(main_module.app, "mrc_demo_store")
    try:
        r = client.put(
            "/console/policy",
            headers=DEMO_H,
            json={"max_discount_percent": 42},
        )
        assert r.status_code == 200, r.text
        assert r.json()["merchant_id"] == "mrc_demo_store"
    finally:
        _clear(main_module.app)

    # The real merchant's policy is byte-identical; the demo row changed.
    _override_as(main_module.app, merchant_b)
    try:
        after_b = client.get("/console/policy", headers=DEMO_H).json()
        assert after_b == before_b
    finally:
        _clear(main_module.app)

    _override_as(main_module.app, "mrc_demo_store")
    try:
        demo_policy = client.get("/console/policy", headers=DEMO_H).json()
        assert demo_policy["max_discount_percent"] == 42
    finally:
        _clear(main_module.app)


def test_demo_gateway_key_rejected_against_remote_db(isolated_env, monkeypatch):
    """Agent-gateway static demo key is also disabled on remote databases."""
    from sellable import auth as auth_mod
    from sellable.config import Settings

    monkeypatch.setattr(
        auth_mod,
        "settings",
        Settings(
            environment="development",
            database_url="postgresql+psycopg://postgres.ref:secret@aws-0-region.pooler.supabase.com:6543/postgres",
        ),
    )
    assert auth_mod._DEMO_KEY_HASH not in auth_mod._configured_hashes()
