"""Phase 8: connector framework — generic REST source sync into the
canonical catalog, over real local HTTP."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.connectors.base import ConnectorConfig
from sellable.connectors.rest import RestConnector
from sellable.connectors.service import ConnectorService
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.repositories import CatalogRepository, ConnectorRepository


SOURCE_PRODUCTS = [
    {
        "id": "EXT-01",
        "name": "External Widget",
        "body": "A widget from the source system",
        "price_paise": 12_000,
        "inventory": 7,
        "type": "accessories",
        "vendor": "acme",
    },
    {
        "id": "EXT-02",
        "name": "External Gizmo",
        "price_paise": 5_000,
        "stock": 3,
        "category": "gifting",
    },
]


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (stdlib handler naming)
        if self.path == "/products":
            body = json.dumps({"products": SOURCE_PRODUCTS}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args) -> None:  # silence test output
        pass


@pytest.fixture
def source_url():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join()


@pytest.fixture
def commerce_core():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def _config(core: CommerceCore, base_url: str = "") -> ConnectorConfig:
    return ConnectorConfig(
        connector_id="con_test_01",
        merchant_id=core.merchant_scope,
        provider="custom_rest",
        base_url=base_url,
    )


# --- Normalization ---------------------------------------------------------------------


def test_normalize_maps_source_to_canonical(commerce_core: CommerceCore) -> None:
    connector = RestConnector(_config(commerce_core))
    products = [
        connector.normalize(record, commerce_core.merchant_scope)
        for record in SOURCE_PRODUCTS
    ]
    assert len(products) == 2
    widget, gizmo = products
    assert widget.sku == "EXT-01"
    assert widget.price_paise == 12_000
    assert widget.stock == 7
    assert widget.floor_paise == 12_000 * 80 // 100  # default 80% floor
    assert gizmo.category == "gifting"
    assert widget.attributes["vendor"] == "acme"


def test_unknown_provider_rejected(commerce_core: CommerceCore) -> None:
    from sellable.connectors.service import connector_for

    config = _config(commerce_core)
    config.provider = "shopify"
    with pytest.raises(ValueError, match="Unknown connector provider"):
        connector_for(config)


# --- Sync over HTTP ----------------------------------------------------------------------


def test_sync_from_live_http_source(
    commerce_core: CommerceCore, source_url: str
) -> None:
    core = commerce_core
    trace_id = _trace()
    core.connector_register(_config(core, source_url), trace_id=trace_id)
    result = core.connector_sync("con_test_01", trace_id=trace_id)
    assert result["inserted"] == 2
    assert result["updated"] == 0
    assert result["total"] == 2

    # Second sync updates in place (no duplicates, no crash).
    again = core.connector_sync("con_test_01", trace_id=trace_id)
    assert again["inserted"] == 0
    assert again["updated"] == 2

    # The long-lived in-memory service serves the synced products.
    assert core.catalog.get("EXT-01").price_paise == 12_000
    actions = [e.action for e in core.ledger.for_trace(trace_id)]
    assert "connector.registered" in actions
    assert "connector.synced" in actions


def test_sync_failure_leaves_catalog_untouched(
    commerce_core: CommerceCore,
) -> None:
    core = commerce_core
    trace_id = _trace()
    core.connector_register(
        _config(core, "http://127.0.0.1:1"), trace_id=trace_id
    )
    before = len(core.catalog.all())
    with pytest.raises(Exception):
        core.connector_sync("con_test_01", trace_id=trace_id)
    assert len(core.catalog.all()) == before
    actions = [e.action for e in core.ledger.for_trace(trace_id)]
    assert "connector.sync_failed" in actions


def test_health_and_secret_stripping(
    commerce_core: CommerceCore, source_url: str
) -> None:
    core = commerce_core
    config = _config(core, source_url)
    config.headers = {"X-Api-Key": "shh", "Accept": "application/json"}
    core.connector_register(config, trace_id=_trace())
    stored = core.connector_repo.get("con_test_01", core.merchant_scope)
    assert stored is not None
    assert "X-Api-Key" not in stored["headers"]
    assert stored["headers"]["Accept"] == "application/json"

    health = core.connector_health("con_test_01", trace_id=_trace())
    assert health["ok"] is True

    core.connector_remove("con_test_01", trace_id=_trace())
    assert core.connector_list() == []
    with pytest.raises(ValueError):
        core.connector_sync("con_test_01", trace_id=_trace())
