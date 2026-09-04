"""Merchant policy configurability: persisted values drive evaluation.

Proves the checkout knobs from the merchant console (max single-item value,
HITL threshold, order ceiling) are read from the persisted merchant policy —
never from a hardcoded constant — and apply identically to the human chat
path and the agent-to-agent path. Per-test policies only; the shipped
DEFAULT_POLICY is asserted unchanged, not modified.
"""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from agents.seller.agent import SellerAction, SellerAgent, SellerRequest
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    MerchantPolicy,
    PolicyVerdict,
    utc_now,
)
from sellable.catalog import CatalogService
from sellable.contracts import Product
from sellable.core import CommerceCore
from sellable.gateway import AgentGateway
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.policy import PolicyEngine
from sellable.registry import (
    DEFAULT_POLICY,
    MerchantRegistry,
    load_policy_for,
    save_policy_for,
)

# Chair-scale figures mirroring the reported demo catalog item. These live
# only in test fixtures — production values come from each merchant's own
# persisted policy row, editable in Settings.
CHAIR_SKU = "CHAIR-PRO-01"
CHAIR_PRICE = 1_299_900
CHAIR_FLOOR = 1_099_900


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


def chair_product(merchant_id: str = "mrc_demo_config") -> Product:
    return Product(
        merchant_id=merchant_id,
        sku=CHAIR_SKU,
        title="ErgoPro Office Chair",
        description="Ergonomic office chair",
        price_paise=CHAIR_PRICE,
        floor_paise=CHAIR_FLOOR,
        stock=10,
        category="accessories",
        attributes={},
    )


def chair_policy(merchant_id: str = "mrc_demo_config") -> MerchantPolicy:
    return MerchantPolicy(
        merchant_id=merchant_id,
        currency="INR",
        max_order_value_paise=2_000_000,
        max_single_item_value_paise=1_500_000,
        max_discount_percent=10,
        allowed_categories=["accessories", "gifting", "snacks"],
        max_negotiation_rounds=5,
        max_upsells_per_session=1,
        human_approval_threshold_paise=1_000_000,
    )


def chair_cart() -> CartMandate:
    return CartMandate(
        intent_ref="im_config",
        items=[
            CartItem(
                sku=CHAIR_SKU,
                quantity=1,
                unit_price_paise=CHAIR_PRICE,
                offered_price_paise=CHAIR_PRICE,
            )
        ],
        subtotal_paise=CHAIR_PRICE,
        discount_paise=0,
        total_paise=CHAIR_PRICE,
        negotiation_round=0,
    )


def chair_intent(*, budget: int = 1_500_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_config",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Config regression run",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def chair_core(engine, merchant_id: str = "mrc_demo_config") -> CommerceCore:
    return CommerceCore(
        catalog=CatalogService([chair_product(merchant_id)]),
        policy=chair_policy(merchant_id),
        ledger=LedgerRepository(engine),
        engine=engine,
        merchant_scope=merchant_id,
    )


def test_shipped_defaults_still_reject_chair_scale_item(engine) -> None:
    """Defaults are unchanged: a ₹12,999 item exceeds the ₹3,000 default cap.

    This documents current default behavior without modifying it — merchants
    raise their own caps in Settings.
    """
    assert DEFAULT_POLICY["max_single_item_value_paise"] == 300_000
    assert DEFAULT_POLICY["human_approval_threshold_paise"] == 200_000
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    decision = PolicyEngine().evaluate_cart(
        cart=chair_cart(),
        intent=chair_intent(),
        policy=core.policy,
        products={CHAIR_SKU: chair_product()},
    )
    assert decision.verdict is PolicyVerdict.DENY
    assert decision.reason_code == "ITEM_OVER_LIMIT"


def test_configured_item_cap_allows_chair_to_hitl(engine) -> None:
    core = chair_core(engine)
    decision = core.evaluate_quote(
        cart=chair_cart(), intent=chair_intent(), trace_id="trc_config_item"
    )
    assert decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL
    assert decision.reason_code == "ABOVE_APPROVAL_THRESHOLD"


def test_session_budget_and_item_cap_are_independent(engine) -> None:
    core = chair_core(engine)
    # Merchant caps pass, but the buyer-side session budget is its own knob:
    # a budget below the cart total still denies, whatever the merchant allows.
    decision = core.evaluate_quote(
        cart=chair_cart(),
        intent=chair_intent(budget=1_000_000),
        trace_id="trc_config_budget",
    )
    assert decision.verdict is PolicyVerdict.DENY
    assert decision.reason_code == "OVER_BUDGET"


def test_hitl_approve_then_consent_flow(engine) -> None:
    core = chair_core(engine)
    order = core.create_order(
        cart=chair_cart(),
        intent=chair_intent(),
        trace_id="trc_config_hitl",
        idempotency_key="idem_config_hitl_0001",
    )
    assert order.requires_approval is True
    with pytest.raises(ValueError, match="requires merchant approval"):
        core.issue_consent(order.order_id)
    core.approve_order(order.order_id)
    consent = core.issue_consent(order.order_id)
    assert consent.amount_paise == CHAIR_PRICE


def test_below_floor_denies_without_touching_payments(engine) -> None:
    core = chair_core(engine)
    cheap = chair_cart().model_copy(
        update={
            "items": [
                CartItem(
                    sku=CHAIR_SKU,
                    quantity=1,
                    unit_price_paise=CHAIR_PRICE,
                    offered_price_paise=CHAIR_FLOOR - 100,
                )
            ],
            "subtotal_paise": CHAIR_PRICE,
            "discount_paise": CHAIR_PRICE - (CHAIR_FLOOR - 100),
            "total_paise": CHAIR_FLOOR - 100,
        }
    )
    decision = core.evaluate_quote(
        cart=cheap, intent=chair_intent(), trace_id="trc_config_floor"
    )
    assert decision.verdict is PolicyVerdict.DENY
    assert decision.reason_code == "BELOW_FLOOR_PRICE"
    with pytest.raises(ValueError, match="blocked by policy"):
        core.create_order(
            cart=cheap,
            intent=chair_intent(),
            trace_id="trc_config_floor",
            idempotency_key="idem_config_floor_0001",
        )
    assert core.all_orders() == []
    actions = [r.action for r in core.ledger.for_trace("trc_config_floor")]
    assert "payment.attempted" not in actions


def test_a2a_path_uses_same_merchant_policy(engine) -> None:
    """The machine path (gateway/seller) enforces the identical policy."""
    core = chair_core(engine)
    gateway = AgentGateway(core, SellerAgent(core))
    decision = gateway.create_quote(
        SellerRequest(
            message="I need an office chair under 15K",
            intent=chair_intent(),
            requested_sku=CHAIR_SKU,
        ),
        trace_id="trc_config_a2a",
    )
    assert decision.action is SellerAction.NEEDS_HUMAN_APPROVAL
    assert decision.cart is not None
    assert decision.cart.total_paise == CHAIR_PRICE


def test_registry_round_trip_persists_custom_policy(engine) -> None:
    """save_policy_for → invalidate → get returns the merchant's values."""
    registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    merchant_id = "mrc_config_roundtrip"
    save_policy_for(chair_policy(merchant_id), engine=engine)
    registry.invalidate(merchant_id)

    loaded = load_policy_for(merchant_id, engine=engine)
    assert loaded.max_single_item_value_paise == 1_500_000
    assert loaded.human_approval_threshold_paise == 1_000_000
    assert loaded.max_order_value_paise == 2_000_000

    core = registry.get(merchant_id)
    assert core.policy.max_single_item_value_paise == 1_500_000
    decision = PolicyEngine().evaluate_cart(
        cart=chair_cart(),
        intent=chair_intent(),
        policy=core.policy,
        products={CHAIR_SKU: chair_product(merchant_id)},
    )
    assert decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL
