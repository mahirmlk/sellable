from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from sellable.agents.buyer import BuyerAction, BuyerAgent
from sellable.agents.seller import SellerAgent
from sellable.contracts import BuyerMission, utc_now
from sellable.core import CommerceCore
from sellable.gateway import AgentGateway
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


@pytest.fixture
def buyer_agent() -> BuyerAgent:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    commerce = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    return BuyerAgent(AgentGateway(commerce, SellerAgent(commerce)))


def mission(*, message: str, budget_ceiling_paise: int) -> BuyerMission:
    return BuyerMission(
        buyer_agent_id="buyer_reference",
        message=message,
        budget_ceiling_paise=budget_ceiling_paise,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy a suitable item",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def test_buyer_discovers_the_merchant_and_returns_a_ready_candidate_cart(
    buyer_agent: BuyerAgent,
) -> None:
    result = buyer_agent.run(mission(message="I need coffee for my desk", budget_ceiling_paise=200_000))

    assert result.action is BuyerAction.READY_FOR_CONSENT
    assert result.merchant_manifest["merchant_id"] == "mrc_demo_store"
    assert result.seller_decision is not None
    assert result.seller_decision.cart is not None
    assert result.seller_decision.cart.total_paise == 194_800
    assert result.order_id is not None
    assert result.consent_id is not None
    assert result.steps == ["DISCOVER", "RESEARCH", "REQUEST_QUOTE", "EVALUATE", "ORDER", "CONSENT"]


def test_buyer_budget_guard_denies_an_over_budget_mission(buyer_agent: BuyerAgent) -> None:
    result = buyer_agent.run(mission(message="I need a workday gift box", budget_ceiling_paise=100_000))

    assert result.action is BuyerAction.DENIED
    assert result.seller_decision is not None
    assert result.seller_decision.cart is not None
    assert result.seller_decision.cart.total_paise == 249_900


def test_gateway_manifest_advertises_safe_settlement_authority(buyer_agent: BuyerAgent) -> None:
    manifest = buyer_agent.gateway.discovery_manifest()

    assert manifest["payment"] == {
        "provider": "razorpay",
        "mode": "test",
        "settlement_authority": "signed_webhook",
    }
