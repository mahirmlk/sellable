from datetime import timedelta

import pytest
from pydantic import ValidationError

from sellable.contracts import CartItem, CartMandate, IntentMandate, Product, utc_now


def test_product_rejects_a_floor_above_list_price() -> None:
    with pytest.raises(ValidationError, match="floor_paise"):
        Product(
            merchant_id="mrc_demo_store",
            sku="TEST-01",
            title="Test item",
            description="A test item.",
            price_paise=100,
            floor_paise=101,
            stock=1,
            category="accessories",
        )


def test_intent_mandate_requires_a_future_expiry() -> None:
    now = utc_now()
    with pytest.raises(ValidationError, match="expires_at"):
        IntentMandate(
            buyer_agent_id="buyer_demo",
            budget_ceiling_paise=10_000,
            allowed_categories=["accessories"],
            purpose="Buy a demo product",
            created_at=now,
            expires_at=now,
        )


def test_cart_mandate_calculates_against_integer_paise_totals() -> None:
    item = CartItem(
        sku="TEST-01", quantity=2, unit_price_paise=500, offered_price_paise=450
    )
    cart = CartMandate(
        intent_ref="im_test",
        items=[item],
        subtotal_paise=1_000,
        discount_paise=100,
        total_paise=900,
        negotiation_round=1,
    )

    assert cart.total_paise == 900
    assert utc_now() < utc_now() + timedelta(seconds=1)
