"""Deterministic promotion engine (target §20.3, §20.4).

Candidate promotions → eligibility engine → stacking/conflict engine →
budget/cap engine → selected set → price effect. The LLM can explain a
promotion but can never invent one: evaluation runs only over persisted
``Promotion`` rows. No database access here — the caller supplies the
candidate list and recorded usage; ``PromotionRepository`` owns storage.
"""

from __future__ import annotations

from datetime import datetime

from sellable.contracts import Promotion, PromotionResult, PromotionStatus, PromotionType, StackingRule, utc_now


class PromotionLine:
    """Evaluation input: one priced line with its catalog category."""

    __slots__ = ("sku", "quantity", "unit_price_paise", "category")

    def __init__(self, sku: str, quantity: int, unit_price_paise: int, category: str = "") -> None:
        self.sku = sku
        self.quantity = quantity
        self.unit_price_paise = unit_price_paise
        self.category = category

    @property
    def line_total(self) -> int:
        return self.quantity * self.unit_price_paise


class PromotionEngine:
    def evaluate(
        self,
        *,
        lines: list[PromotionLine],
        promotions: list[Promotion],
        customer_id: str | None = None,
        channel: str = "agent",
        coupon_code: str | None = None,
        usage: dict[str, dict[str, int]] | None = None,
        now: datetime | None = None,
    ) -> PromotionResult:
        """Run the §20.4 pipeline over ACTIVE candidate promotions."""
        moment = now or utc_now()
        used = usage or {}
        subtotal = sum(line.line_total for line in lines)
        by_sku = {line.sku: line for line in lines}

        eligible: list[tuple[Promotion, int, str]] = []  # (promotion, discount, note)
        for promotion in promotions:
            if promotion.status is not PromotionStatus.ACTIVE:
                continue
            if not (promotion.start_at <= moment and (promotion.end_at is None or moment < promotion.end_at)):
                continue
            skip = self._eligibility_note(
                promotion,
                lines=lines,
                by_sku=by_sku,
                subtotal=subtotal,
                customer_id=customer_id,
                channel=channel,
                coupon_code=coupon_code,
                used=used.get(promotion.promotion_id, {"count": 0, "discount_paise": 0}),
            )
            if skip is not None:
                continue
            discount = self._discount_for(promotion, lines=lines, by_sku=by_sku, subtotal=subtotal)
            if discount <= 0 and not promotion.free_shipping:
                continue
            eligible.append((promotion, discount, f"Applied {promotion.title}."))

        if not eligible:
            return PromotionResult()

        exclusive = [(p, d, n) for p, d, n in eligible if p.stacking is StackingRule.EXCLUSIVE]
        if exclusive:
            # An exclusive promotion never stacks: take the best single offer
            # by discount, then merchant priority.
            exclusive.sort(key=lambda item: (item[1], item[0].priority), reverse=True)
            promotion, discount, note = exclusive[0]
            return PromotionResult(
                applied_promotion_ids=[promotion.promotion_id],
                discount_total_paise=discount,
                free_shipping=promotion.free_shipping,
                explanations=[note],
                discount_by_promotion={promotion.promotion_id: discount},
            )

        applied = [p.promotion_id for p, _, _ in eligible]
        return PromotionResult(
            applied_promotion_ids=applied,
            discount_total_paise=min(sum(d for _, d, _ in eligible), subtotal),
            free_shipping=any(p.free_shipping for p, _, _ in eligible),
            explanations=[note for _, _, note in eligible],
            discount_by_promotion={p.promotion_id: d for p, d, _ in eligible},
        )

    # ------------------------------------------------------------------
    # Eligibility (§20.4)
    # ------------------------------------------------------------------

    def _eligibility_note(
        self,
        promotion: Promotion,
        *,
        lines: list[PromotionLine],
        by_sku: dict[str, PromotionLine],
        subtotal: int,
        customer_id: str | None,
        channel: str,
        coupon_code: str | None,
        used: dict[str, int],
    ) -> str | None:
        """None when eligible, else the skip reason (for debugging only)."""
        if subtotal < promotion.min_cart_total_paise:
            return "below minimum cart total"
        if promotion.redemption_limit is not None and used.get("count", 0) >= promotion.redemption_limit:
            return "redemption limit reached"
        if (
            promotion.budget_limit_paise is not None
            and used.get("discount_paise", 0) >= promotion.budget_limit_paise
        ):
            return "promotion budget exhausted"
        if promotion.coupon_code and promotion.coupon_code != (coupon_code or ""):
            return "coupon code required"
        if promotion.customer_ids and (customer_id or "") not in promotion.customer_ids:
            return "customer not in segment"
        if promotion.channels and channel not in promotion.channels:
            return "channel not eligible"
        if promotion.kind == PromotionType.BUNDLE and not all(
            sku in by_sku for sku in promotion.bundle_skus
        ):
            return "bundle incomplete"
        if promotion.kind == PromotionType.BUY_X_GET_Y and promotion.buy_sku not in by_sku:
            return "qualifying SKU absent"
        if promotion.kind == PromotionType.VOLUME_DISCOUNT and (
            promotion.volume_sku not in by_sku
            or by_sku[promotion.volume_sku].quantity < promotion.volume_min_quantity
        ):
            return "volume threshold unmet"
        if (promotion.product_skus or promotion.categories) and not any(
            line.sku in promotion.product_skus or line.category in promotion.categories
            for line in lines
        ):
            return "no eligible product in cart"
        return None

    # ------------------------------------------------------------------
    # Discount math (per-kind, always capped)
    # ------------------------------------------------------------------

    def _discount_for(
        self,
        promotion: Promotion,
        *,
        lines: list[PromotionLine],
        by_sku: dict[str, PromotionLine],
        subtotal: int,
    ) -> int:
        base = self._scoped_subtotal(promotion, lines, subtotal)
        kind = promotion.kind
        if kind in (
            PromotionType.PERCENTAGE_DISCOUNT,
            PromotionType.LIMITED_TIME_OFFER,
            PromotionType.CUSTOMER_SEGMENT_OFFER,
            PromotionType.AGENT_CHANNEL_OFFER,
            PromotionType.COUPON,
        ):
            if promotion.percent_bps > 0:
                discount = base * promotion.percent_bps // 10_000
            else:
                discount = min(promotion.amount_paise, base)
        elif kind == PromotionType.FIXED_DISCOUNT:
            discount = min(promotion.amount_paise, base)
        elif kind == PromotionType.BUNDLE:
            discount = min(promotion.bundle_amount_paise, subtotal)
        elif kind == PromotionType.BUY_X_GET_Y:
            line = by_sku[promotion.buy_sku or ""]
            sets = line.quantity // (promotion.buy_quantity + promotion.get_quantity)
            discount = min(sets * promotion.get_quantity * line.unit_price_paise, line.line_total)
        elif kind == PromotionType.VOLUME_DISCOUNT:
            line = by_sku[promotion.volume_sku or ""]
            discount = line.line_total * promotion.percent_bps // 10_000
        elif kind == PromotionType.FREE_SHIPPING:
            discount = 0
        else:  # pragma: no cover — exhaustive over PromotionType
            discount = 0
        if promotion.max_discount_paise is not None:
            discount = min(discount, promotion.max_discount_paise)
        return max(discount, 0)

    @staticmethod
    def _scoped_subtotal(
        promotion: Promotion, lines: list[PromotionLine], subtotal: int
    ) -> int:
        """Discount base: matching lines when the promotion scopes products,
        otherwise the whole cart."""
        if not promotion.product_skus and not promotion.categories:
            return subtotal
        return sum(
            line.line_total
            for line in lines
            if line.sku in promotion.product_skus or line.category in promotion.categories
        )
