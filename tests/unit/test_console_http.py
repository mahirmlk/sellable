"""HTTP coverage for connector management and dead-letter retry."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.config import Settings
from sellable.ledger import database as ledger_database
from sellable.registry import DEMO_MERCHANT_ID, MerchantRegistry
from sellable.ledger.service import LedgerRepository


def _client(monkeypatch, tmp_path) -> TestClient:
    import sellable.repositories as repositories_mod

    db_path = tmp_path / "consolehttp.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)
    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)
    monkeypatch.setattr(
        merchant_auth, "settings", Settings(environment="development")
    )
    session = merchant_auth.MerchantSession(
        merchant_id=DEMO_MERCHANT_ID, role="owner", auth_user_id="user_http"
    )
    user = merchant_auth.AuthenticatedUser(auth_user_id="user_http")
    main_module.app.dependency_overrides[
        merchant_auth.get_merchant_session
    ] = lambda: session
    main_module.app.dependency_overrides[
        merchant_auth.get_authenticated_user
    ] = lambda: user
    return TestClient(main_module.app)


def test_connector_routes(monkeypatch, tmp_path) -> None:
    client = _client(monkeypatch, tmp_path)
    try:
        assert client.get("/console/connectors").json() == []

        bad_provider = client.post(
            "/console/connectors",
            json={"connector_id": "con_bad", "provider": "shopify"},
        )
        assert bad_provider.status_code == 400

        missing = client.post("/console/connectors", json={"provider": "custom_rest"})
        assert missing.status_code == 400

        created = client.post(
            "/console/connectors",
            json={
                "connector_id": "con_http_01",
                "provider": "custom_rest",
                "base_url": "http://127.0.0.1:1",
            },
        )
        assert created.status_code == 200, created.text

        listed = client.get("/console/connectors")
        assert [c["connector_id"] for c in listed.json()] == ["con_http_01"]

        health = client.get("/console/connectors/con_http_01/health")
        assert health.status_code == 200
        assert health.json()["ok"] is False  # unreachable source, honest report

        sync = client.post("/console/connectors/con_http_01/sync")
        assert sync.status_code == 502  # source failure surfaces, catalog untouched

        gone = client.delete("/console/connectors/con_http_01")
        assert gone.status_code == 200
        assert client.get("/console/connectors").json() == []
        assert client.delete("/console/connectors/con_http_01").status_code == 404
        assert client.get("/console/connectors/con_nope/health").status_code == 404
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()


def test_dead_letter_retry_route(monkeypatch, tmp_path) -> None:
    from sellable.repositories import OutboxRepository

    client = _client(monkeypatch, tmp_path)
    try:
        missing = client.post("/console/ops/dead-letters/evt_nope/retry")
        assert missing.status_code == 404
        assert OutboxRepository().list_dead_letters(DEMO_MERCHANT_ID) == []
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()
