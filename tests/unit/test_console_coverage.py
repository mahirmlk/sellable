"""Console coverage for replay, metrics, readiness, and billing routes."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.config import Settings
from sellable.contracts import CartItem, CartMandate, IntentMandate, utc_now
from sellable.ledger import database as ledger_database
from sellable.registry import DEMO_MERCHANT_ID, MerchantRegistry
from sellable.ledger.service import LedgerRepository


def _isolated(monkeypatch, tmp_path):
    import sellable.repositories as repositories_mod

    db_path = tmp_path / "consolecov.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)
    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    session = merchant_auth.MerchantSession(
        merchant_id=DEMO_MERCHANT_ID, role="owner", auth_user_id="user_cc"
    )
    user = merchant_auth.AuthenticatedUser(auth_user_id="user_cc")
    main_module.app.dependency_overrides[
        merchant_auth.get_merchant_session
    ] = lambda: session
    main_module.app.dependency_overrides[
        merchant_auth.get_authenticated_user
    ] = lambda: user
    return test_registry


def _paid_order(core):
    intent = IntentMandate(
        buyer_agent_id="buyer_cc",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="console coverage",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01", quantity=1,
                unit_price_paise=69_900, offered_price_paise=69_900,
            )
        ],
        subtotal_paise=69_900, discount_paise=0, total_paise=69_900,
        negotiation_round=0,
    )
    order = core.create_order(
        cart=mandate, intent=intent, trace_id=f"trc_{uuid4().hex}",
        idempotency_key=f"idem_cc_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    return core.mark_paid(order.order_id, provider_ref="pay_cc_1"), intent


def test_console_replay_metrics_readiness_billing(monkeypatch, tmp_path) -> None:
    test_registry = _isolated(monkeypatch, tmp_path)
    core = test_registry.get(DEMO_MERCHANT_ID)
    order, _ = _paid_order(core)
    client = TestClient(main_module.app)
    try:
        replay = client.get(f"/console/transactions/{order.order_id}/replay")
        assert replay.status_code == 200, replay.text
        body = replay.json()
        assert body["order_id"] == order.order_id
        assert body["event_count"] >= 3
        assert any(s["section"] == "payment" for s in body["sections"])

        missing = client.get("/console/transactions/ord_nope/replay")
        assert missing.status_code == 404

        agents = client.get("/console/metrics/agents", params={"days": 7})
        assert agents.status_code == 200, agents.text
        assert set(agents.json()) == {
            "window_days", "runs", "reliability", "quality", "economics", "safety",
        }

        commerce = client.get("/console/metrics/commerce", params={"days": 30})
        assert commerce.status_code == 200, commerce.text
        assert "discount_leakage_bps" in commerce.json()

        readiness = client.get("/console/onboarding/readiness")
        assert readiness.status_code == 200, readiness.text
        assert readiness.json()["checks"]["catalog_completeness"] is True

        billing = client.get("/console/billing", params={"days": 30})
        assert billing.status_code == 200, billing.text
        assert billing.json()["plan"] == "FREE"
        assert billing.json()["usage"]["orders"] >= 1
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()
        for engine in {core.outbox_repo._engine}:
            engine.dispose()
