"""Quote and bounded-negotiation service (target §18.3, §20.2).

A quote is a bounded commercial offer snapshotted from a cart. The Seller
Agent may propose negotiation strategy, but this service enforces the
bounds: per-SKU floors, maximum discount, maximum rounds, and expiry. The
counter-offer rule mirrors the standing policy (counter at
``max(floor, discount-cap)``) so agent-led and deterministic paths agree.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sellable.catalog import CatalogService, UnknownSkuError
from sellable.contracts import (
    Cart,
    MerchantPolicy,
    Quote,
    QuoteLine,
    QuoteNegotiationOutcome,
    QuoteStatus,
    StrictModel,
    utc_now,
)


#: Default bounded-offer window.
QUOTE_TTL = timedelta(minutes=30)


class QuoteError(ValueError):
    """The quote cannot be used (missing, expired, or wrong state)."""


class QuoteNotFoundError(QuoteError, LookupError):
    """No such quote for this merchant (foreign ids stay invisible)."""


class QuoteNegotiation(StrictModel):
    outcome: QuoteNegotiationOutcome
    quote: Quote
    counter_total_paise: int | None = None
    reason_code: str


class QuoteService:
    def __init__(
        self,
        catalog: CatalogService,
        quote_repo: object,
        policy: MerchantPolicy,
    ) -> None:
        self._catalog = catalog
        self._quotes = quote_repo
        self._policy = policy

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def get_quote(self, quote_id: str, merchant_id: str) -> Quote:
        quote = self._quotes.get(quote_id, merchant_id)
        if quote is None:
            raise QuoteNotFoundError(f"Unknown quote: {quote_id}")
        return quote

    def create_from_cart(
        self,
        cart: Cart,
        *,
        ttl: timedelta = QUOTE_TTL,
        now: datetime | None = None,
    ) -> Quote:
        moment = now or utc_now()
        lines = [
            QuoteLine(
                sku=line.sku,
                quantity=line.quantity,
                base_unit_paise=line.unit_price_paise,
                negotiated_unit_paise=line.unit_price_paise,
            )
            for line in cart.items
        ]
        if not lines:
            raise QuoteError("cannot quote an empty cart")
        subtotal = sum(line.line_base_paise for line in lines)
        quote = Quote(
            merchant_id=cart.merchant_id,
            cart_id=cart.cart_id,
            customer_id=cart.customer_id,
            agent_session_id=cart.agent_session_id,
            lines=lines,
            base_subtotal_paise=subtotal,
            negotiated_subtotal_paise=subtotal,
            expires_at=moment + ttl,
            created_at=moment,
            updated_at=moment,
        )
        self._quotes.save(quote)
        return quote

    def refresh_from_catalog(
        self, quote_id: str, merchant_id: str
    ) -> tuple[Quote, bool]:
        """Re-snapshot base prices (§18.3 snapshots). Negotiated units are
        clamped to the new base so the offer never exceeds list price."""
        quote = self._require_open(quote_id, merchant_id)
        lines: list[QuoteLine] = []
        changed = False
        for line in quote.lines:
            try:
                base = self._catalog.get(line.sku).price_paise
            except UnknownSkuError as error:
                raise QuoteError(f"quoted SKU left the catalog: {line.sku}") from error
            if base != line.base_unit_paise:
                changed = True
            lines.append(
                QuoteLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    base_unit_paise=base,
                    negotiated_unit_paise=min(line.negotiated_unit_paise, base),
                )
            )
        if not changed:
            return quote, False
        refreshed = quote.model_copy(
            update={
                "lines": lines,
                "base_subtotal_paise": sum(l.line_base_paise for l in lines),
                "negotiated_subtotal_paise": sum(l.line_negotiated_paise for l in lines),
                "updated_at": utc_now(),
            }
        )
        self._quotes.save(refreshed)
        return refreshed, True

    def accept(self, quote_id: str, merchant_id: str) -> Quote:
        quote = self._require_open(quote_id, merchant_id)
        accepted = quote.model_copy(
            update={"status": QuoteStatus.ACCEPTED, "updated_at": utc_now()}
        )
        self._quotes.save(accepted)
        return accepted

    def expire_due(self, merchant_id: str) -> int:
        # Repository has no open-quote scan; expiry is enforced lazily on
        # access plus an explicit sweep once the scan lands (Phase 2c).
        # Kept as a no-op entry point so callers can rely on the API shape.
        return 0

    # ------------------------------------------------------------------
    # Bounded negotiation (§20.2)
    # ------------------------------------------------------------------

    def negotiate(
        self, quote_id: str, merchant_id: str, proposed_total_paise: int
    ) -> QuoteNegotiation:
        """Evaluate one buyer counter-offer against deterministic bounds."""
        quote = self._require_open(quote_id, merchant_id)
        if proposed_total_paise <= 0:
            raise QuoteError("proposed total must be positive")
        if quote.round_number >= self._policy.max_negotiation_rounds:
            return QuoteNegotiation(
                outcome=QuoteNegotiationOutcome.DENIED,
                quote=quote,
                reason_code="MAX_NEGOTIATION_ROUNDS",
            )

        floor_total = self._floor_total(quote)
        discount_cap_total = (
            quote.base_subtotal_paise
            * (100 - self._policy.max_discount_percent)
            // 100
        )
        walk_away_floor = max(floor_total, discount_cap_total)
        round_number = quote.round_number + 1

        if proposed_total_paise >= quote.negotiated_subtotal_paise:
            # Buyer meets (or beats) the standing offer: accept at the
            # standing offer, never above it.
            accepted = self._with_negotiated_total(
                quote, quote.negotiated_subtotal_paise, round_number
            )
            self._quotes.save(accepted)
            return QuoteNegotiation(
                outcome=QuoteNegotiationOutcome.ACCEPTED,
                quote=accepted,
                reason_code="OFFER_MET",
            )
        if proposed_total_paise >= walk_away_floor:
            accepted, actual_total = self._with_negotiated_total(
                quote, proposed_total_paise, round_number
            )
            self._quotes.save(accepted)
            return QuoteNegotiation(
                outcome=QuoteNegotiationOutcome.ACCEPTED,
                quote=accepted,
                counter_total_paise=actual_total,
                reason_code="OFFER_WITHIN_BOUNDS",
            )
        countered, actual_total = self._with_negotiated_total(
            quote, walk_away_floor, round_number
        )
        self._quotes.save(countered)
        return QuoteNegotiation(
            outcome=QuoteNegotiationOutcome.COUNTERED,
            quote=countered,
            counter_total_paise=actual_total,
            reason_code="BELOW_FLOOR_PRICE",
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _require_open(self, quote_id: str, merchant_id: str) -> Quote:
        quote = self.get_quote(quote_id, merchant_id)
        if quote.status is not QuoteStatus.OPEN:
            raise QuoteError(f"quote is {quote.status.value}")
        if utc_now() >= quote.expires_at:
            expired = quote.model_copy(
                update={"status": QuoteStatus.EXPIRED, "updated_at": utc_now()}
            )
            self._quotes.save(expired)
            raise QuoteError("quote has expired")
        return quote

    def _floor_total(self, quote: Quote) -> int:
        total = 0
        for line in quote.lines:
            try:
                floor = self._catalog.get(line.sku).floor_paise
            except UnknownSkuError as error:
                raise QuoteError(f"quoted SKU left the catalog: {line.sku}") from error
            total += line.quantity * floor
        return total

    def _with_negotiated_total(
        self, quote: Quote, total: int, round_number: int
    ) -> tuple[Quote, int]:
        entries = [
            (line.quantity, line.base_unit_paise, self._floor_for(line.sku))
            for line in quote.lines
        ]
        units = _allocate_units(total, entries)
        lines = [
            QuoteLine(
                sku=line.sku,
                quantity=line.quantity,
                base_unit_paise=line.base_unit_paise,
                negotiated_unit_paise=unit,
            )
            for line, unit in zip(quote.lines, units)
        ]
        actual_total = sum(line.line_negotiated_paise for line in lines)
        return (
            quote.model_copy(
                update={
                    "lines": lines,
                    "negotiated_subtotal_paise": actual_total,
                    "round_number": round_number,
                    "updated_at": utc_now(),
                }
            ),
            actual_total,
        )

    def _floor_for(self, sku: str) -> int:
        try:
            return self._catalog.get(sku).floor_paise
        except UnknownSkuError as error:
            raise QuoteError(f"quoted SKU left the catalog: {sku}") from error


def _allocate_units(total: int, entries: list[tuple[int, int, int]]) -> list[int]:
    """Split ``total`` into one unit price per line honouring
    ``floor <= unit <= base``.

    Each line carries a single unit price, so exact-sum allocation is not
    always possible for multi-quantity lines: the settled total may fall
    short of the target by less than the line quantity (standard
    penny-rounding, always in the merchant's favour for counters and never
    below floor). Single-quantity lines are always exact. Callers must use
    the actual settled total, never assume the target.
    """
    floor_total = sum(qty * floor for qty, _, floor in entries)
    base_total = sum(qty * base for qty, base, _ in entries)
    if not (floor_total <= total <= base_total):
        raise QuoteError("negotiated total is outside floor/base bounds")
    remainder = total - floor_total
    headrooms = [(base - floor) * qty for qty, base, floor in entries]
    headroom_total = sum(headrooms)
    line_extras = [0] * len(entries)
    if headroom_total > 0 and remainder > 0:
        fractions: list[tuple[int, int]] = []
        for index, headroom in enumerate(headrooms):
            share, leftover = divmod(remainder * headroom, headroom_total)
            line_extras[index] = share
            fractions.append((leftover, index))
        leftover_total = remainder - sum(line_extras)
        fractions.sort(reverse=True)
        for position in range(leftover_total):
            line_extras[fractions[position % len(fractions)][1]] += 1
    units = []
    for (qty, base, floor), extra in zip(entries, line_extras):
        per_unit, _leftover = divmod(extra, qty)
        units.append(min(floor + per_unit, base))
    for (qty, base, floor), unit in zip(entries, units):
        assert floor <= unit <= base
    return units
