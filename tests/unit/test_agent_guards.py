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
from agents.llm.adapters.base import reply_skus_known
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


def test_buyer_tool_refuses_non_allow_order(
    buyer: BuyerAgent, seller: SellerAgent
) -> None:
    high = intent(budget=300_000)
    decision = seller.respond(
        SellerRequest(message="gift box", intent=high, requested_sku="GIFT-BOX-01")
    )
    assert decision.policy_decision is not None
    assert decision.policy_decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL

    with pytest.raises(ValueError, match="non-ALLOW"):
        buyer.tools.create_order(decision=decision, intent=high, trace_id="trc_guards_held")


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

    def complete(self, messages, *, temperature=None, tools=None) -> str:
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
