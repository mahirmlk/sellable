from fastapi.testclient import TestClient
from sqlalchemy import inspect

from sellable.agents.seller import SellerAgent, SellerRequest
from sellable.config import settings
from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import initialise_database, make_engine
from sellable.ledger.service import LedgerRepository
from sellable.main import app, get_seller_agent


def test_ledger_schema_is_initialised() -> None:
    initialise_database()

    assert "ledger_events" in inspect(make_engine()).get_table_names()


def test_health_reports_the_unconfigured_test_payment_rail() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "environment": "development",
        "database": "connected",
        "razorpay_configured": settings.razorpay_is_configured,
        "cors_origins": list(settings.cors_origins),
    }


def test_seller_endpoint_returns_a_candidate_cart_without_order_creation() -> None:
    engine = make_engine()
    test_agent = SellerAgent(CommerceCore.from_seed(LedgerRepository(engine), engine=engine))
    app.dependency_overrides[get_seller_agent] = lambda: test_agent
    request = SellerRequest(
        message="I need coffee for my desk",
        intent=IntentMandate(
            buyer_agent_id="buyer_api_test",
            budget_ceiling_paise=200_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="Buy coffee",
            expires_at=utc_now().replace(year=utc_now().year + 1),
        ),
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/agent/seller/respond",
                json=request.model_dump(mode="json"),
                headers={"X-Agent-Key": "sellable_demo_key_001"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["action"] == "QUOTE_READY"
    assert response.json()["cart"]["total_paise"] == 194_800
