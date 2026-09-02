"""Per-merchant store tests: onboarding, isolation, catalog persistence.

These tests run against a temporary SQLite database with the merchant auth
dependencies overridden, so no production data is touched. They prove:

- A user without merchant authorization gets an explicit onboarding-required
  error (never silent demo access).
- POST /console/onboarding creates a real merchant + membership + policy.
- Each merchant sees only their own catalog, policy, orders, and ledger.
- Catalog products persist to the database and survive core invalidation.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sellable import main as main_module
from sellable import merchant_auth
from sellable.contracts import CartItem, CartMandate, IntentMandate
from sellable.ledger import database as ledger_database
from sellable.ledger.service import LedgerRepository
from sellable.merchant_auth import AuthenticatedUser, MerchantSession
from sellable.registry import MerchantRegistry
from sellable.repositories import CatalogRepository


@pytest.fixture()
def isolated_env(monkeypatch, tmp_path):
    """Temp SQLite DB + patched engines + overridden auth dependencies."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)

    # Patch every module-level engine factory to the temp database.
    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    import sellable.repositories as repositories_mod

    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)

    # Rebuild the registry on the temp engine
    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)

    # Dev environment: no Supabase, demo key allowed (never true in production)
    from sellable.config import Settings

    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))

    client = TestClient(main_module.app)
    yield client, engine, test_registry
    client.close()
    main_module.app.dependency_overrides.clear()
    engine.dispose()


DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


def _intent(budget: int = 500000) -> IntentMandate:
    return IntentMandate(
        mandate_id=f"im_{uuid4().hex[:10]}",
        buyer_agent_id="test_buyer",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="test mission",
        created_at="2026-09-02T00:00:00Z",
        expires_at="2026-09-02T23:59:59Z",
    )


def _override_auth(app, session: MerchantSession, user: AuthenticatedUser) -> None:
    app.dependency_overrides[merchant_auth.get_merchant_session] = lambda: session
    app.dependency_overrides[merchant_auth.get_authenticated_user] = lambda: user


def _clear_overrides(app) -> None:
    app.dependency_overrides.pop(merchant_auth.get_merchant_session, None)
    app.dependency_overrides[merchant_auth.get_merchant_session] = (
        merchant_auth.get_merchant_session
    )
    app.dependency_overrides.pop(merchant_auth.get_authenticated_user, None)


def test_unmapped_user_gets_onboarding_required(isolated_env):
    client, engine, registry = isolated_env
    # A verified Supabase user with NO merchant_users row must get an explicit
    # 403 onboarding-required error — never silent demo access.
    user = AuthenticatedUser(auth_user_id=f"usr_{uuid4().hex[:10]}")
    with pytest.raises(HTTPException) as exc_info:
        merchant_auth._resolve_merchant(user.auth_user_id)
    assert exc_info.value.status_code == 403
    detail = exc_info.value.detail
    assert isinstance(detail, dict) and detail.get("code") == "onboarding_required"


def test_onboarding_creates_real_merchant_and_scopes_data(isolated_env):
    client, engine, registry = isolated_env
    user = AuthenticatedUser(auth_user_id=f"usr_{uuid4().hex[:10]}", email="owner@test.dev")
    _override_auth(
        main_module.app,
        MerchantSession(merchant_id="mrc_none", auth_user_id=user.auth_user_id, role="owner"),
        user,
    )
    try:
        resp = client.post(
            "/console/onboarding", json={"store_name": "Acme Desk Supplies"}
        )
        assert resp.status_code == 200, resp.text
        store = resp.json()
        assert store["name"] == "Acme Desk Supplies"
        assert store["merchant_id"].startswith("mrc_")
        assert store["merchant_id"] != "mrc_demo_store"

        # Membership row exists
        Session = sessionmaker(bind=engine)
        with Session() as s:
            from sellable.ledger.database import MerchantUserRecord

            row = (
                s.query(MerchantUserRecord)
                .filter_by(auth_user_id=user.auth_user_id)
                .first()
            )
            assert row is not None
            assert row.merchant_id == store["merchant_id"]
            assert row.role == "owner"

        # Second onboarding attempt conflicts
        resp2 = client.post("/console/onboarding", json={"store_name": "Again"})
        assert resp2.status_code == 409
    finally:
        _clear_overrides(main_module.app)

    # Now resolve the session the way production would (via merchant_users)
    session = MerchantSession(
        merchant_id=store["merchant_id"],
        auth_user_id=user.auth_user_id,
        role="owner",
        merchant_name="Acme Desk Supplies",
    )
    _override_auth(
        main_module.app,
        session,
        user,
    )
    try:
        # Scoped store info
        r = client.get("/console/store", headers=DEMO_H)
        assert r.status_code == 200
        assert r.json()["name"] == "Acme Desk Supplies"

        # Empty, real data — no demo leakage
        assert client.get("/console/catalog", headers=DEMO_H).json() == []
        assert client.get("/console/transactions", headers=DEMO_H).json() == []
        assert client.get("/console/approvals", headers=DEMO_H).json() == []
        assert client.get("/console/events", headers=DEMO_H).json()["events"] == []
        policy = client.get("/console/policy", headers=DEMO_H).json()
        assert policy["merchant_id"] == store["merchant_id"]

        # Add a product: persists to the merchant's own catalog
        r = client.post(
            "/catalog/products",
            headers=DEMO_H,
            json={
                "id": "prd_test_1",
                "merchant_id": "mrc_demo_store",  # must be ignored/overridden
                "sku": "TEST-SKU-1",
                "title": "Test Widget",
                "description": "A test product",
                "price_paise": 100000,
                "floor_paise": 90000,
                "stock": 5,
                "category": "accessories",
                "attributes": {},
            },
        )
        assert r.status_code == 200, r.text
        catalog = client.get("/console/catalog", headers=DEMO_H).json()
        assert [p["sku"] for p in catalog] == ["TEST-SKU-1"]
        assert catalog[0]["merchant_id"] == store["merchant_id"]

        # Catalog survives core invalidation (DB persistence)
        registry.invalidate(store["merchant_id"])
        assert (
            client.get("/console/catalog", headers=DEMO_H).json()[0]["sku"]
            == "TEST-SKU-1"
        )

        # Console checkout flow: seller respond → order → consent
        from datetime import datetime, timedelta, timezone as tz

        now = datetime.now(tz.utc)
        intent = {
            "mandate_id": "im_scope_test",
            "buyer_agent_id": "human_chat",
            "budget_ceiling_paise": 500000,
            "allowed_categories": ["accessories"],
            "purpose": "scoped checkout test",
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(minutes=15)).isoformat(),
        }
        q = client.post(
            "/console/agent/seller/respond",
            headers=DEMO_H,
            json={
                "message": "I need a Test Widget",
                "intent": intent,
                "request_upsell": False,
                "requested_sku": "TEST-SKU-1",
            },
        )
        assert q.status_code == 200, q.text
        quote = q.json()
        assert quote["selected_product"]["sku"] == "TEST-SKU-1"

        o = client.post(
            "/console/orders",
            headers=DEMO_H,
            json={
                "intent": intent,
                "message": "I need a Test Widget",
                "idempotency_key": "idem_scope_test_0001",
                "request_upsell": False,
            },
        )
        assert o.status_code == 200, o.text
        order = o.json()
        assert order["amount_paise"] == 100000

        c = client.post(f"/console/orders/{order['order_id']}/consent", headers=DEMO_H)
        assert c.status_code == 200, c.text
        assert c.json()["amount_paise"] == 100000
        assert c.json()["payee_id"] == store["merchant_id"]

        # Demo store catalog is NOT visible to this merchant
        demo_catalog = CatalogRepository(engine=engine).list("mrc_demo_store")
        assert len(demo_catalog) == 10
    finally:
        _clear_overrides(main_module.app)


def test_cross_merchant_order_isolation(isolated_env):
    client, engine, registry = isolated_env
    # Merchant A (demo store) creates an order through its core.
    demo_core = registry.get("mrc_demo_store")
    demo_catalog = demo_core.catalog.all()
    affordable = [p for p in demo_catalog if p.price_paise <= 300000]
    assert affordable, "demo catalog must contain policy-allowed products"
    product = affordable[0]
    from sellable.contracts import CartItem, CartMandate

    cart = CartMandate(
        mandate_id="cm_test_1",
        intent_ref="im_test_1",
        items=[
            CartItem(
                sku=product.sku,
                quantity=1,
                unit_price_paise=product.price_paise,
                offered_price_paise=product.price_paise,
            )
        ],
        subtotal_paise=product.price_paise,
        discount_paise=0,
        total_paise=product.price_paise,
        upsell_offered=False,
        upsell_rationale=None,
        negotiation_round=0,
    )
    order = demo_core.create_order(
        cart=cart,
        intent=_intent(),
        trace_id="trc_test_iso",
        idempotency_key=f"idem_{uuid4().hex}",
    )

    # Merchant B has no access to merchant A's order.
    user_b = AuthenticatedUser(auth_user_id=f"usr_{uuid4().hex[:10]}")
    merchant_b, _ = registry.create_merchant(name="Store B")
    session_b = MerchantSession(
        merchant_id=merchant_b, auth_user_id=user_b.auth_user_id, role="owner"
    )
    _override_auth(main_module.app, session_b, user_b)
    try:
        r = client.get(f"/console/transactions/{order.order_id}", headers=DEMO_H)
        assert r.status_code == 404
        r = client.get("/console/transactions", headers=DEMO_H)
        assert all(t["order_id"] != order.order_id for t in r.json())
        # Merchant B's policy is their own, not the demo store's
        r = client.get("/console/policy", headers=DEMO_H)
        assert r.json()["merchant_id"] == merchant_b
    finally:
        _clear_overrides(main_module.app)


def test_onboarding_requires_authentication(isolated_env):
    client, engine, registry = isolated_env
    # No auth override → dev fallback requires the demo key; without any
    # credentials the request must fail.
    r = client.post("/console/onboarding", json={"store_name": "Nope"})
    assert r.status_code in (401, 403)
