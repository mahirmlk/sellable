"""End-to-end scenario tests — run full buyer-to-payment flows."""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.agents.buyer import BuyerAction, BuyerAgent
from sellable.agents.seller import SellerAgent
from sellable.gateway import AgentGateway


@pytest.fixture
def full_stack() -> tuple[BuyerAgent, CommerceCore]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    commerce = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    gateway = AgentGateway(commerce, SellerAgent(commerce))
    return BuyerAgent(gateway), commerce


def test_e2e_happy_path(full_stack: tuple[BuyerAgent, CommerceCore]) -> None:
    """Full buyer mission through to READY_FOR_CONSENT."""
    buyer, commerce = full_stack
    mission = type("Mission", (), {
        "buyer_agent_id": "buyer_e2e",
        "message": "I need coffee for my desk",
        "budget_ceiling_paise": 200_000,
        "allowed_categories": ["accessories", "gifting", "snacks"],
        "purpose": "Buy coffee",
        "expires_at": utc_now() + timedelta(minutes=10),
        "request_upsell": True,
    })()
    from sellable.contracts import BuyerMission

    result = buyer.run(BuyerMission(
        buyer_agent_id="buyer_e2e",
        message="I need coffee for my desk",
        budget_ceiling_paise=200_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy coffee",
        expires_at=utc_now() + timedelta(minutes=10),
        request_upsell=True,
    ))

    assert result.action in (BuyerAction.READY_FOR_CONSENT, BuyerAction.NEEDS_HUMAN_APPROVAL)
    assert result.seller_decision is not None
    assert result.seller_decision.cart is not None

    events = commerce.ledger.for_trace(result.trace_id)
    assert len(events) >= 4


def test_e2e_over_budget_denied(full_stack: tuple[BuyerAgent, CommerceCore]) -> None:
    """Buyer mission exceeding budget is denied."""
    buyer, _ = full_stack
    from sellable.contracts import BuyerMission

    result = buyer.run(BuyerMission(
        buyer_agent_id="buyer_e2e",
        message="I need a workday gift box",
        budget_ceiling_paise=50_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy gift",
        expires_at=utc_now() + timedelta(minutes=10),
        request_upsell=False,
    ))

    assert result.action == BuyerAction.DENIED


def test_e2e_no_match_scenario(full_stack: tuple[BuyerAgent, CommerceCore]) -> None:
    """Requesting a nonexistent product returns NO_MATCH."""
    buyer, _ = full_stack
    from sellable.contracts import BuyerMission

    result = buyer.run(BuyerMission(
        buyer_agent_id="buyer_e2e",
        message="quantum teleportation device",
        budget_ceiling_paise=1_000_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy impossible item",
        expires_at=utc_now() + timedelta(minutes=10),
        request_upsell=False,
    ))

    assert result.action == BuyerAction.NO_MATCH
