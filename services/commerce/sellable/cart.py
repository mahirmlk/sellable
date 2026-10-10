"""Persistent, versioned cart service (target §18.2, §21.1, §39.2).

A cart is mutable and owned by the commerce layer — never by LLM context.
Callers send SKU + quantity only; unit prices are snapshotted from the
catalog at mutation time, and totals are derived server-side, so no
invented price can reach commerce state (§45). Mutations require the
caller-observed ``expected_version`` (optimistic concurrency): a stale
writer gets ``CartVersionConflictError`` and must re-read.

Promotion/tax/shipping evaluation arrives with the Phase 2b pricing
services; until then those snapshot totals stay zero.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sellable.catalog import CatalogService, UnknownSkuError
from sellable.contracts import Cart, CartLine, CartStatus, utc_now


#: Default cart time-to-live before it expires.
CART_TTL = timedelta(hours=24)

#: Cap lines per cart so one session cannot accumulate unbounded state.
MAX_LINES_PER_CART = 50


class CartNotFoundError(LookupError):
    """No such cart for this merchant (foreign ids stay invisible)."""


class CartVersionConflictError(ValueError):
    """The cart changed since the caller read it — re-read and retry."""


class CartStateError(ValueError):
    """The cart is not mutable right now (wrong status, expired, or the
    requested change violates inventory/policy)."""


# Maps current status → allowed next statuses (target §39.2).
_ALLOWED_TRANSITIONS: dict[CartStatus, frozenset[CartStatus]] = {
    CartStatus.ACTIVE: frozenset(
        {CartStatus.CHECKOUT_STARTED, CartStatus.EXPIRED, CartStatus.ABANDONED}
    ),
    CartStatus.CHECKOUT_STARTED: frozenset(
        {CartStatus.ACTIVE, CartStatus.CONVERTED, CartStatus.EXPIRED, CartStatus.ABANDONED}
    ),
    CartStatus.CONVERTED: frozenset(),
    CartStatus.EXPIRED: frozenset(),
    CartStatus.ABANDONED: frozenset(),
}


class CartService:
    """Domain logic over an injected cart repository.

    The repository must expose ``create(cart)``, ``get(cart_id,
    merchant_id)``, ``save(cart, expected_version=...)`` (atomic
    compare-and-swap raising the repo's not-found/conflict errors, mapped
    here), and ``list_active(merchant_id)``. ``CartRepository`` implements
    it; tests may substitute fakes.
    """

    def __init__(self, catalog: CatalogService, cart_repo: object) -> None:
        self._catalog = catalog
        self._carts = cart_repo

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def get_cart(self, cart_id: str, merchant_id: str) -> Cart:
        cart = self._carts.get(cart_id, merchant_id)
        if cart is None:
            raise CartNotFoundError(f"Unknown cart: {cart_id}")
        return cart

    # ------------------------------------------------------------------
    # Creation
    # ------------------------------------------------------------------

    def create_cart(
        self,
        merchant_id: str,
        *,
        customer_id: str | None = None,
        agent_session_id: str | None = None,
        ttl: timedelta = CART_TTL,
        now: datetime | None = None,
    ) -> Cart:
        moment = now or utc_now()
        cart = Cart(
            merchant_id=merchant_id,
            customer_id=customer_id,
            agent_session_id=agent_session_id,
            expires_at=moment + ttl,
            created_at=moment,
            updated_at=moment,
        )
        self._carts.create(cart)
        return cart

    # ------------------------------------------------------------------
    # Mutations (ACTIVE carts only, version-checked)
    # ------------------------------------------------------------------

    def add_item(
        self,
        cart_id: str,
        merchant_id: str,
        sku: str,
        quantity: int,
        *,
        expected_version: int,
    ) -> Cart:
        cart = self._require_mutable(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if quantity < 1:
            raise CartStateError("quantity must be at least 1")
        product = self._lookup_product(sku)
        lines = list(cart.items)
        existing = next((line for line in lines if line.sku == sku), None)
        new_quantity = quantity + (existing.quantity if existing else 0)
        if new_quantity > 100:
            raise CartStateError(f"quantity for {sku} exceeds the per-line limit")
        if new_quantity > product.stock:
            raise CartStateError(f"insufficient stock for {sku}")
        if existing is None and len(lines) >= MAX_LINES_PER_CART:
            raise CartStateError("cart line limit reached")
        if existing is None:
            lines.append(
                CartLine(
                    sku=sku, quantity=quantity, unit_price_paise=product.price_paise
                )
            )
        else:
            lines = [
                CartLine(
                    sku=line.sku,
                    quantity=new_quantity if line.sku == sku else line.quantity,
                    unit_price_paise=(
                        product.price_paise if line.sku == sku else line.unit_price_paise
                    ),
                )
                for line in lines
            ]
        return self._persist(cart, lines, expected_version)

    def set_quantity(
        self,
        cart_id: str,
        merchant_id: str,
        sku: str,
        quantity: int,
        *,
        expected_version: int,
    ) -> Cart:
        """Set an exact quantity; zero removes the line."""
        cart = self._require_mutable(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if quantity < 0:
            raise CartStateError("quantity cannot be negative")
        if not any(line.sku == sku for line in cart.items):
            raise CartStateError(f"cart has no line for {sku}")
        if quantity == 0:
            return self._persist(
                cart,
                [line for line in cart.items if line.sku != sku],
                expected_version,
            )
        product = self._lookup_product(sku)
        if quantity > product.stock:
            raise CartStateError(f"insufficient stock for {sku}")
        lines = [
            CartLine(
                sku=line.sku,
                quantity=quantity if line.sku == sku else line.quantity,
                unit_price_paise=(
                    product.price_paise if line.sku == sku else line.unit_price_paise
                ),
            )
            for line in cart.items
        ]
        return self._persist(cart, lines, expected_version)

    def remove_item(
        self, cart_id: str, merchant_id: str, sku: str, *, expected_version: int
    ) -> Cart:
        cart = self._require_mutable(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if not any(line.sku == sku for line in cart.items):
            raise CartStateError(f"cart has no line for {sku}")
        return self._persist(
            cart,
            [line for line in cart.items if line.sku != sku],
            expected_version,
        )

    def refresh_prices(
        self, cart_id: str, merchant_id: str, *, expected_version: int
    ) -> tuple[Cart, bool]:
        """Re-snapshot every line from the catalog (§21.1 price refresh).

        Returns the cart and whether any snapshot changed (stale-price
        detection for §41.1 handling upstream).
        """
        cart = self._require_mutable(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        lines: list[CartLine] = []
        changed = False
        for line in cart.items:
            product = self._lookup_product(line.sku)
            if product.price_paise != line.unit_price_paise:
                changed = True
            lines.append(
                CartLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    unit_price_paise=product.price_paise,
                )
            )
        if not changed:
            return cart, False
        return self._persist(cart, lines, expected_version), True

    # ------------------------------------------------------------------
    # Status transitions (§39.2)
    # ------------------------------------------------------------------

    def start_checkout(
        self, cart_id: str, merchant_id: str, *, expected_version: int
    ) -> Cart:
        cart = self.get_cart(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if cart.status is not CartStatus.ACTIVE:
            raise CartStateError(f"cannot start checkout from {cart.status.value}")
        if self._is_expired(cart):
            raise CartStateError("cart has expired")
        if not cart.items:
            raise CartStateError("cannot check out an empty cart")
        return self._transition(cart, CartStatus.CHECKOUT_STARTED, expected_version)

    def release_checkout(
        self, cart_id: str, merchant_id: str, *, expected_version: int
    ) -> Cart:
        """Return a CHECKOUT_STARTED cart to ACTIVE (checkout abandoned)."""
        cart = self.get_cart(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if cart.status is not CartStatus.CHECKOUT_STARTED:
            raise CartStateError(f"cannot release checkout from {cart.status.value}")
        return self._transition(cart, CartStatus.ACTIVE, expected_version)

    def mark_converted(
        self, cart_id: str, merchant_id: str, *, expected_version: int
    ) -> Cart:
        cart = self.get_cart(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        if cart.status is not CartStatus.CHECKOUT_STARTED:
            raise CartStateError(f"cannot convert from {cart.status.value}")
        return self._transition(cart, CartStatus.CONVERTED, expected_version)

    def mark_abandoned(
        self, cart_id: str, merchant_id: str, *, expected_version: int
    ) -> Cart:
        cart = self.get_cart(cart_id, merchant_id)
        self._check_version(cart, expected_version)
        return self._transition(cart, CartStatus.ABANDONED, expected_version)

    def expire_due(self, merchant_id: str) -> int:
        """Sweep past-expiry ACTIVE/CHECKOUT_STARTED carts to EXPIRED."""
        expired = 0
        for cart in self._carts.list_active(merchant_id):
            if cart.status in (CartStatus.ACTIVE, CartStatus.CHECKOUT_STARTED) and (
                self._is_expired(cart)
            ):
                try:
                    self._transition(cart, CartStatus.EXPIRED, cart.version)
                    expired += 1
                except (CartVersionConflictError, CartStateError):
                    continue
        return expired

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _lookup_product(self, sku: str):
        try:
            return self._catalog.get(sku)
        except UnknownSkuError as error:
            # No invented SKU can reach an order (§45): unknown SKUs fail
            # at the cart boundary, never downstream.
            raise CartStateError(f"Unknown SKU: {sku}") from error

    def _require_mutable(self, cart_id: str, merchant_id: str) -> Cart:
        cart = self.get_cart(cart_id, merchant_id)
        if cart.status is not CartStatus.ACTIVE:
            raise CartStateError(f"cart is {cart.status.value}, not mutable")
        if self._is_expired(cart):
            raise CartStateError("cart has expired")
        return cart

    @staticmethod
    def _is_expired(cart: Cart, now: datetime | None = None) -> bool:
        return (now or utc_now()) >= cart.expires_at

    @staticmethod
    def _check_version(cart: Cart, expected_version: int) -> None:
        if cart.version != expected_version:
            raise CartVersionConflictError(
                f"cart version {cart.version} does not match expected {expected_version}"
            )

    def _persist(
        self, cart: Cart, lines: list[CartLine], expected_version: int
    ) -> Cart:
        subtotal = sum(line.line_total_paise for line in lines)
        updated = cart.model_copy(
            update={
                "items": lines,
                "subtotal_paise": subtotal,
                "discount_total_paise": 0,
                "tax_total_paise": 0,
                "shipping_total_paise": 0,
                "grand_total_paise": subtotal,
                "updated_at": utc_now(),
            }
        )
        return self._carts.save(updated, expected_version=expected_version)

    def _transition(
        self, cart: Cart, target: CartStatus, expected_version: int
    ) -> Cart:
        if target not in _ALLOWED_TRANSITIONS[cart.status]:
            raise CartStateError(
                f"cannot move cart from {cart.status.value} to {target.value}"
            )
        updated = cart.model_copy(
            update={"status": target, "updated_at": utc_now()}
        )
        return self._carts.save(updated, expected_version=expected_version)
