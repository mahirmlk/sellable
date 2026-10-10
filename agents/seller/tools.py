"""Deterministic seller tools that ground the agent in catalog and policy."""

from __future__ import annotations

from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    Order,
    Product,
    Promotion,
    PromotionResult,
    ShippingOption,
    SupportCase,
    SupportCategory,
)
from sellable.core import CommerceCore


class SellerTools:
    """Narrow tool surface exposed to the seller orchestration layer."""

    #: Tool registry version stamped on telemetry (§8.3).
    TOOL_REGISTRY_VERSION = "seller-tools-v2"

    def __init__(self, commerce: CommerceCore, recorder=None) -> None:
        self.commerce = commerce
        self.recorder = recorder

    def _note_tool(self, name: str, **kwargs) -> None:
        if self.recorder is not None:
            self.recorder.tool(name, version=self.TOOL_REGISTRY_VERSION, **kwargs)

    def catalog_search(
        self, *, query: str, trace_id: str, allowed_categories: list[str] | None = None
    ) -> list[Product]:
        # Ground search in the buyer mandate's categories up front; the
        # policy engine remains the binding backstop at quote time.
        products = self.commerce.catalog.search(query, set(allowed_categories or ()))
        self._note_tool("catalog.search")
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
        self._note_tool("catalog.get")
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
        negotiation_round: int | None = None,
    ) -> tuple[CartMandate, bool]:
        """Build one catalog-grounded quote (single-shot counter-offer).

        Negotiation is intentionally single-shot per call: a buyer offer below
        the policy-valid minimum is countered once at that minimum (floor and
        discount caps enforced); there is no multi-turn concession loop inside
        this tool. A buyer that wants to bid again makes a new request, which
        is re-evaluated from scratch — so ``max_negotiation_rounds`` bounds
        the cart's round counter rather than an in-tool loop. The round
        counter itself accumulates from the caller (prior ``negotiation.
        countered`` events on the same trace), so repeated offers on one
        trace eventually trip the policy's round limit.
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
            negotiation_round=(
                negotiation_round
                if negotiation_round is not None
                else (1 if buyer_offer_paise is not None else 0)
            ),
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
        self._note_tool("quotes.negotiate" if countered else "quotes.create")
        return cart, countered

    def best_price(self, *, product: Product, trace_id: str) -> int:
        """The lowest policy-valid unit price for a SKU, deterministically.

        Answers "what's your best price?" / "any discount?" from the same
        floor + discount-cap rules the negotiation engine uses — never from
        the LLM. Informational only: no cart is created.
        """
        minimum, _ = self._safe_offer(product, buyer_offer_paise=0)
        self._note_tool("quote.best_price")
        self._record(
            trace_id=trace_id,
            action="quote.best_price",
            inputs={"sku": product.sku, "list_price_paise": product.price_paise},
            output={"best_price_paise": minimum},
            explanation="Quoted the lowest policy-valid unit price from the merchant floor and discount caps.",
        )
        return minimum

    def upsell_suggest(
        self, *, cart: CartMandate, trace_id: str, session_upsells: int = 0,
        accept: bool = False,
    ) -> tuple[CartMandate, Product | None]:
        """Suggest one compatible add-on; only explicit acceptance mutates cart.

        With ``accept=False`` (the default) the cart is returned untouched and
        the add-on is recorded as a suggestion awaiting explicit buyer
        acceptance. With ``accept=True`` the add-on is appended and the
        enriched cart is returned for policy re-evaluation by the caller.
        The merchant's per-session upsell cap is enforced here, not just in
        the policy engine: a max of 0 disables upsells entirely instead of
        still offering once per cart.
        """
        if cart.upsell_offered or session_upsells >= self.commerce.policy.max_upsells_per_session:
            self._note_tool("upsell.suggest", status="SKIPPED")
            return cart, None
        primary = self.commerce.catalog.get(cart.items[0].sku)
        upsell_sku = primary.attributes.get("upsell_sku")
        if not isinstance(upsell_sku, str):
            self._note_tool("upsell.suggest", status="SKIPPED")
            return cart, None
        upsell = self.commerce.catalog.get(upsell_sku)
        if not accept:
            # Suggestion only: the cart the buyer is quoting on stays exactly
            # as it is until the buyer explicitly says "add it".
            self._record(
                trace_id=trace_id,
                action="upsell.offered",
                inputs={"primary_sku": primary.sku},
                output={"upsell_sku": upsell.sku, "upsell_price_paise": upsell.price_paise},
                explanation=f"Suggested {upsell.title} because it is compatible with {primary.title}; awaiting explicit buyer acceptance.",
            )
            return cart, upsell
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
            action="upsell.accepted",
            inputs={"primary_sku": primary.sku, "accepted_by_buyer": True},
            output={"upsell_sku": upsell.sku, "total_paise": enriched.total_paise},
            explanation=enriched.upsell_rationale,
        )
        return enriched, upsell

    def catalog_compare(self, *, skus: list[str], trace_id: str) -> list[Product]:
        """Compare catalog-grounded products side by side (§7.1). Unknown
        SKUs fail the whole comparison — no partial invented sets."""
        products = [self.commerce.catalog.get(sku) for sku in skus]
        self._note_tool("catalog.compare")
        self._record(
            trace_id=trace_id,
            action="catalog.compare",
            inputs={"skus": skus},
            output={
                "compared": [
                    {"sku": p.sku, "price_paise": p.price_paise} for p in products
                ]
            },
            explanation="Compared authoritative catalog products.",
        )
        return products

    def catalog_availability(self, *, sku: str, trace_id: str) -> dict[str, object]:
        """Authoritative availability for one SKU (§7.1). Stock comes from
        the catalog, never from model memory (§45)."""
        product = self.commerce.catalog.get(sku)
        self._note_tool("catalog.availability")
        availability = {
            "sku": product.sku,
            "stock": product.stock,
            "price_paise": product.price_paise,
            "available": product.stock > 0,
        }
        self._record(
            trace_id=trace_id,
            action="catalog.availability",
            inputs={"sku": sku},
            output=availability,
            explanation="Read authoritative availability from the catalog.",
        )
        return availability

    def promotion_evaluate(
        self,
        *,
        cart: CartMandate,
        trace_id: str,
        customer_id: str | None = None,
        channel: str = "agent",
        coupon_code: str | None = None,
    ) -> PromotionResult:
        """Evaluate eligible promotions over the candidate cart (§7.1)."""
        from sellable.promotions import PromotionEngine, PromotionLine

        lines = [
            PromotionLine(
                sku=item.sku,
                quantity=item.quantity,
                unit_price_paise=item.unit_price_paise,
                category=self.commerce.catalog.get(item.sku).category,
            )
            for item in cart.items
        ]
        result = PromotionEngine().evaluate(
            lines=lines,
            promotions=self.commerce.promotion_repo.active_for_merchant(
                self.commerce.merchant_scope
            ),
            customer_id=customer_id,
            channel=channel,
            coupon_code=coupon_code,
            usage=self.commerce.promotion_repo.usage(self.commerce.merchant_scope),
        )
        self._note_tool("promotion.evaluate")
        self._record(
            trace_id=trace_id,
            action="promotion.evaluated",
            inputs={"cart_id": cart.mandate_id, "coupon_code": coupon_code},
            output={
                "applied": result.applied_promotion_ids,
                "discount_total_paise": result.discount_total_paise,
            },
            explanation="Evaluated promotions deterministically over the candidate cart.",
        )
        return result

    def promotion_explain(self, *, promotion_id: str, trace_id: str) -> Promotion | None:
        """Explain a real promotion (§7.1). Unknown ids return None — the
        agent must never invent promotion terms."""
        promotion = self.commerce.promotion_repo.get(
            promotion_id, self.commerce.merchant_scope
        )
        self._note_tool("promotion.explain")
        self._record(
            trace_id=trace_id,
            action="promotion.explained",
            inputs={"promotion_id": promotion_id},
            output={"found": promotion is not None},
            explanation="Looked up the authoritative promotion definition.",
        )
        return promotion

    def recommend(
        self, *, product: Product, trace_id: str, limit: int = 3
    ) -> list[Product]:
        """Deterministic recommendations (§7.1, §19): merchant-curated
        relationships first, then same-category items. A service-backed
        engine (co-purchase/semantic) plugs in here without changing agent
        semantics; the agent only presents what tools return."""
        candidates: list[Product] = []
        seen = {product.sku}
        upsell_sku = product.attributes.get("upsell_sku")
        if isinstance(upsell_sku, str) and upsell_sku not in seen:
            try:
                candidates.append(self.commerce.catalog.get(upsell_sku))
                seen.add(upsell_sku)
            except UnknownSkuError:
                pass
        for item in self.commerce.catalog.search("", {product.category}):
            if item.sku not in seen:
                candidates.append(item)
                seen.add(item.sku)
            if len(candidates) >= limit:
                break
        self._note_tool("recommendations.get")
        self._record(
            trace_id=trace_id,
            action="recommendations.served",
            inputs={"sku": product.sku},
            output={"recommended_skus": [p.sku for p in candidates]},
            explanation="Served deterministic merchant-curated and category recommendations.",
        )
        return candidates

    def shipping_get_options(
        self, *, pincode: str, trace_id: str, free_shipping: bool = False
    ) -> list[ShippingOption]:
        """Valid shipping options for a destination (§7.1, §23.1)."""
        options = self.commerce.shipping_service.quote(
            self.commerce.merchant_scope, pincode, free_shipping=free_shipping
        )
        self._note_tool("shipping.get_options")
        self._record(
            trace_id=trace_id,
            action="shipping.options_quoted",
            inputs={"pincode": pincode},
            output={
                "options": [
                    {"method": o.method.value, "price_paise": o.price_paise}
                    for o in options
                    if o.serviceable
                ]
            },
            explanation="Quoted deterministic shipping options.",
        )
        return options

    def shipping_get_estimate(self, *, pincode: str, trace_id: str) -> ShippingOption | None:
        """Cheapest serviceable option with its ETA (§7.1)."""
        options = self.shipping_get_options(pincode=pincode, trace_id=trace_id)
        serviceable = [o for o in options if o.serviceable]
        if not serviceable:
            return None
        return min(serviceable, key=lambda o: o.price_paise)

    def customer_get_context(self, *, intent: IntentMandate, trace_id: str) -> dict[str, object]:
        """Buyer context scoped to what the caller supplied (§7.1): mandate
        budget, categories, and purpose. No customer PII is fetched — deeper
        identity arrives with Phase 5 linking."""
        self._note_tool("customer.get_context")
        context = {
            "buyer_agent_id": intent.buyer_agent_id,
            "budget_ceiling_paise": intent.budget_ceiling_paise,
            "allowed_categories": list(intent.allowed_categories),
            "purpose": intent.purpose,
        }
        self._record(
            trace_id=trace_id,
            action="customer.context_loaded",
            inputs={"buyer_agent_id": intent.buyer_agent_id},
            output={"budget_ceiling_paise": intent.budget_ceiling_paise},
            explanation="Loaded buyer context strictly from the supplied mandate.",
        )
        return context

    def order_get(self, *, order_id: str, trace_id: str) -> Order | None:
        """Authoritative order state (§7.1). Unknown ids return None."""
        try:
            order = self.commerce.get_order(order_id)
        except ValueError:
            order = None
        self._note_tool("order.get")
        self._record(
            trace_id=trace_id,
            action="order.fetched",
            inputs={"order_id": order_id},
            output={"status": order.status.value if order else None},
            explanation="Read authoritative order state.",
        )
        return order

    def order_cancel_request(self, *, order_id: str, reason: str, trace_id: str) -> str:
        """Request an order cancellation via a support case (§7.1). The
        agent cannot cancel directly — a human decides on the case."""
        from sellable.contracts import SupportCategory

        case = self.commerce.case_service.open_case(
            self.commerce.merchant_scope,
            f"Cancellation requested for order {order_id}: {reason}",
            order_id=order_id,
            category=SupportCategory.ORDER_STATUS,
            context={"reason": reason, "requested_via": "seller_agent"},
        )
        self._note_tool("order.cancel_request")
        self._record(
            trace_id=trace_id,
            action="order.cancel_requested",
            inputs={"order_id": order_id},
            output={"case_id": case.case_id},
            explanation="Routed the cancellation ask to a human-decided support case.",
        )
        return case.case_id

    def service_create_case(
        self,
        *,
        summary: str,
        trace_id: str,
        order_id: str | None = None,
        category: SupportCategory = SupportCategory.OTHER,
    ) -> SupportCase:
        """Open a post-purchase support case (§7.1)."""
        from sellable.privacy import redact_pii

        case = self.commerce.case_service.open_case(
            self.commerce.merchant_scope,
            redact_pii(summary) or summary,
            order_id=order_id,
            category=category,
            context={"opened_via": "seller_agent"},
        )
        self._note_tool("service.create_case")
        self._record(
            trace_id=trace_id,
            action="service.case_created",
            inputs={"order_id": order_id},
            output={"case_id": case.case_id},
            explanation="Opened a support case for post-purchase follow-up.",
        )
        return case

    def service_handoff(
        self, *, summary: str, trace_id: str, order_id: str | None = None
    ) -> dict[str, object]:
        """Hand off to the Customer Service Agent via a case (§7.1)."""
        case = self.service_create_case(
            summary=summary, trace_id=trace_id, order_id=order_id
        )
        self._note_tool("service.handoff")
        handoff = {
            "case_id": case.case_id,
            "summary": summary,
            "order_id": order_id,
            "trace_id": trace_id,
        }
        self._record(
            trace_id=trace_id,
            action="service.handoff",
            inputs={"order_id": order_id},
            output=handoff,
            explanation="Handed the conversation to customer service with full context.",
        )
        return handoff

    def cart_create(
        self, *, trace_id: str, customer_id: str | None = None
    ):
        """Open a persistent cart for assisted checkout (§7.1 cart.*)."""
        from sellable.contracts import Cart

        cart: Cart = self.commerce.create_cart(
            trace_id=trace_id, customer_id=customer_id
        )
        self._note_tool("cart.create")
        return cart

    def cart_add_item(
        self, *, cart_id: str, sku: str, quantity: int, expected_version: int,
        trace_id: str,
    ):
        """Add a catalog-grounded line to a persistent cart."""
        cart = self.commerce.cart_add_item(
            cart_id, sku, quantity,
            expected_version=expected_version, trace_id=trace_id,
        )
        self._note_tool("cart.add_item")
        return cart

    def cart_get(self, *, cart_id: str, trace_id: str):
        """Read authoritative cart state (totals always server-derived)."""
        cart = self.commerce.get_cart(cart_id)
        self._note_tool("cart.get")
        self._record(
            trace_id=trace_id,
            action="cart.fetched",
            inputs={"cart_id": cart_id},
            output={
                "status": cart.status.value,
                "grand_total_paise": cart.grand_total_paise,
            },
            explanation="Read authoritative persistent cart state.",
        )
        return cart

    def quote_refresh(self, *, quote_id: str, trace_id: str):
        """Re-snapshot a quote against live catalog prices (§7.1)."""
        quote, changed = self.commerce.quote_service.refresh_from_catalog(
            quote_id, self.commerce.merchant_scope
        )
        self._note_tool("quote.refresh")
        self._record(
            trace_id=trace_id,
            action="quote.refreshed",
            inputs={"quote_id": quote_id},
            output={"changed": changed},
            explanation="Re-snapshotted quote base prices from the catalog.",
        )
        return quote

    def checkout_create(self, *, cart_id: str, trace_id: str):
        """Open a checkout from a locked persistent cart (§7.1)."""
        checkout = self.commerce.create_checkout(cart_id, trace_id=trace_id)
        self._note_tool("checkout.create")
        return checkout

    def checkout_get(self, *, checkout_id: str, trace_id: str):
        """Read authoritative checkout state and totals."""
        checkout = self.commerce.checkout_service.get_checkout(
            checkout_id, self.commerce.merchant_scope
        )
        self._note_tool("checkout.get")
        return checkout

    def checkout_request_approval(self, *, checkout_id: str, trace_id: str):
        """Surface a held checkout for merchant approval (§7.1): returns
        the approval context instead of deciding anything."""
        checkout = self.checkout_get(checkout_id=checkout_id, trace_id=trace_id)
        self._note_tool("checkout.request_approval")
        self._record(
            trace_id=trace_id,
            action="checkout.approval_requested",
            inputs={"checkout_id": checkout_id},
            output={
                "status": checkout.status.value,
                "grand_total_paise": checkout.grand_total_paise,
            },
            explanation="Requested merchant approval for the held checkout.",
        )
        return {
            "checkout_id": checkout.checkout_id,
            "status": checkout.status.value,
            "grand_total_paise": checkout.grand_total_paise,
            "approval_queue": "/console/approvals",
        }

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
