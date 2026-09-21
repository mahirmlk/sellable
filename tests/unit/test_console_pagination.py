"""Console list pagination: limit/offset on transactions, approvals, catalog, insights.

Defaults preserve the previous unbounded behavior (repo 500-order cap, full
catalog, 1000-event insights window); explicit pages slice deterministically.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.contracts import CartItem, CartMandate, IntentMandate, Product, utc_now
from sellable.ledger import database as ledger_database
from sellable.ledger.service import LedgerRepository
from sellable.registry import DEMO_MERCHANT_ID, MerchantRegistry
from sellable.repositories import CatalogRepository


@pytest.fixture()
def isolated_env(monkeypatch, tmp_path):
    """Temp SQLite DB + patched engines + overridden auth dependencies."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)

    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    import sellable.repositories as repositories_mod

    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)

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


def _intent(budget: int, ref: str) -> IntentMandate:
    return IntentMandate(
        mandate_id=ref,
        buyer_agent_id="buyer_pagination",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Pagination test",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def _cart(ref: str, *, sku: str, total: int) -> CartMandate:
    return CartMandate(
        intent_ref=ref,
        items=[
            CartItem(
                sku=sku,
                quantity=1,
                unit_price_paise=total,
                offered_price_paise=total,
            )
        ],
        subtotal_paise=total,
        discount_paise=0,
        total_paise=total,
        negotiation_round=0,
    )


@pytest.fixture()
def seeded(isolated_env):
    client, engine, registry = isolated_env
    core = registry.get(DEMO_MERCHANT_ID)
    for i in range(5):
        ref = f"im_page_std_{i:02d}"
        core.create_order(
            cart=_cart(ref, sku="AUDIO-CASE-01", total=69_900),
            intent=_intent(600_000, ref),
            trace_id=f"trc_page_std_{i:02d}",
            idempotency_key=f"idem_page_std_{i:02d}_0001",
        )
    for i in range(3):
        ref = f"im_page_hitl_{i:02d}"
        order = core.create_order(
            cart=_cart(ref, sku="GIFT-BOX-01", total=249_900),
            intent=_intent(300_000, ref),
            trace_id=f"trc_page_hitl_{i:02d}",
            idempotency_key=f"idem_page_hitl_{i:02d}_0001",
        )
        assert order.requires_approval is True
    CatalogRepository().add_many(
        [
            Product(
                id=f"prd_page_{i}",
                merchant_id=DEMO_MERCHANT_ID,
                sku=f"PAGE-SKU-{i}",
                title=f"Page Widget {i}",
                description="Pagination test product",
                price_paise=10_000 + i,
                floor_paise=9_000,
                stock=5,
                category="accessories",
                attributes={},
            )
            for i in range(4)
        ]
    )
    return client


def _ids(rows: list[dict]) -> list[str]:
    return [r["order_id"] for r in rows]


def test_transactions_default_returns_everything(seeded) -> None:
    body = seeded.get("/console/transactions", headers=DEMO_H).json()
    assert len(body) == 8


def test_transactions_pagination_pages_without_overlap(seeded) -> None:
    full = seeded.get("/console/transactions", headers=DEMO_H).json()
    page1 = seeded.get("/console/transactions?limit=3", headers=DEMO_H).json()
    page2 = seeded.get("/console/transactions?limit=3&offset=3", headers=DEMO_H).json()
    page3 = seeded.get("/console/transactions?limit=3&offset=6", headers=DEMO_H).json()

    assert len(page1) == 3 and len(page2) == 3 and len(page3) == 2
    assert _ids(page1) == _ids(full)[:3]
    assert _ids(page1 + page2 + page3) == _ids(full)
    assert not (set(_ids(page1)) & set(_ids(page2)))
    assert seeded.get("/console/transactions?limit=3&offset=99", headers=DEMO_H).json() == []


def test_approvals_pagination(seeded) -> None:
    full = seeded.get("/console/approvals", headers=DEMO_H).json()
    assert len(full) == 3

    page1 = seeded.get("/console/approvals?limit=2", headers=DEMO_H).json()
    page2 = seeded.get("/console/approvals?limit=2&offset=2", headers=DEMO_H).json()
    assert len(page1) == 2 and len(page2) == 1
    assert [a["order_id"] for a in page1 + page2] == [a["order_id"] for a in full]


def test_catalog_pagination(seeded) -> None:
    full = seeded.get("/console/catalog", headers=DEMO_H).json()
    assert len(full) >= 4

    page1 = seeded.get("/console/catalog?limit=2", headers=DEMO_H).json()
    page2 = seeded.get("/console/catalog?limit=2&offset=2", headers=DEMO_H).json()
    assert len(page1) == 2 and len(page2) == 2
    assert [p["sku"] for p in page1] == [p["sku"] for p in full][:2]
    assert not (set(p["sku"] for p in page1) & set(p["sku"] for p in page2))


def test_insights_pagination_preserves_defaults(seeded) -> None:
    default = seeded.get("/console/insights", headers=DEMO_H).json()
    explicit = seeded.get("/console/insights?limit=1000&offset=0", headers=DEMO_H).json()
    assert explicit == default
    assert default["total_orders"] == 8

    windowed = seeded.get("/console/insights?limit=1&offset=0", headers=DEMO_H).json()
    assert windowed["total_orders"] == 8
    assert windowed["revenue"] == default["revenue"]

    clamped = seeded.get("/console/insights?limit=0&offset=-5", headers=DEMO_H)
    assert clamped.status_code == 200
