"""Negotiation flow: typed offers, active-SKU resolution, upsell gating.

Covers the conversational negotiation contract: deterministic intent
classification, negotiation through the policy engine on the active product,
price queries, upsell suggestion/acceptance semantics, round limits, and
ledger replay.
"""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from agents.seller.agent import SellerAction, SellerAgent, SellerRequest
from agents.seller.intent import TurnKind, classify_buyer_message, parse_offer_paise
from sellable.contracts import IntentMandate, PolicyVerdict, Product, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.main import _active_sku_from_trace, _negotiation_aware_request


@pytest.fixture
def core() -> CommerceCore:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


@pytest.fixture
def fixed_price_product(core: CommerceCore) -> Product:
    product = Product(
        merchant_id=core.policy.merchant_id,
        sku="FIXED-MAT-01",
        title="Felt Desk Mat — Large (fixed)",
        description="A fixed-price desk mat.",
        price_paise=149_900,
        floor_paise=149_900,
        stock=25,
        category="accessories",
    )
    return core.catalog.add_product(product)


def intent(budget_ceiling_paise: int = 3_000_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_negotiation",
        budget_ceiling_paise=budget_ceiling_paise,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Negotiation flow tests",
        expires_at=utc_now() + timedelta(hours=1),
    )


# ---------------------------------------------------------------------------
# Intent classification (deterministic, no LLM)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "expected_paise"),
    [
        ("can you give this product in 1,300?", 130_000),
        ("can you do ₹1,300?", 130_000),
        ("can you do 1300?", 130_000),
        ("can you do this for 1.3k?", 130_000),
        ("I'll pay 1300", 130_000),
        ("will you take 1300?", 130_000),
        ("1300 rupees is my budget for this", 130_000),
        ("can you do Rs. 1,300.50?", 130_050),
        ("can you make it 2k?", 200_000),
    ],
)
def test_offer_formats_normalize_to_paise(message: str, expected_paise: int) -> None:
    assert parse_offer_paise(message) == expected_paise
    assert classify_buyer_message(message).kind is TurnKind.NEGOTIATE_OFFER


@pytest.mark.parametrize(
    "message",
    [
        "can you give discount?",
        "can you lower the price?",
        "what is your best price?",
        "any discount?",
        "can you come down on the price?",
    ],
)
def test_price_queries_without_amount(message: str) -> None:
    parsed = classify_buyer_message(message)
    assert parsed.kind is TurnKind.PRICE_QUERY
    assert parsed.offer_paise is None


def test_typed_upsell_acceptance() -> None:
    assert classify_buyer_message("yes, add it").kind is TurnKind.ACCEPT_UPSELL
    assert classify_buyer_message("I'll take it").kind is TurnKind.ACCEPT_UPSELL


def test_ordinary_messages_are_not_negotiations() -> None:
    assert classify_buyer_message("I need a large desk mat under ₹2,000").kind is TurnKind.OTHER
    assert classify_buyer_message("what colors does it come in?").kind is TurnKind.OTHER
    # A sentence with unrelated numbers is not an offer.
    assert classify_buyer_message("I need 2 of these for my office").kind is TurnKind.OTHER


# ---------------------------------------------------------------------------
# Negotiation through the policy engine
# ---------------------------------------------------------------------------


def test_offer_between_floor_and_list_is_countered_at_policy_minimum(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="can you do ₹700?",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            buyer_offer_paise=70_000,
            request_upsell=False,
        ),
        trace_id="trc_neg_counter",
    )
    # List ₹849.00 (84900) · floor ₹749.00 · 10% cap floor ₹764.10 — the
    # deterministic counter is max(floor, cap) = 76410.
    assert decision.action is SellerAction.COUNTERED
    assert decision.cart.items[0].offered_price_paise == 76_410
    assert "₹764.10" in decision.response_message
    # Negotiation must not upsell and must not fuzzy-search.
    assert "upsell.suggest" not in decision.tool_calls
    assert "catalog.search" not in decision.tool_calls
    assert "catalog.get" in decision.tool_calls


def test_offer_at_or_above_list_is_accepted_at_list_price(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="I'll pay 900",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            buyer_offer_paise=90_000,
        ),
        trace_id="trc_neg_accept",
    )
    assert decision.action is SellerAction.QUOTE_READY
    assert decision.cart.total_paise == 84_900
    assert decision.cart.items[0].offered_price_paise == 84_900


def test_fixed_price_sku_cannot_go_below_list(core: CommerceCore, fixed_price_product: Product) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="can you give this product in 1,300?",
            intent=intent(),
            requested_sku="FIXED-MAT-01",
            buyer_offer_paise=130_000,
            request_upsell=False,
        ),
        trace_id="trc_neg_fixed",
    )
    # floor == list price: the policy-valid minimum IS the list price.
    assert decision.action is SellerAction.COUNTERED
    assert decision.cart.items[0].offered_price_paise == 149_900
    assert "₹1,499.00" in decision.response_message
    assert decision.cart.discount_paise == 0


def test_price_query_returns_policy_floor_without_a_cart(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="what is your best price?",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            price_query=True,
            request_upsell=False,
        ),
        trace_id="trc_neg_query",
    )
    assert decision.action is SellerAction.PRICE_QUERY
    assert decision.cart is None
    assert "₹764.10" in decision.response_message
    assert "quotes.create" not in decision.tool_calls
    assert "quote.best_price" in decision.tool_calls


def test_negotiation_rounds_accumulate_on_one_trace(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    request = SellerRequest(
        message="can you do 700?",
        intent=intent(),
        requested_sku="SNACK-COFFEE-01",
        buyer_offer_paise=70_000,
        request_upsell=False,
    )
    for round_index in range(5):
        decision = agent.respond(request, trace_id="trc_neg_rounds")
        assert decision.action is SellerAction.COUNTERED
        assert decision.cart.negotiation_round == round_index + 1
    # Round 6 exceeds the merchant's max_negotiation_rounds (5) → policy deny.
    denied = agent.respond(request, trace_id="trc_neg_rounds")
    assert denied.action is SellerAction.DENIED
    assert denied.policy_decision.verdict is PolicyVerdict.DENY


def test_negotiation_never_adds_upsell_items_to_the_cart(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="can you do ₹800?",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            buyer_offer_paise=80_000,
            request_upsell=True,  # toggle on — still disabled during negotiation
        ),
        trace_id="trc_neg_no_upsell",
    )
    assert decision.upsell_product is None
    assert [item.sku for item in decision.cart.items] == ["SNACK-COFFEE-01"]
    assert "upsell.suggest" not in decision.tool_calls


def test_upsell_suggestion_leaves_cart_unchanged(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(message="I need coffee for my desk", intent=intent()),
        trace_id="trc_neg_suggest",
    )
    assert decision.cart.total_paise == 84_900
    assert decision.upsell_product is not None
    assert decision.upsell_product.sku == "SNACK-MUG-01"
    offered = [
        e for e in core.ledger.for_trace("trc_neg_suggest") if e.action == "upsell.offered"
    ]
    assert offered and "awaiting explicit buyer acceptance" in offered[0].reasoning_summary


def test_explicit_upsell_acceptance_adds_the_add_on(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="yes, add it",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            accept_upsell=True,
        ),
        trace_id="trc_neg_accept_upsell",
    )
    assert decision.upsell_product is not None
    assert [item.sku for item in decision.cart.items] == ["SNACK-COFFEE-01", "SNACK-MUG-01"]
    assert decision.cart.total_paise == 194_800
    accepted = [
        e for e in core.ledger.for_trace("trc_neg_accept_upsell") if e.action == "upsell.accepted"
    ]
    assert accepted


def test_active_sku_resolution_and_negotiation_enrichment(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    first = agent.respond(
        SellerRequest(message="coffee for my desk", intent=intent()),
        trace_id="trc_neg_active",
    )
    assert _active_sku_from_trace(core, "trc_neg_active") == "SNACK-COFFEE-01"

    # A typed follow-up offer resolves "it" to the active SKU server-side.
    enriched = _negotiation_aware_request(
        core,
        SellerRequest(message="can you do it for 700?", intent=intent()),
        trace_id="trc_neg_active",
    )
    assert enriched.requested_sku == "SNACK-COFFEE-01"
    assert enriched.buyer_offer_paise == 70_000
    assert enriched.request_upsell is False

    negotiated = agent.respond(enriched, trace_id="trc_neg_active")
    assert negotiated.action is SellerAction.COUNTERED
    assert negotiated.trace_id == first.trace_id == "trc_neg_active"

    # A typed price query also binds to the active SKU.
    query = _negotiation_aware_request(
        core,
        SellerRequest(message="any discount?", intent=intent()),
        trace_id="trc_neg_active",
    )
    assert query.price_query is True and query.requested_sku == "SNACK-COFFEE-01"

    # With no trace history and no SKU, an offer cannot negotiate — it falls
    # through to normal discovery.
    fresh = _negotiation_aware_request(
        core,
        SellerRequest(message="can you do 700?", intent=intent()),
        trace_id="trc_neg_fresh",
    )
    assert fresh.buyer_offer_paise is None and fresh.requested_sku is None


def test_ledger_replay_records_offer_policy_and_counter(core: CommerceCore) -> None:
    agent = SellerAgent(core)
    decision = agent.respond(
        SellerRequest(
            message="can you do 700?",
            intent=intent(),
            requested_sku="SNACK-COFFEE-01",
            buyer_offer_paise=70_000,
        ),
        trace_id="trc_neg_replay",
    )
    events = core.ledger.for_trace(decision.trace_id)
    actions = [e.action for e in events]
    # No LLM wired: the deterministic message is used and no phrasing event
    # is recorded.
    assert actions == [
        "catalog.get",
        "negotiation.countered",
        "quote.received",
        "policy.checked",
        "seller.response_ready",
    ]
    countered = next(e for e in events if e.action == "negotiation.countered")
    assert countered.inputs_json["buyer_offer_paise"] == 70_000
    assert countered.output_json["offered_price_paise"] == 76_410
    assert all(e.trace_id == "trc_neg_replay" for e in events)
