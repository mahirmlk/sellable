"""Regression tests for Items 11-12 (agent guardrails).

Buyer: SKU/quantity/offer pass-through, mission-budget-first evaluation,
unknown-SKU rejection, ALLOW-only ordering, trace-bound consent, and
read-only payment verification. Seller: category-grounded search, upsell
cap enforcement, and validated LLM phrasing with ledgered provenance.
"""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine

from agents.buyer.policies import BuyerPolicy
from agents.llm.adapters.base import reply_amounts_known, reply_skus_known
from sellable.agents.buyer import BuyerAction, BuyerAgent
from sellable.agents.seller import SellerAction, SellerAgent, SellerRequest
from sellable.catalog import CatalogService
from sellable.contracts import (
    BuyerMission,
    CartItem,
    CartMandate,
    IntentMandate,
    PolicyVerdict,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.gateway import AgentGateway
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository

CATEGORIES = ["accessories", "gifting", "snacks"]


@pytest.fixture
def core_and_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    return core, engine


@pytest.fixture
def seller(core_and_engine):
    core, _ = core_and_engine
    return SellerAgent(core)


@pytest.fixture
def buyer(core_and_engine):
    core, _ = core_and_engine
    commerce = core
    return BuyerAgent(AgentGateway(commerce, SellerAgent(commerce)))


def mission(**overrides) -> BuyerMission:
    fields: dict[str, object] = {
        "buyer_agent_id": "buyer_guards",
        "message": "I need a travel case",
        "budget_ceiling_paise": 100_000,
        "allowed_categories": CATEGORIES,
        "purpose": "Guard regression run",
        "expires_at": utc_now() + timedelta(minutes=10),
    }
    fields.update(overrides)
    return BuyerMission(**fields)  # type: ignore[arg-type]


def intent(*, budget: int = 100_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_guards",
        budget_ceiling_paise=budget,
        allowed_categories=CATEGORIES,
        purpose="Guard regression run",
        expires_at=utc_now() + timedelta(minutes=10),
    )


# ---------------------------------------------------------------------------
# Buyer pass-through: SKU / quantity / first offer reach the seller
# ---------------------------------------------------------------------------


def test_buyer_quote_passes_sku_quantity_and_offer(buyer: BuyerAgent) -> None:
    result = buyer.run(
        mission(
            message="travel case",
            budget_ceiling_paise=200_000,
            requested_sku="AUDIO-CASE-01",
            quantity=2,
            buyer_offer_paise=65_000,
        )
    )

    assert result.action is BuyerAction.READY_FOR_CONSENT
    cart = result.seller_decision.cart
    assert cart is not None
    assert len(cart.items) == 1
    assert cart.items[0].sku == "AUDIO-CASE-01"
    assert cart.items[0].quantity == 2
    # 65_000 clears the policy-valid minimum (floor 59_900, 10% cap 62_910).
    assert cart.items[0].offered_price_paise == 65_000
    assert cart.total_paise == 130_000


# ---------------------------------------------------------------------------
# Buyer budget is evaluated before the merchant approval state
# ---------------------------------------------------------------------------


def test_buyer_budget_beats_approval_label(
    buyer: BuyerAgent, seller: SellerAgent
) -> None:
    # GIFT-BOX-01 at 249_900 clears the 200_000 approval threshold under a
    # high budget, so the seller holds it for approval...
    high = intent(budget=300_000)
    decision = seller.respond(
        SellerRequest(message="gift box", intent=high, requested_sku="GIFT-BOX-01")
    )
    assert decision.action is SellerAction.NEEDS_HUMAN_APPROVAL

    # ...but against the buyer's own lower ceiling it must report OVER_BUDGET,
    # never queue for merchant approval.
    state = {
        "seller_decision": decision,
        "intent": high,
        "mission": mission(budget_ceiling_paise=200_000),
        "manifest": {},
        "trace_id": "trc_guards_budget",
        "steps": [],
    }
    out = buyer._evaluate(state)

    assert out["result"].action is BuyerAction.DENIED
    assert "OVER_BUDGET" in out["result"].buyer_summary


def test_buyer_rejects_unknown_sku_cart(buyer: BuyerAgent) -> None:
    cart = CartMandate(
        intent_ref="im_guards",
        items=[
            CartItem(
                sku="NOPE-01",
                quantity=1,
                unit_price_paise=1_000,
                offered_price_paise=1_000,
            )
        ],
        subtotal_paise=1_000,
        discount_paise=0,
        total_paise=1_000,
        negotiation_round=0,
    )
    verdict = buyer._independent_check(cart, mission(), intent())

    assert verdict.allowed is False
    assert verdict.reason_code == "UNKNOWN_SKU"


def test_buyer_tool_creates_held_order_for_hitl_and_refuses_deny(
    buyer: BuyerAgent, seller: SellerAgent, core_and_engine
) -> None:
    core, _ = core_and_engine
    high = intent(budget=300_000)
    decision = seller.respond(
        SellerRequest(message="gift box", intent=high, requested_sku="GIFT-BOX-01")
    )
    assert decision.policy_decision is not None
    assert decision.policy_decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL

    # HITL carts are policy-valid: the order is created in the held state so
    # the merchant's Approvals queue has a real order to act on.
    order = buyer.tools.create_order(decision=decision, intent=high, trace_id="trc_guards_held")
    assert order.requires_approval is True
    assert order.status.value == "AWAITING_CONSENT"
    held_actions = [r.action for r in core.ledger.for_trace("trc_guards_held")]
    assert "buyer.order_held" in held_actions
    # No consent exists for a held order.
    with pytest.raises(ValueError, match="requires merchant approval"):
        core.issue_consent(order.order_id)

    # A policy-DENIED cart is still refused outright.
    deny_decision = seller.respond(
        SellerRequest(
            message="gift box",
            intent=high.model_copy(update={"budget_ceiling_paise": 1_000}),
            requested_sku="GIFT-BOX-01",
        )
    )
    with pytest.raises(ValueError, match="policy-rejected"):
        buyer.tools.create_order(
            decision=deny_decision, intent=high, trace_id="trc_guards_deny"
        )


def test_buyer_hitl_flow_holds_order_and_continues_after_approval(
    core_and_engine,
) -> None:
    """Full HITL loop: held order → merchant approval → consent, same trace,
    no duplicate order."""
    core, _ = core_and_engine
    gateway = AgentGateway(core, SellerAgent(core))
    buyer = BuyerAgent(gateway)
    m = mission(
        message="I need a workday gift box",
        budget_ceiling_paise=300_000,
        requested_sku="GIFT-BOX-01",
    )
    result = buyer.run(m, trace_id="trc_guards_hitl_full")

    assert result.action is BuyerAction.NEEDS_HUMAN_APPROVAL
    assert result.order_id is not None
    assert result.consent_id is None
    assert "ORDER" in result.steps
    assert "CONSENT" not in result.steps
    order = core.get_order(result.order_id)
    assert order.requires_approval is True
    assert order.trace_id == "trc_guards_hitl_full"

    # Merchant approves from the Approvals queue; consent is then issued
    # against the SAME order — no duplicate is ever created.
    core.approve_order(order.order_id)
    consent = core.issue_consent(order.order_id)
    assert consent.order_id == order.order_id
    assert consent.amount_paise == order.amount_paise
    # Exactly one order exists for the whole loop.
    assert len(core.all_orders()) == 1
    trace_actions = [r.action for r in core.ledger.for_trace("trc_guards_hitl_full")]
    assert "buyer.order_held" in trace_actions
    assert "human.approval_granted" in trace_actions
    assert "consent.issued" in trace_actions


def test_buyer_negotiates_and_grounds_research_in_requested_sku(
    buyer: BuyerAgent, core_and_engine
) -> None:
    core, _ = core_and_engine
    # SNACK-COFFE-01 list 84_900, floor 74_900, 10% cap minimum 76_410.
    result = buyer.run(
        mission(
            message="coffee for my desk",
            budget_ceiling_paise=200_000,
            requested_sku="SNACK-COFFEE-01",
            quantity=1,
            buyer_offer_paise=80_000,
            request_upsell=False,
        )
    )

    assert result.action is BuyerAction.READY_FOR_CONSENT
    cart = result.seller_decision.cart
    assert cart is not None
    assert cart.items[0].sku == "SNACK-COFFEE-01"
    # Offer between the policy minimum and list price is accepted as-is.
    assert cart.items[0].offered_price_paise == 80_000
    assert cart.discount_paise == 4_900
    assert cart.negotiation_round == 1
    assert result.order_id is not None
    assert core.get_order(result.order_id).amount_paise == 80_000
    # Research was grounded on the real requested SKU.
    research = [
        r
        for r in core.ledger.for_trace(result.trace_id)
        if r.action == "buyer.catalog_researched"
    ]
    assert research[-1].output_json.get("requested_sku") == "SNACK-COFFEE-01"
    assert research[-1].output_json.get("matching_skus") == ["SNACK-COFFEE-01"]


def test_buyer_below_floor_offer_is_countered_at_policy_minimum(
    buyer: BuyerAgent,
) -> None:
    result = buyer.run(
        mission(
            message="coffee for my desk",
            budget_ceiling_paise=200_000,
            requested_sku="SNACK-COFFEE-01",
            buyer_offer_paise=60_000,
            request_upsell=False,
        )
    )

    assert result.action is BuyerAction.READY_FOR_CONSENT
    cart = result.seller_decision.cart
    assert cart is not None
    # The buyer's ₹600 number is never used: the counter is the policy minimum.
    assert cart.items[0].offered_price_paise == 76_410
    assert cart.items[0].offered_price_paise >= cart.items[0].unit_price_paise * 90 // 100
    assert cart.discount_paise == 84_900 - 76_410
    assert cart.negotiation_round == 1


def test_buyer_unknown_requested_sku_is_no_match(buyer: BuyerAgent) -> None:
    result = buyer.run(
        mission(
            message="hoverboard please",
            budget_ceiling_paise=200_000,
            requested_sku="FAKE-SKU-99",
        )
    )

    assert result.action is BuyerAction.NO_MATCH
    assert result.order_id is None
    assert result.consent_id is None


def test_buyer_mission_is_ledgered_for_activity_and_replay(
    buyer: BuyerAgent, core_and_engine
) -> None:
    core, _ = core_and_engine
    result = buyer.run(mission(message="I need coffee for my desk", budget_ceiling_paise=200_000))

    actions = [r.action for r in core.ledger.for_trace(result.trace_id)]
    assert "buyer.mission_received" in actions
    assert "buyer.discovered_merchant" in actions
    assert "buyer.catalog_researched" in actions
    # Order, consent, and mission all share the single flow trace.
    assert "order.created" in actions
    assert "consent.issued" in actions


def test_buyer_consent_requires_matching_trace(
    buyer: BuyerAgent, core_and_engine
) -> None:
    core, _ = core_and_engine
    order = core.create_order(
        cart=CartMandate(
            intent_ref="im_guards",
            items=[
                CartItem(
                    sku="AUDIO-CASE-01",
                    quantity=1,
                    unit_price_paise=69_900,
                    offered_price_paise=69_900,
                )
            ],
            subtotal_paise=69_900,
            discount_paise=0,
            total_paise=69_900,
            negotiation_round=0,
        ),
        intent=intent(),
        trace_id="trc_guards_consent",
        idempotency_key="idem_guards_consent_01",
    )
    with pytest.raises(ValueError, match="does not match"):
        buyer.tools.request_consent(order_id=order.order_id, trace_id="trc_wrong_trace")

    consent = buyer.tools.request_consent(
        order_id=order.order_id, trace_id="trc_guards_consent"
    )
    assert consent.order_id == order.order_id


def test_verify_payment_reads_authoritative_state(
    buyer: BuyerAgent, core_and_engine
) -> None:
    core, _ = core_and_engine
    order = core.create_order(
        cart=CartMandate(
            intent_ref="im_guards",
            items=[
                CartItem(
                    sku="AUDIO-CASE-01",
                    quantity=1,
                    unit_price_paise=69_900,
                    offered_price_paise=69_900,
                )
            ],
            subtotal_paise=69_900,
            discount_paise=0,
            total_paise=69_900,
            negotiation_round=0,
        ),
        intent=intent(),
        trace_id="trc_guards_verify",
        idempotency_key="idem_guards_verify_01",
    )
    seen = buyer.verify_payment(order.order_id)

    assert seen["status"] == "AWAITING_CONSENT"
    assert seen["trace_id"] == "trc_guards_verify"
    actions = [r.action for r in core.ledger.for_trace("trc_guards_verify")]
    assert "buyer.payment_verified" in actions
    with pytest.raises(ValueError, match="Order does not exist"):
        buyer.verify_payment("ord_no_such_order")


# ---------------------------------------------------------------------------
# Seller grounding: categories, upsell cap, validated phrasing
# ---------------------------------------------------------------------------


def test_seller_search_respects_allowed_categories(seller: SellerAgent) -> None:
    snacks_only = intent()
    snacks_only = snacks_only.model_copy(update={"allowed_categories": ["snacks"]})
    decision = seller.respond(
        SellerRequest(message="travel case", intent=snacks_only),
        trace_id="trc_guards_cats",
    )

    # "travel case" only matches accessories SKUs — with a snacks-only mandate
    # the seller must find nothing, not quote a disallowed category.
    assert decision.action is SellerAction.NO_MATCH

    control = seller.respond(
        SellerRequest(message="travel case", intent=intent()),
        trace_id="trc_guards_cats2",
    )
    assert control.action is SellerAction.QUOTE_READY
    assert control.cart is not None
    assert control.cart.items[0].sku == "AUDIO-CASE-01"


def test_upsell_disabled_when_cap_is_zero(core_and_engine) -> None:
    core, engine = core_and_engine
    zero_policy = core.policy.model_copy(update={"max_upsells_per_session": 0})
    capped = CommerceCore(
        catalog=core.catalog,
        policy=zero_policy,
        ledger=core.ledger,
        engine=engine,
        merchant_scope=core.policy.merchant_id,
    )
    agent = SellerAgent(capped)
    decision = agent.respond(
        SellerRequest(message="coffee for my desk", intent=intent(budget=200_000)),
        trace_id="trc_guards_upsell",
    )

    # SNACK-COFFEE-01 would normally upsell SNACK-MUG-01 (total 194_800, the
    # control case in test_buyer_agent) — a cap of 0 must suppress it.
    assert decision.action is SellerAction.QUOTE_READY
    assert decision.upsell_product is None
    assert decision.cart is not None
    assert decision.cart.total_paise == 84_900


class _HallucinatingLLM:
    model = "unit-test-hallucinator"

    def complete(self, messages, *, temperature=None, tools=None, timeout=90) -> str:
        return "Grab FAKE-SKU-99 right now for just a hundred rupees!"


def test_seller_rephrase_rejects_unknown_sku(core_and_engine) -> None:
    core, _ = core_and_engine
    agent = SellerAgent(core, llm=_HallucinatingLLM())
    decision = agent.respond(
        SellerRequest(message="coffee for my desk", intent=intent(budget=200_000)),
        trace_id="trc_guards_phrase",
    )

    assert "FAKE-SKU-99" not in decision.response_message
    assert decision.response_message == "Here is a policy-valid candidate cart."
    phrased = [
        r
        for r in core.ledger.for_trace("trc_guards_phrase")
        if r.action == "seller.response_phrased"
    ]
    assert len(phrased) == 1
    assert phrased[0].output_json.get("llm_used") is False


def test_reply_skus_known() -> None:
    assert reply_skus_known("Here is AUDIO-CASE-01.", {"AUDIO-CASE-01"}) is True
    assert reply_skus_known("No SKUs here, just words.", {"AUDIO-CASE-01"}) is True
    assert reply_skus_known("Buy FAKE-SKU-99 now.", {"AUDIO-CASE-01"}) is False
    # "1-2" and lowercase hyphenations are not SKU-shaped.
    assert reply_skus_known("Options 1-2 look good.", set()) is True
    assert reply_skus_known("A well-known great pick.", set()) is True


def test_reply_amounts_known() -> None:
    authoritative = {2_499_900}  # ₹24,999.00 in paise
    # Exact copies of the authoritative amount pass, in any faithful format.
    assert reply_amounts_known("That desk is priced at ₹24,999.", authoritative) is True
    assert reply_amounts_known("That desk is priced at ₹24,999.00.", authoritative) is True
    assert reply_amounts_known("Rs. 24999, within budget.", authoritative) is True
    assert reply_amounts_known("INR 24,999.00 total.", authoritative) is True
    assert reply_amounts_known("Total 2499900 paise.", authoritative) is True
    # No money amounts at all passes trivially.
    assert reply_amounts_known("Would you like to continue?", authoritative) is True
    # The classic paise/rupee slips: converted, rounded, or 10x figures fail.
    assert reply_amounts_known("That desk is priced at ₹249,999.", authoritative) is False
    assert reply_amounts_known("That desk is priced at ₹2,49,990.", authoritative) is False
    assert reply_amounts_known("Priced at 24999900 paise.", authoritative) is False
    assert reply_amounts_known("₹24,999.50 — a fair deal.", authoritative) is False
    # A mix of one correct and one invented amount fails closed.
    assert reply_amounts_known("₹24,999 total, shipping ₹500 extra.", authoritative) is False
    # The buyer budget echo is only allowed when it is itself authoritative.
    assert reply_amounts_known("within your ₹30,000 budget.", {3_000_000}) is True
    assert reply_amounts_known("within your ₹30,000 budget.", {2_499_900}) is False


def test_buyer_policy_evaluate_covers_expiry_and_budget() -> None:
    policy = BuyerPolicy()
    expired_intent = intent().model_copy(
        update={"expires_at": utc_now() - timedelta(minutes=1)}
    )
    cart = CartMandate(
        intent_ref="im_guards",
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=69_900,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=0,
        total_paise=69_900,
        negotiation_round=0,
    )
    assert policy.evaluate(cart=cart, intent=expired_intent).reason_code == "MANDATE_EXPIRED"
    assert (
        policy.evaluate(cart=cart, intent=intent(budget=10_000)).reason_code
        == "OVER_BUDGET"
    )
    assert policy.evaluate(cart=cart, intent=intent()).allowed is True
