"""Checkout service: the first-class transaction-preparation state between
cart/quote and order (target §18.4, §21.2, §21.3, §39.3).

Pipeline: CREATED → VALIDATED → PRICED → RISK_REVIEW → AUTHORIZED →
PAYMENT_PENDING → COMPLETED. Every transition is validated against the
§21.3 invariants (cart version match, re-priced totals, revalidated
inventory, live delegation) and appended to the checkout event log.
Once AUTHORIZED the price snapshot is hash-bound: any material drift must
cancel and restart, never silently re-price (§14.5).

Risk evaluation is a recorded pass-through until the Phase 3 risk engine
lands; the hook point (``review_risk`` + ``risk_reference``) is stable.
Promotion redemptions are recorded only at completion, so priced-but-
abandoned checkouts never consume promotion budget.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

from sellable.authorization import AuthorizationService
from sellable.catalog import CatalogService
from sellable.contracts import (
    CartLine,
    Checkout,
    CheckoutLine,
    CheckoutStatus,
    PriceBreakdown,
    new_id,
    utc_now,
)
from sellable.delegations import AuthorizationOutcome, OperationScope
from sellable.pricing import PricingService, PricingError
from sellable.promotions import PromotionEngine, PromotionLine


#: Default checkout preparation window.
CHECKOUT_TTL = timedelta(minutes=30)

_TERMINAL = frozenset(
    {
        CheckoutStatus.COMPLETED,
        CheckoutStatus.REJECTED,
        CheckoutStatus.EXPIRED,
        CheckoutStatus.CANCELLED,
        CheckoutStatus.PAYMENT_FAILED,
    }
)


class CheckoutError(ValueError):
    """The checkout cannot advance (validation, invariant, or state)."""


class CheckoutNotFoundError(CheckoutError, LookupError):
    """No such checkout for this merchant (foreign ids stay invisible)."""


class CheckoutService:
    def __init__(
        self,
        *,
        catalog: CatalogService,
        pricing: PricingService,
        promotion_engine: PromotionEngine,
        checkout_repo: object,
        cart_repo: object,
        promotion_repo: object,
        quote_repo: object | None = None,
        delegation_lookup: object | None = None,
        order_repo: object | None = None,
        usage_lookup=None,
    ) -> None:
        self._catalog = catalog
        self._pricing = pricing
        self._promotion_engine = promotion_engine
        self._checkouts = checkout_repo
        self._carts = cart_repo
        self._promotions = promotion_repo
        self._quotes = quote_repo
        self._authorizer = (
            AuthorizationService(
                delegation_lookup=delegation_lookup, usage_lookup=usage_lookup
            )
            if delegation_lookup is not None
            else None
        )
        self._orders = order_repo

    def _line_categories(self, lines) -> list[str]:
        """Catalog categories for delegation category-scope checks."""
        categories = []
        for line in lines:
            try:
                category = self._catalog.get(line.sku).category
            except Exception:  # noqa: BLE001 — unknown SKUs fail their own checks
                continue
            if category not in categories:
                categories.append(category)
        return categories

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def get_checkout(self, checkout_id: str, merchant_id: str) -> Checkout:
        checkout = self._checkouts.get(checkout_id, merchant_id)
        if checkout is None:
            raise CheckoutNotFoundError(f"Unknown checkout: {checkout_id}")
        return checkout

    def events_for(self, checkout_id: str, merchant_id: str) -> list[object]:
        self.get_checkout(checkout_id, merchant_id)
        return self._checkouts.events_for(checkout_id, merchant_id)

    # ------------------------------------------------------------------
    # CREATED
    # ------------------------------------------------------------------

    def create_from_cart(
        self,
        cart_id: str,
        merchant_id: str,
        *,
        delegation_id: str | None = None,
        quote_id: str | None = None,
        ttl: timedelta = CHECKOUT_TTL,
        now: datetime | None = None,
    ) -> Checkout:
        from sellable.cart import CartNotFoundError, CartService as _CartService

        moment = now or utc_now()
        cart_service = _CartService(self._catalog, self._carts)
        try:
            cart = cart_service.get_cart(cart_id, merchant_id)
        except CartNotFoundError as error:
            raise CheckoutNotFoundError(str(error)) from error
        lines = [
            CheckoutLine(
                sku=line.sku, quantity=line.quantity, unit_price_paise=line.unit_price_paise
            )
            for line in cart.items
        ]
        if not lines:
            raise CheckoutError("cannot check out an empty cart")
        if quote_id is not None:
            lines = self._negotiated_lines(quote_id, merchant_id, cart_id)
        subtotal = sum(line.quantity * line.unit_price_paise for line in lines)
        checkout = Checkout(
            merchant_id=merchant_id,
            customer_id=cart.customer_id,
            agent_session_id=cart.agent_session_id,
            cart_id=cart.cart_id,
            cart_version=cart.version,
            quote_id=quote_id,
            delegation_id=delegation_id,
            lines=lines,
            subtotal_paise=subtotal,
            grand_total_paise=subtotal,
            expires_at=moment + ttl,
            created_at=moment,
            updated_at=moment,
        )
        self._checkouts.save(checkout)
        self._log(checkout, None, CheckoutStatus.CREATED, "checkout.created")
        return checkout

    # ------------------------------------------------------------------
    # VALIDATED (§21.3 invariants)
    # ------------------------------------------------------------------

    def validate(self, checkout_id: str, merchant_id: str) -> Checkout:
        from sellable.cart import CartService as _CartService, CartNotFoundError
        from sellable.contracts import CartStatus

        checkout = self._require_status(checkout_id, merchant_id, {CheckoutStatus.CREATED})
        self._require_fresh(checkout)
        cart_service = _CartService(self._catalog, self._carts)
        try:
            cart = cart_service.get_cart(checkout.cart_id, merchant_id)
        except CartNotFoundError as error:
            raise CheckoutError("checkout cart no longer exists") from error
        if cart.status is not CartStatus.CHECKOUT_STARTED:
            raise CheckoutError("cart is not locked for checkout")
        if cart.version != checkout.cart_version:
            # Stale cart (§41.1): the caller must re-read, refresh, and
            # restart validation — never silently re-price.
            raise CheckoutError("cart version changed since checkout creation")
        for line in checkout.lines:
            product = self._catalog.get(line.sku)
            if line.quantity > product.stock:
                raise CheckoutError(f"insufficient stock for {line.sku}")
        if checkout.delegation_id is not None and self._authorizer is not None:
            decision = self._authorizer.authorize(
                delegation_id=checkout.delegation_id,
                scope=OperationScope.CHECKOUT_WRITE,
                merchant_id=merchant_id,
                amount_paise=checkout.grand_total_paise,
                categories=self._line_categories(checkout.lines),
            )
            if decision.outcome is AuthorizationOutcome.DENY:
                rejected = self._move(checkout, CheckoutStatus.REJECTED, "checkout.rejected")
                raise CheckoutError(
                    f"delegation rejected checkout: {decision.reason_code}"
                ) from None
        return self._move(checkout, CheckoutStatus.VALIDATED, "checkout.validated")

    # ------------------------------------------------------------------
    # PRICED (pricing + promotions)
    # ------------------------------------------------------------------

    def price(
        self,
        checkout_id: str,
        merchant_id: str,
        *,
        coupon_code: str | None = None,
        channel: str = "agent",
        tax_total_paise: int = 0,
        shipping_total_paise: int = 0,
    ) -> tuple[Checkout, PriceBreakdown]:
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.VALIDATED, CheckoutStatus.PRICED}
        )
        self._require_fresh(checkout)
        cart_lines = [
            CartLine(sku=l.sku, quantity=l.quantity, unit_price_paise=l.unit_price_paise)
            for l in checkout.lines
        ]
        candidates = self._promotions.active_for_merchant(merchant_id)
        usage = self._promotions.usage(merchant_id)
        promo_lines = [
            PromotionLine(
                sku=l.sku,
                quantity=l.quantity,
                unit_price_paise=l.unit_price_paise,
                category=self._catalog.get(l.sku).category,
            )
            for l in checkout.lines
        ]
        promotion = self._promotion_engine.evaluate(
            lines=promo_lines,
            promotions=candidates,
            customer_id=checkout.customer_id,
            channel=channel,
            coupon_code=coupon_code,
            usage=usage,
        )
        if promotion.free_shipping:
            # A free-shipping promotion zeroes the standard shipping total
            # deterministically — callers never special-case it.
            shipping_total_paise = 0
        try:
            breakdown = self._pricing.price(
                cart_lines,
                promotion=promotion,
                tax_total_paise=tax_total_paise,
                shipping_total_paise=shipping_total_paise,
            )
        except PricingError as error:
            raise CheckoutError(str(error)) from error
        priced = checkout.model_copy(
            update={
                "subtotal_paise": breakdown.subtotal_paise,
                "discount_total_paise": breakdown.discount_total_paise,
                "tax_total_paise": breakdown.tax_total_paise,
                "shipping_total_paise": breakdown.shipping_total_paise,
                "grand_total_paise": breakdown.grand_total_paise,
                "applied_promotion_ids": list(promotion.applied_promotion_ids),
                "promotion_discounts": dict(promotion.discount_by_promotion),
                "free_shipping_applied": promotion.free_shipping,
                "status": CheckoutStatus.PRICED,
                "updated_at": utc_now(),
            }
        )
        self._checkouts.save(priced)
        self._log(priced, checkout.status, CheckoutStatus.PRICED, "checkout.priced")
        return priced, breakdown

    # ------------------------------------------------------------------
    # RISK_REVIEW (Phase 3 hook) → AUTHORIZED (hash-bound)
    # ------------------------------------------------------------------

    def review_risk(
        self, checkout_id: str, merchant_id: str, *, risk_reference: str | None = None
    ) -> Checkout:
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.PRICED}
        )
        self._require_fresh(checkout)
        reviewed = checkout.model_copy(
            update={
                "risk_reference": risk_reference,
                "status": CheckoutStatus.RISK_REVIEW,
                "updated_at": utc_now(),
            }
        )
        self._checkouts.save(reviewed)
        self._log(reviewed, checkout.status, CheckoutStatus.RISK_REVIEW, "checkout.risk_reviewed")
        return reviewed

    def authorize(self, checkout_id: str, merchant_id: str) -> Checkout:
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.RISK_REVIEW}
        )
        self._require_fresh(checkout)
        authorization_id: str | None = None
        if checkout.delegation_id is not None and self._authorizer is not None:
            decision = self._authorizer.authorize(
                delegation_id=checkout.delegation_id,
                scope=OperationScope.CHECKOUT_WRITE,
                merchant_id=merchant_id,
                amount_paise=checkout.grand_total_paise,
                categories=self._line_categories(checkout.lines),
            )
            if decision.outcome is AuthorizationOutcome.DENY:
                self._move(checkout, CheckoutStatus.REJECTED, "checkout.rejected")
                raise CheckoutError(
                    f"delegation rejected checkout: {decision.reason_code}"
                )
            authorization_id = decision.decision_id
        authorized = checkout.model_copy(
            update={
                "authorization_id": authorization_id,
                "price_hash": _price_hash(checkout),
                "status": CheckoutStatus.AUTHORIZED,
                "updated_at": utc_now(),
            }
        )
        self._checkouts.save(authorized)
        self._log(authorized, checkout.status, CheckoutStatus.AUTHORIZED, "checkout.authorized")
        return authorized

    # ------------------------------------------------------------------
    # PAYMENT_PENDING → COMPLETED / failures
    # ------------------------------------------------------------------

    def mark_payment_pending(self, checkout_id: str, merchant_id: str) -> Checkout:
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.AUTHORIZED}
        )
        return self._move(checkout, CheckoutStatus.PAYMENT_PENDING, "checkout.payment_pending")

    def link_order(self, checkout_id: str, merchant_id: str, order_id: str) -> Checkout:
        """Attach the created order before payment starts, so the
        provider-confirmation path can complete the right checkout."""
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.PAYMENT_PENDING}
        )
        linked = checkout.model_copy(
            update={"order_id": order_id, "updated_at": utc_now()}
        )
        self._checkouts.save(linked)
        self._log(linked, checkout.status, checkout.status, "checkout.order_linked")
        return linked

    def complete(self, checkout_id: str, merchant_id: str, order_id: str) -> Checkout:
        """Complete against a settled order: amount-bound and hash-bound."""
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.PAYMENT_PENDING}
        )
        if _price_hash(checkout) != checkout.price_hash:
            raise CheckoutError("checkout totals changed after authorization")
        if self._orders is not None:
            order = self._orders.get(order_id)
            if order is None or order.merchant_id != merchant_id:
                raise CheckoutError("linked order does not exist for this merchant")
            if order.amount_paise != checkout.grand_total_paise:
                raise CheckoutError("order amount does not match authorized total")
        completed = checkout.model_copy(
            update={
                "order_id": order_id,
                "status": CheckoutStatus.COMPLETED,
                "updated_at": utc_now(),
            }
        )
        self._checkouts.save(completed)
        self._log(completed, checkout.status, CheckoutStatus.COMPLETED, "checkout.completed")
        for promotion_id, discount in completed.promotion_discounts.items():
            self._promotions.record_redemption(
                promotion_id=promotion_id,
                merchant_id=merchant_id,
                checkout_id=checkout.checkout_id,
                discount_paise=discount,
            )
        return completed

    def mark_payment_failed(self, checkout_id: str, merchant_id: str) -> Checkout:
        checkout = self._require_status(
            checkout_id, merchant_id, {CheckoutStatus.PAYMENT_PENDING}
        )
        return self._move(checkout, CheckoutStatus.PAYMENT_FAILED, "checkout.payment_failed")

    def cancel(self, checkout_id: str, merchant_id: str) -> Checkout:
        checkout = self.get_checkout(checkout_id, merchant_id)
        if checkout.status in _TERMINAL:
            raise CheckoutError(f"cannot cancel a {checkout.status.value} checkout")
        return self._move(checkout, CheckoutStatus.CANCELLED, "checkout.cancelled")

    def reject(self, checkout_id: str, merchant_id: str, *, reason: str = "") -> Checkout:
        """Safety rejection (risk block, failed authorization): terminal and
        distinct from merchant cancels for dashboard triage."""
        checkout = self.get_checkout(checkout_id, merchant_id)
        if checkout.status in _TERMINAL:
            raise CheckoutError(f"cannot reject a {checkout.status.value} checkout")
        rejected = self._move(checkout, CheckoutStatus.REJECTED, "checkout.rejected")
        return rejected

    def expire_due(self, merchant_id: str) -> int:
        expired = 0
        for checkout in self._checkouts.list_open(merchant_id):
            if checkout.status not in _TERMINAL and utc_now() >= checkout.expires_at:
                self._move(checkout, CheckoutStatus.EXPIRED, "checkout.expired")
                expired += 1
        return expired

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _negotiated_lines(self, quote_id: str, merchant_id: str, cart_id: str) -> list[CheckoutLine]:
        from sellable.quotes import QuoteError, QuoteService as _QuoteService

        if self._quotes is None:
            raise CheckoutError("quotes are not configured")
        service = _QuoteService(self._catalog, self._quotes, self._policy_stub())
        try:
            quote = service.get_quote(quote_id, merchant_id)
        except Exception as error:
            raise CheckoutError(str(error)) from error
        from sellable.contracts import QuoteStatus

        if quote.cart_id != cart_id:
            raise CheckoutError("quote does not belong to this cart")
        if quote.status is not QuoteStatus.ACCEPTED:
            raise CheckoutError("quote is not accepted")
        return [
            CheckoutLine(
                sku=line.sku,
                quantity=line.quantity,
                unit_price_paise=line.negotiated_unit_paise,
            )
            for line in quote.lines
        ]

    def _policy_stub(self):  # QuoteService needs a policy only for negotiate()
        from sellable.contracts import MerchantPolicy

        return MerchantPolicy(
            merchant_id="stub",
            max_order_value_paise=1,
            max_single_item_value_paise=1,
            max_discount_percent=0,
            allowed_categories=["stub"],
            max_negotiation_rounds=0,
            max_upsells_per_session=0,
            human_approval_threshold_paise=1,
        )

    def _require_status(
        self, checkout_id: str, merchant_id: str, allowed: set[CheckoutStatus]
    ) -> Checkout:
        checkout = self.get_checkout(checkout_id, merchant_id)
        if checkout.status not in allowed:
            raise CheckoutError(
                f"checkout is {checkout.status.value}, "
                f"requires one of {sorted(s.value for s in allowed)}"
            )
        return checkout

    def _require_fresh(self, checkout: Checkout) -> None:
        if utc_now() >= checkout.expires_at:
            self._move(checkout, CheckoutStatus.EXPIRED, "checkout.expired")
            raise CheckoutError("checkout has expired")

    def _move(self, checkout: Checkout, target: CheckoutStatus, action: str) -> Checkout:
        moved = checkout.model_copy(
            update={"status": target, "updated_at": utc_now()}
        )
        self._checkouts.save(moved)
        self._log(moved, checkout.status, target, action)
        return moved

    def _log(
        self,
        checkout: Checkout,
        from_status: CheckoutStatus | None,
        to_status: CheckoutStatus,
        action: str,
    ) -> None:
        self._checkouts.append_event(
            event_id=new_id("chev"),
            checkout_id=checkout.checkout_id,
            merchant_id=checkout.merchant_id,
            action=action,
            from_status=from_status.value if from_status else None,
            to_status=to_status.value,
            detail=f"grand_total={checkout.grand_total_paise}",
        )


def _price_hash(checkout: Checkout) -> str:
    """Transaction binding (§14.5): hash the exact authorized state."""
    canonical = {
        "lines": [
            [line.sku, line.quantity, line.unit_price_paise] for line in checkout.lines
        ],
        "subtotal": checkout.subtotal_paise,
        "discount": checkout.discount_total_paise,
        "tax": checkout.tax_total_paise,
        "shipping": checkout.shipping_total_paise,
        "grand": checkout.grand_total_paise,
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True).encode("utf-8")
    ).hexdigest()
