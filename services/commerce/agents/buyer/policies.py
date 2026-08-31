"""Buyer-side policy — the independent budget/constraint guard (§10).

The buyer's hard cap is enforced independently of the merchant policy::

    Buyer Policy AND Merchant Policy AND Consent => payment allowed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sellable.contracts import CartMandate, IntentMandate, utc_now


@dataclass(frozen=True)
class BuyerPolicyVerdict:
    allowed: bool
    reason_code: str | None = None
    explanation: str = ""


class BuyerPolicy:
    """Deterministic rules the reference buyer applies before accepting a cart."""

    def check_budget(
        self, *, cart_total_paise: int, budget_ceiling_paise: int
    ) -> BuyerPolicyVerdict:
        if cart_total_paise <= budget_ceiling_paise:
            return BuyerPolicyVerdict(allowed=True)
        return BuyerPolicyVerdict(
            allowed=False,
            reason_code="OVER_BUDGET",
            explanation=(
                f"The candidate cart total of {cart_total_paise} paise exceeds the "
                f"buyer's authorized budget ceiling of {budget_ceiling_paise} paise."
            ),
        )

    def check_categories(
        self,
        *,
        categories_by_sku: dict[str, str],
        allowed_categories: list[str],
    ) -> BuyerPolicyVerdict:
        allowed = {category.lower() for category in allowed_categories}
        for sku, category in categories_by_sku.items():
            if category.lower() not in allowed:
                return BuyerPolicyVerdict(
                    allowed=False,
                    reason_code="CATEGORY_NOT_ALLOWED",
                    explanation=f"{sku} belongs to a category outside the buyer mandate.",
                )
        return BuyerPolicyVerdict(allowed=True)

    def check_mandate_expiry(
        self, *, intent: IntentMandate, now: datetime | None = None
    ) -> BuyerPolicyVerdict:
        if intent.expires_at <= (now or utc_now()):
            return BuyerPolicyVerdict(
                allowed=False,
                reason_code="MANDATE_EXPIRED",
                explanation="The buyer mandate has expired and cannot authorize this cart.",
            )
        return BuyerPolicyVerdict(allowed=True)

    def evaluate(
        self, *, cart: CartMandate, intent: IntentMandate, now: datetime | None = None
    ) -> BuyerPolicyVerdict:
        expiry = self.check_mandate_expiry(intent=intent, now=now)
        if not expiry.allowed:
            return expiry
        budget = self.check_budget(
            cart_total_paise=cart.total_paise,
            budget_ceiling_paise=intent.budget_ceiling_paise,
        )
        if not budget.allowed:
            return budget
        return BuyerPolicyVerdict(allowed=True)
