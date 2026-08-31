from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from sellable.agents.seller import SellerAction, SellerAgent, SellerRequest
from sellable.contracts import IntentMandate, PolicyVerdict, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository


@pytest.fixture
def seller_agent() -> SellerAgent:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return SellerAgent(CommerceCore.from_seed(LedgerRepository(engine), engine=engine))


def buyer_intent(budget_ceiling_paise: int = 200_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_demo",
        budget_ceiling_paise=budget_ceiling_paise,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Buy a suitable workday item",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def test_agent_creates_a_grounded_quote_and_policy_valid_upsell(
    seller_agent: SellerAgent,
) -> None:
    result = seller_agent.respond(
        SellerRequest(message="I need coffee for my desk", intent=buyer_intent())
    )

    assert result.action is SellerAction.QUOTE_READY
    assert result.policy_decision is not None
    assert result.policy_decision.verdict is PolicyVerdict.ALLOW
    assert result.cart is not None
    assert [item.sku for item in result.cart.items] == ["SNACK-COFFEE-01", "SNACK-MUG-01"]
    assert result.cart.total_paise == 194_800
    assert result.upsell_product is not None
    assert result.upsell_product.sku == "SNACK-MUG-01"
    assert "catalog.search" in result.tool_calls
    assert "upsell.suggest" in result.tool_calls
    assert "order.created" not in [
        event.action for event in seller_agent.commerce.ledger.for_trace(result.trace_id)
    ]


def test_agent_counters_below_the_lowest_policy_valid_price(seller_agent: SellerAgent) -> None:
    result = seller_agent.respond(
        SellerRequest(
            message="I need a headphone travel case",
            intent=buyer_intent(),
            buyer_offer_paise=59_000,
            request_upsell=False,
        )
    )

    assert result.action is SellerAction.COUNTERED
    assert result.cart is not None
    assert result.cart.items[0].offered_price_paise == 62_910
    assert result.policy_decision is not None
    assert result.policy_decision.verdict is PolicyVerdict.ALLOW
    assert "quotes.negotiate" in result.tool_calls


def test_agent_never_invents_an_unknown_catalog_item(seller_agent: SellerAgent) -> None:
    result = seller_agent.respond(
        SellerRequest(message="Please sell me a self-driving hoverboard", intent=buyer_intent())
    )

    assert result.action is SellerAction.NO_MATCH
    assert result.cart is None
    assert result.selected_product is None


def test_high_value_candidate_cart_is_held_for_human_approval(seller_agent: SellerAgent) -> None:
    result = seller_agent.respond(
        SellerRequest(message="I need a workday gift box", intent=buyer_intent(300_000))
    )

    assert result.action is SellerAction.NEEDS_HUMAN_APPROVAL
    assert result.policy_decision is not None
    assert result.policy_decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL
