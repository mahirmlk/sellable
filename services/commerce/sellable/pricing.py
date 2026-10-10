"""Deterministic pricing service (target §20.1).

The pricing service calculates the authoritative price from base prices,
negotiated adjustments, promotion adjustments, shipping, and tax. The
result is a snapshotted ``PriceBreakdown`` — the LLM may propose prices,
but only this service disposes (§4.2). Negotiated units can never go below
the catalog floor price.
"""

from __future__ import annotations

from sellable.catalog import CatalogService, UnknownSkuError
from sellable.contracts import CartLine, PriceBreakdown, PriceLine, PromotionResult, utc_now


class PricingError(ValueError):
    """Authoritative pricing refused the requested inputs."""


class PricingService:
    def __init__(self, catalog: CatalogService) -> None:
        self._catalog = catalog

    def price(
        self,
        lines: list[CartLine],
        *,
        negotiated_units: dict[str, int] | None = None,
        promotion: PromotionResult | None = None,
        shipping_total_paise: int = 0,
        tax_total_paise: int = 0,
    ) -> PriceBreakdown:
        """Price cart lines into an authoritative, snapshotted breakdown."""
        if not lines:
            raise PricingError("cannot price an empty cart")
        if shipping_total_paise < 0 or tax_total_paise < 0:
            raise PricingError("shipping and tax totals cannot be negative")
        overrides = negotiated_units or {}
        priced_lines: list[PriceLine] = []
        for line in lines:
            try:
                product = self._catalog.get(line.sku)
            except UnknownSkuError as error:
                raise PricingError(f"Unknown SKU: {line.sku}") from error
            if line.unit_price_paise != product.price_paise:
                # No stale price can silently become authoritative (§45):
                # callers must refresh snapshots before pricing.
                raise PricingError(f"stale price snapshot for {line.sku}")
            negotiated = overrides.get(line.sku, line.unit_price_paise)
            if negotiated > line.unit_price_paise:
                raise PricingError(f"negotiated price for {line.sku} exceeds list price")
            if negotiated < product.floor_paise:
                raise PricingError(f"negotiated price for {line.sku} is below floor")
            priced_lines.append(
                PriceLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    unit_price_paise=line.unit_price_paise,
                    negotiated_unit_paise=negotiated
                    if negotiated != line.unit_price_paise
                    else None,
                    line_subtotal_paise=line.line_total_paise,
                    line_total_paise=line.quantity * negotiated,
                )
            )

        subtotal = sum(line.line_subtotal_paise for line in priced_lines)
        negotiated_total = sum(line.line_total_paise for line in priced_lines)
        negotiated_discount = subtotal - negotiated_total
        promotion_discount = 0
        if promotion is not None:
            promotion_discount = min(promotion.discount_total_paise, negotiated_total)
        grand = (
            negotiated_total
            - promotion_discount
            + tax_total_paise
            + shipping_total_paise
        )
        if grand <= 0:
            raise PricingError("priced grand total must be positive")
        return PriceBreakdown(
            lines=priced_lines,
            subtotal_paise=subtotal,
            negotiated_discount_paise=negotiated_discount,
            promotion_discount_paise=promotion_discount,
            discount_total_paise=negotiated_discount + promotion_discount,
            tax_total_paise=tax_total_paise,
            shipping_total_paise=shipping_total_paise,
            grand_total_paise=grand,
            priced_at=utc_now(),
        )
