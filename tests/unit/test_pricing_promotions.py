"""Phase 2b: deterministic pricing (§20.1) and promotion evaluation (§20.4).

No database: the engine and pricing service are pure over supplied inputs.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from sellable.contracts import (
    CartLine,
    Promotion,
    PromotionStatus,
    PromotionType,
    StackingRule,
    utc_now,
)
from sellable.pricing import PricingError, PricingService
from sellable.promotions import PromotionEngine, PromotionLine


def _line(sku: str = "AUDIO-CASE-01", quantity: int = 1, unit: int = 69_900) -> CartLine:
    return CartLine(sku=sku, quantity=quantity, unit_price_paise=unit)


def _plines() -> list[PromotionLine]:
    return [
        PromotionLine(sku="AUDIO-CASE-01", quantity=1, unit_price_paise=69_900, category="accessories"),
        PromotionLine(sku="GIFT-BOX-01", quantity=1, unit_price_paise=249_900, category="gifting"),
    ]


def _promo(**overrides) -> Promotion:
    base = {
        "merchant_id": "mrc_test",
        "kind": PromotionType.PERCENTAGE_DISCOUNT,
        "title": "Ten percent off",
        "percent_bps": 1_000,
        "start_at": utc_now() - timedelta(hours=1),
    }
    base.update(overrides)
    return Promotion(**base)


ENGINE = PromotionEngine()
SUBTOTAL = 69_900 + 249_900  # 319_800


# --- Pricing ---------------------------------------------------------------


def _pricing() -> PricingService:
    from sellable.catalog import CatalogService
    from sellable.contracts import Product

    products = [
        Product(
            merchant_id="mrc_test",
            sku="AUDIO-CASE-01",
            title="Audio case",
            description="A case",
            price_paise=69_900,
            floor_paise=50_000,
            stock=45,
            category="accessories",
        ),
        Product(
            merchant_id="mrc_test",
            sku="GIFT-BOX-01",
            title="Gift box",
            description="A box",
            price_paise=249_900,
            floor_paise=200_000,
            stock=16,
            category="gifting",
        ),
    ]
    return PricingService(CatalogService(products))


def test_price_base_totals() -> None:
    breakdown = _pricing().price([_line(), _line("GIFT-BOX-01", 1, 249_900)])
    assert breakdown.subtotal_paise == SUBTOTAL
    assert breakdown.grand_total_paise == SUBTOTAL
    assert breakdown.discount_total_paise == 0


def test_price_rejects_stale_snapshot_and_below_floor() -> None:
    pricing = _pricing()
    with pytest.raises(PricingError, match="stale price"):
        pricing.price([_line(unit=1_000)])
    with pytest.raises(PricingError, match="below floor"):
        pricing.price([_line()], negotiated_units={"AUDIO-CASE-01": 1_000})
    with pytest.raises(PricingError, match="exceeds list"):
        pricing.price([_line()], negotiated_units={"AUDIO-CASE-01": 99_999_900})
    with pytest.raises(PricingError, match="empty cart"):
        pricing.price([])


def test_price_applies_negotiation_and_promotion() -> None:
    pricing = _pricing()
    breakdown = pricing.price(
        [_line()],
        negotiated_units={"AUDIO-CASE-01": 60_000},
        promotion=None,
        tax_total_paise=1_000,
        shipping_total_paise=500,
    )
    assert breakdown.negotiated_discount_paise == 9_900
    assert breakdown.grand_total_paise == 60_000 + 1_500

    from sellable.contracts import PromotionResult

    promo = PromotionResult(applied_promotion_ids=["promo_1"], discount_total_paise=6_000)
    breakdown = pricing.price([_line()], promotion=promo)
    assert breakdown.promotion_discount_paise == 6_000
    assert breakdown.grand_total_paise == 63_900


# --- Promotion eligibility ---------------------------------------------------


def test_no_promotions_no_discount() -> None:
    result = ENGINE.evaluate(lines=_plines(), promotions=[])
    assert result.discount_total_paise == 0
    assert result.applied_promotion_ids == []


def test_percentage_and_fixed_and_caps() -> None:
    percent = ENGINE.evaluate(lines=_plines(), promotions=[_promo()])
    assert percent.discount_total_paise == SUBTOTAL * 1_000 // 10_000

    fixed = ENGINE.evaluate(
        lines=_plines(),
        promotions=[_promo(kind=PromotionType.FIXED_DISCOUNT, amount_paise=5_000)],
    )
    assert fixed.discount_total_paise == 5_000

    capped = ENGINE.evaluate(
        lines=_plines(),
        promotions=[_promo(max_discount_paise=1_000)],
    )
    assert capped.discount_total_paise == 1_000


def test_window_status_and_min_total_gate() -> None:
    future = _promo(start_at=utc_now() + timedelta(hours=1))
    assert ENGINE.evaluate(lines=_plines(), promotions=[future]).discount_total_paise == 0
    paused = _promo(status=PromotionStatus.PAUSED)
    assert ENGINE.evaluate(lines=_plines(), promotions=[paused]).discount_total_paise == 0
    min_total = _promo(min_cart_total_paise=SUBTOTAL + 1)
    assert ENGINE.evaluate(lines=_plines(), promotions=[min_total]).discount_total_paise == 0


def test_coupon_customer_channel_scopes() -> None:
    coupon = _promo(
        kind=PromotionType.COUPON,
        coupon_code="DIWALI10",
        percent_bps=0,
        amount_paise=2_000,
    )
    assert ENGINE.evaluate(lines=_plines(), promotions=[coupon]).discount_total_paise == 0
    assert (
        ENGINE.evaluate(lines=_plines(), promotions=[coupon], coupon_code="DIWALI10").discount_total_paise
        == 2_000
    )
    segment = _promo(
        kind=PromotionType.FIXED_DISCOUNT,
        amount_paise=3_000,
        customer_ids=["cust_vip"],
    )
    assert ENGINE.evaluate(lines=_plines(), promotions=[segment]).discount_total_paise == 0
    assert (
        ENGINE.evaluate(lines=_plines(), promotions=[segment], customer_id="cust_vip").discount_total_paise
        == 3_000
    )
    channel = _promo(
        kind=PromotionType.FIXED_DISCOUNT,
        amount_paise=1_500,
        channels=["chat"],
    )
    assert ENGINE.evaluate(lines=_plines(), promotions=[channel]).discount_total_paise == 0
    assert (
        ENGINE.evaluate(lines=_plines(), promotions=[channel], channel="chat").discount_total_paise
        == 1_500
    )


def test_product_scoped_percentage() -> None:
    scoped = _promo(product_skus=["AUDIO-CASE-01"])
    result = ENGINE.evaluate(lines=_plines(), promotions=[scoped])
    assert result.discount_total_paise == 69_900 * 1_000 // 10_000


def test_bundle_and_buy_x_get_y_and_volume() -> None:
    bundle = _promo(
        kind=PromotionType.BUNDLE,
        bundle_skus=["AUDIO-CASE-01", "GIFT-BOX-01"],
        bundle_amount_paise=10_000,
    )
    assert ENGINE.evaluate(lines=_plines(), promotions=[bundle]).discount_total_paise == 10_000
    incomplete = _promo(
        kind=PromotionType.BUNDLE,
        bundle_skus=["AUDIO-CASE-01", "MISSING-01"],
        bundle_amount_paise=10_000,
    )
    assert ENGINE.evaluate(lines=_plines(), promotions=[incomplete]).discount_total_paise == 0

    bogo = _promo(
        kind=PromotionType.BUY_X_GET_Y,
        buy_sku="AUDIO-CASE-01",
        buy_quantity=1,
        get_quantity=1,
    )
    lines = [PromotionLine(sku="AUDIO-CASE-01", quantity=3, unit_price_paise=10_000, category="x")]
    assert ENGINE.evaluate(lines=lines, promotions=[bogo]).discount_total_paise == 10_000

    volume = _promo(
        kind=PromotionType.VOLUME_DISCOUNT,
        volume_sku="AUDIO-CASE-01",
        volume_min_quantity=2,
        percent_bps=2_000,
    )
    assert (
        ENGINE.evaluate(lines=lines, promotions=[volume]).discount_total_paise
        == 30_000 * 2_000 // 10_000
    )


def test_exclusive_beats_stackables() -> None:
    stackable = _promo(kind=PromotionType.FIXED_DISCOUNT, title="stack", amount_paise=1_000)
    exclusive = _promo(
        title="exclusive",
        kind=PromotionType.FIXED_DISCOUNT,
        amount_paise=50_000,
        stacking=StackingRule.EXCLUSIVE,
    )
    result = ENGINE.evaluate(lines=_plines(), promotions=[stackable, exclusive])
    assert result.discount_total_paise == 50_000
    assert len(result.applied_promotion_ids) == 1


def test_stackables_sum_and_free_shipping_flag() -> None:
    first = _promo(kind=PromotionType.FIXED_DISCOUNT, title="a", amount_paise=1_000)
    second = _promo(kind=PromotionType.FIXED_DISCOUNT, title="b", amount_paise=2_000, free_shipping=True)
    result = ENGINE.evaluate(lines=_plines(), promotions=[first, second])
    assert result.discount_total_paise == 3_000
    assert result.free_shipping is True
    assert sum(result.discount_by_promotion.values()) == 3_000


def test_budget_and_redemption_limits() -> None:
    limited = _promo(redemption_limit=1)
    usage = {limited.promotion_id: {"count": 1, "discount_paise": 100}}
    assert ENGINE.evaluate(lines=_plines(), promotions=[limited], usage=usage).discount_total_paise == 0
    budgeted = _promo(budget_limit_paise=500)
    usage = {budgeted.promotion_id: {"count": 1, "discount_paise": 500}}
    assert ENGINE.evaluate(lines=_plines(), promotions=[budgeted], usage=usage).discount_total_paise == 0


def test_promotion_contract_validation() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _promo(kind=PromotionType.COUPON)  # coupon without code
    with pytest.raises(ValidationError):
        _promo(
            kind=PromotionType.BUNDLE, bundle_skus=["ONLY-ONE"], bundle_amount_paise=100
        )
