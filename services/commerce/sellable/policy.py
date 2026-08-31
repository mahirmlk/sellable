"""Pure policy engine. It has no agent or payment-provider dependency."""

from __future__ import annotations

from collections.abc import Mapping

from sellable.contracts import (
    CartMandate,
    IntentMandate,
    MerchantPolicy,
    PolicyDecision,
    PolicyVerdict,
    Product,
)


class PolicyEngine:
    def evaluate_cart(
        self,
        *,
        cart: CartMandate,
        intent: IntentMandate,
        policy: MerchantPolicy,
        products: Mapping[str, Product],
        upsells_in_session: int = 0,
    ) -> PolicyDecision:
        if intent.expires_at <= cart.created_at:
            return self._deny(
                "MANDATE_EXPIRED",
                "The buyer mandate has expired and cannot authorize a new cart.",
                "POLICY.mandate_expiry",
            )
        if cart.negotiation_round > policy.max_negotiation_rounds:
            return self._deny(
                "MAX_NEGOTIATION_ROUNDS",
                "The cart exceeds the merchant's configured negotiation-round limit.",
                "POLICY.max_negotiation_rounds",
            )
        if cart.upsell_offered and upsells_in_session >= policy.max_upsells_per_session:
            return self._deny(
                "DUPLICATE_UPSELL",
                "The merchant has already reached the allowed upsell limit for this session.",
                "POLICY.max_upsells_per_session",
            )

        total_discount = 0
        for item in cart.items:
            product = products.get(item.sku)
            if product is None:
                return self._deny(
                    "UNKNOWN_SKU",
                    f"{item.sku} is not present in the merchant catalog.",
                    "POLICY.catalog_grounding",
                )
            if product.category not in intent.allowed_categories:
                return self._deny(
                    "CATEGORY_NOT_ALLOWED",
                    f"{product.category} is outside the buyer mandate's allowed categories.",
                    "POLICY.buyer_allowed_categories",
                )
            if product.category not in policy.allowed_categories:
                return self._deny(
                    "MERCHANT_CATEGORY_NOT_ALLOWED",
                    f"{product.category} is not currently sellable under merchant policy.",
                    "POLICY.merchant_allowed_categories",
                )
            if item.quantity > product.stock:
                return self._deny(
                    "INSUFFICIENT_STOCK",
                    f"Only {product.stock} units of {item.sku} are currently available.",
                    "POLICY.stock",
                )
            if item.unit_price_paise != product.price_paise:
                return self._deny(
                    "UNTRUSTED_LIST_PRICE",
                    "The cart list price does not match the authoritative catalog price.",
                    "POLICY.catalog_price",
                )
            if item.offered_price_paise < product.floor_paise:
                return self._deny(
                    "BELOW_FLOOR_PRICE",
                    f"The offered price for {item.sku} is below the merchant floor price.",
                    "POLICY.floor_price",
                )
            if (
                item.unit_price_paise > policy.max_single_item_value_paise
                or item.offered_price_paise > policy.max_single_item_value_paise
            ):
                return self._deny(
                    "ITEM_OVER_LIMIT",
                    f"{item.sku} exceeds the merchant's maximum single-item value.",
                    "POLICY.max_single_item_value",
                )
            total_discount += (item.unit_price_paise - item.offered_price_paise) * item.quantity

        if cart.total_paise > intent.budget_ceiling_paise:
            return self._deny(
                "OVER_BUDGET",
                "The cart total exceeds the buyer mandate's budget ceiling.",
                "POLICY.buyer_budget",
            )
        if cart.total_paise > policy.max_order_value_paise:
            return self._deny(
                "MERCHANT_POLICY_LIMIT",
                "The cart total exceeds the merchant's maximum order value.",
                "POLICY.max_order_value",
            )
        if total_discount * 100 > cart.subtotal_paise * policy.max_discount_percent:
            return self._deny(
                "MAX_DISCOUNT_EXCEEDED",
                "The negotiated discount exceeds the merchant's configured discount cap.",
                "POLICY.max_discount_percent",
            )
        if cart.total_paise >= policy.human_approval_threshold_paise:
            return PolicyDecision(
                verdict=PolicyVerdict.NEEDS_HUMAN_APPROVAL,
                reason_code="ABOVE_APPROVAL_THRESHOLD",
                reasoning_summary=(
                    "The cart is valid but exceeds the merchant's human-approval threshold."
                ),
                policy_refs=[
                    "POLICY.buyer_budget",
                    "POLICY.max_order_value",
                    "POLICY.human_approval_threshold",
                ],
            )
        return PolicyDecision(
            verdict=PolicyVerdict.ALLOW,
            reasoning_summary=(
                "The cart is within the buyer mandate, merchant limits, catalog floors, and stock."
            ),
            policy_refs=[
                "POLICY.buyer_budget",
                "POLICY.max_order_value",
                "POLICY.floor_price",
                "POLICY.stock",
            ],
        )

    @staticmethod
    def _deny(reason_code: str, explanation: str, policy_ref: str) -> PolicyDecision:
        return PolicyDecision(
            verdict=PolicyVerdict.DENY,
            reason_code=reason_code,
            reasoning_summary=explanation,
            policy_refs=[policy_ref],
        )
