"""Deterministic tax service (target §22).

India-oriented GST abstraction with room for other jurisdictions:
same-state sales split CGST/SGST, cross-state sales use IGST. Agents never
calculate authoritative tax amounts — every figure comes from here, with
per-line basis points and a calculation reference for audit.
"""

from __future__ import annotations

from sellable.catalog import CatalogService
from sellable.contracts import (
    CartLine,
    TaxBreakdown,
    TaxLine,
    TaxRate,
    utc_now,
)


#: Fallback GST slab (18%) when the merchant configured no category rate.
DEFAULT_CGST_BPS = 900
DEFAULT_SGST_BPS = 900
DEFAULT_IGST_BPS = 1_800


class TaxService:
    def __init__(self, catalog: CatalogService, tax_repo: object | None = None) -> None:
        self._catalog = catalog
        self._rates = tax_repo

    def set_rate(self, rate: TaxRate) -> TaxRate:
        if self._rates is None:
            raise TaxError("tax rates are not configured")
        self._rates.upsert(rate)
        return rate

    def rates_for(self, merchant_id: str) -> dict[str, TaxRate]:
        if self._rates is None:
            return {}
        return self._rates.all_for(merchant_id)

    def calculate(
        self,
        lines: list[CartLine],
        *,
        merchant_id: str,
        merchant_state: str | None = None,
        customer_state: str | None = None,
    ) -> TaxBreakdown:
        """Calculate GST lines. States unknown or equal → intra-state
        (CGST+SGST); different → inter-state (IGST)."""
        if not lines:
            raise TaxError("cannot tax an empty cart")
        same_state = (
            not merchant_state
            or not customer_state
            or merchant_state.strip().upper() == customer_state.strip().upper()
        )
        jurisdiction = "INTRA_STATE" if same_state else "INTER_STATE"
        configured = self.rates_for(merchant_id)
        tax_lines: list[TaxLine] = []
        for line in lines:
            product = self._catalog.get(line.sku)
            rate = configured.get(product.category) or configured.get("*")
            cgst_bps = rate.cgst_bps if rate else DEFAULT_CGST_BPS
            sgst_bps = rate.sgst_bps if rate else DEFAULT_SGST_BPS
            igst_bps = rate.igst_bps if rate else DEFAULT_IGST_BPS
            taxable = line.line_total_paise
            if same_state:
                cgst = taxable * cgst_bps // 10_000
                sgst = taxable * sgst_bps // 10_000
                igst = 0
            else:
                cgst = sgst = 0
                igst = taxable * igst_bps // 10_000
            tax_lines.append(
                TaxLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    taxable_paise=taxable,
                    jurisdiction=jurisdiction,
                    cgst_bps=cgst_bps if same_state else 0,
                    sgst_bps=sgst_bps if same_state else 0,
                    igst_bps=0 if same_state else igst_bps,
                    cgst_amount_paise=cgst,
                    sgst_amount_paise=sgst,
                    igst_amount_paise=igst,
                )
            )
        return TaxBreakdown(
            lines=tax_lines,
            jurisdiction=jurisdiction,
            cgst_total_paise=sum(l.cgst_amount_paise for l in tax_lines),
            sgst_total_paise=sum(l.sgst_amount_paise for l in tax_lines),
            igst_total_paise=sum(l.igst_amount_paise for l in tax_lines),
            tax_total_paise=sum(l.line_tax_paise for l in tax_lines),
            calculation_reference=(
                f"GST-{jurisdiction}:{(merchant_state or 'NA').upper()}"
                f"->{(customer_state or 'NA').upper()}"
            ),
        )


class TaxError(ValueError):
    """Tax calculation refused the requested inputs."""
