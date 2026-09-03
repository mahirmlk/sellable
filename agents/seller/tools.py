"""Deterministic seller tools that ground the agent in catalog and policy."""

from __future__ import annotations

from sellable.contracts import (
    CartItem,
    CartMandate,
    LedgerActor,
    LedgerEvent,
    Product,
)
from sellable.core import CommerceCore


class SellerTools:
    """Narrow tool surface exposed to the seller orchestration layer."""

    def __init__(self, commerce: CommerceCore) -> None:
        self.commerce = commerce

    def catalog_search(
        self, *, query: str, trace_id: str, allowed_categories: list[str] | None = None
    ) -> list[Product]:
        # Ground search in the buyer mandate's categories up front; the
        # policy engine remains the binding backstop at quote time.
        products = self.commerce.catalog.search(query, set(allowed_categories or ()))
        self._record(
            trace_id=trace_id,
            action="catalog.search",
            inputs={"query": query},
            output={"matching_skus": [product.sku for product in products]},
            explanation="Searched only the authoritative merchant catalog.",
        )
        return products

    def catalog_get(self, *, sku: str, trace_id: str) -> Product:
        product = self.commerce.catalog.get(sku)
        self._record(
            trace_id=trace_id,
            action="catalog.get",
            inputs={"sku": sku},
            output={"sku": product.sku, "price_paise": product.price_paise},
            explanation="Retrieved an item by its authoritative catalog SKU.",
        )
        return product

    def quote_create(
        self,
        *,
        product: Product,
        quantity: int,
        buyer_offer_paise: int | None,
        intent_ref: str,
        trace_id: str,
    ) -> tuple[CartMandate, bool]:
        """Build one catalog-grounded quote (single-shot counter-offer).

        Negotiation is intentionally single-shot per call: a buyer offer below
        the policy-valid minimum is countered once at that minimum (floor and
        discount caps enforced); there is no multi-turn concession loop inside
        this tool. A buyer that wants to bid again makes a new request, which
        is re-evaluated from scratch — so ``max_negotiation_rounds`` bounds
        the cart's round counter rather than an in-tool loop.
        """
        offered_price, countered = self._safe_offer(product, buyer_offer_paise)
        item = CartItem(
            sku=product.sku,
            quantity=quantity,
            unit_price_paise=product.price_paise,
            offered_price_paise=offered_price,
        )
        cart = CartMandate(
            intent_ref=intent_ref,
            items=[item],
            subtotal_paise=product.price_paise * quantity,
            discount_paise=(product.price_paise - offered_price) * quantity,
            total_paise=offered_price * quantity,
            negotiation_round=1 if buyer_offer_paise is not None else 0,
        )
        self._record(
            trace_id=trace_id,
            action="quote.created" if not countered else "negotiation.countered",
            inputs={"sku": product.sku, "buyer_offer_paise": buyer_offer_paise},
            output={"offered_price_paise": offered_price, "total_paise": cart.total_paise},
            explanation=(
                "Created a catalog-grounded quote."
                if not countered
                else "Countered at the lowest policy-valid price; the buyer offer was too low."
            ),
        )
        return cart, countered

    def upsell_suggest(
        self, *, cart: CartMandate, trace_id: str, session_upsells: int = 0
    ) -> tuple[CartMandate, Product | None]:
        # The merchant's per-session upsell cap is enforced here, not just in
        # the policy engine: a max of 0 disables upsells entirely instead of
        # still offering once per cart.
        if cart.upsell_offered or session_upsells >= self.commerce.policy.max_upsells_per_session:
            return cart, None
        primary = self.commerce.catalog.get(cart.items[0].sku)
        upsell_sku = primary.attributes.get("upsell_sku")
        if not isinstance(upsell_sku, str):
            return cart, None
        upsell = self.commerce.catalog.get(upsell_sku)
        upsell_item = CartItem(
            sku=upsell.sku,
            quantity=1,
            unit_price_paise=upsell.price_paise,
            offered_price_paise=upsell.price_paise,
        )
        enriched = CartMandate(
            intent_ref=cart.intent_ref,
            items=[*cart.items, upsell_item],
            subtotal_paise=cart.subtotal_paise + upsell.price_paise,
            discount_paise=cart.discount_paise,
            total_paise=cart.total_paise + upsell.price_paise,
            upsell_offered=True,
            upsell_rationale=(
                f"Suggested {upsell.title} because it is compatible with {primary.title}."
            ),
            negotiation_round=cart.negotiation_round,
        )
        self._record(
            trace_id=trace_id,
            action="upsell.offered",
            inputs={"primary_sku": primary.sku},
            output={"upsell_sku": upsell.sku, "total_paise": enriched.total_paise},
            explanation=enriched.upsell_rationale,
        )
        return enriched, upsell

    def _safe_offer(self, product: Product, buyer_offer_paise: int | None) -> tuple[int, bool]:
        if buyer_offer_paise is None or buyer_offer_paise >= product.price_paise:
            return product.price_paise, False
        discount_percentage = 100 - self.commerce.policy.max_discount_percent
        max_discount_floor = (
            product.price_paise * discount_percentage + 99
        ) // 100
        minimum_allowed_price = max(product.floor_paise, max_discount_floor)
        if buyer_offer_paise < minimum_allowed_price:
            return minimum_allowed_price, True
        return buyer_offer_paise, False

    def _record(
        self,
        *,
        trace_id: str,
        action: str,
        inputs: dict[str, object],
        output: dict[str, object],
        explanation: str,
    ) -> None:
        self.commerce.ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                merchant_id=self.commerce.merchant_scope,
                actor=LedgerActor.SELLER_AGENT,
                action=action,
                inputs=inputs,
                output=output,
                reasoning_summary=explanation,
            )
        )
