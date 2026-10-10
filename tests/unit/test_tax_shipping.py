"""Phase 2c: GST tax (§22) and shipping/fulfillment (§23)."""

from __future__ import annotations

import pytest

from sellable.contracts import (
    CartLine,
    FulfillmentStatus,
    ShippingMethod,
    ShippingMethodConfig,
    TaxRate,
)
from sellable.shipping import FulfillmentService, ShippingError, ShippingService
from sellable.tax import TaxError, TaxService


def _catalog():
    from sellable.catalog import CatalogService
    from sellable.contracts import Product

    return CatalogService(
        [
            Product(
                merchant_id="mrc_tax",
                sku="AUDIO-CASE-01",
                title="Audio case",
                description="A case",
                price_paise=69_900,
                floor_paise=50_000,
                stock=45,
                category="accessories",
            )
        ]
    )


def _lines() -> list[CartLine]:
    return [CartLine(sku="AUDIO-CASE-01", quantity=2, unit_price_paise=69_900)]


# --- Tax ---------------------------------------------------------------------


def test_intra_state_splits_cgst_sgst() -> None:
    service = TaxService(_catalog())
    breakdown = service.calculate(
        _lines(), merchant_id="mrc_tax", merchant_state="KA", customer_state="ka"
    )
    assert breakdown.jurisdiction == "INTRA_STATE"
    taxable = 139_800
    assert breakdown.cgst_total_paise == taxable * 900 // 10_000
    assert breakdown.sgst_total_paise == taxable * 900 // 10_000
    assert breakdown.igst_total_paise == 0
    assert breakdown.tax_total_paise == breakdown.cgst_total_paise * 2
    assert "KA" in breakdown.calculation_reference


def test_inter_state_uses_igst() -> None:
    service = TaxService(_catalog())
    breakdown = service.calculate(
        _lines(), merchant_id="mrc_tax", merchant_state="KA", customer_state="MH"
    )
    assert breakdown.jurisdiction == "INTER_STATE"
    assert breakdown.cgst_total_paise == 0
    assert breakdown.sgst_total_paise == 0
    assert breakdown.igst_total_paise == 139_800 * 1_800 // 10_000


def test_merchant_category_rate_overrides_default() -> None:
    from sellable.repositories import TaxRateRepository
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from sellable.ledger.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    repo = TaxRateRepository(engine=engine)
    service = TaxService(_catalog(), repo)
    service.set_rate(
        TaxRate(
            merchant_id="mrc_tax", category="accessories",
            cgst_bps=600, sgst_bps=600, igst_bps=1_200,
        )
    )
    intra = service.calculate(
        _lines(), merchant_id="mrc_tax", merchant_state="KA", customer_state="KA"
    )
    assert intra.cgst_total_paise == 139_800 * 600 // 10_000
    inter = service.calculate(
        _lines(), merchant_id="mrc_tax", merchant_state="KA", customer_state="MH"
    )
    assert inter.igst_total_paise == 139_800 * 1_200 // 10_000


def test_tax_rejects_empty_cart() -> None:
    with pytest.raises(TaxError):
        TaxService(_catalog()).calculate([], merchant_id="mrc_tax")


# --- Shipping ------------------------------------------------------------------


def test_default_methods_and_serviceability() -> None:
    service = ShippingService()
    options = service.quote("mrc_ship", "560001")
    methods = {o.method: o for o in options}
    assert methods[ShippingMethod.STANDARD].price_paise == 4_900
    assert methods[ShippingMethod.PICKUP].price_paise == 0
    assert all(o.serviceable for o in options)


def test_free_shipping_zeroes_standard_only() -> None:
    service = ShippingService()
    options = service.quote("mrc_ship", "560001", free_shipping=True)
    methods = {o.method: o for o in options}
    assert methods[ShippingMethod.STANDARD].price_paise == 0
    assert methods[ShippingMethod.EXPRESS].price_paise == 14_900


def test_pincode_scoped_method() -> None:
    from sellable.repositories import ShippingMethodRepository
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from sellable.ledger.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    repo = ShippingMethodRepository(engine=engine)
    service = ShippingService(repo)
    service.configure(
        ShippingMethodConfig(
            merchant_id="mrc_ship",
            method=ShippingMethod.EXPRESS,
            price_paise=9_900,
            eta_min_days=1,
            eta_max_days=2,
            pincode_prefixes=["560"],
        )
    )
    options = service.quote("mrc_ship", "560001")
    assert options[0].serviceable is True
    assert options[0].price_paise == 9_900
    assert service.quote("mrc_ship", "400001")[0].serviceable is False


# --- Fulfillment ---------------------------------------------------------------


def _fulfillment_service():
    from sellable.repositories import FulfillmentRepository
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from sellable.ledger.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return FulfillmentService(FulfillmentRepository(engine=engine))


def test_fulfillment_lifecycle_and_timeline() -> None:
    service = _fulfillment_service()
    created = service.create_for_order("ord_1", "mrc_ship", ShippingMethod.STANDARD)
    assert created.status == FulfillmentStatus.FULFILLMENT_PENDING
    shipped = service.mark_shipped(
        created.fulfillment_id, "mrc_ship", carrier="delhivery"
    )
    assert shipped.status == FulfillmentStatus.SHIPPED
    assert shipped.tracking_reference.startswith("trk_")
    in_transit = service.update_status(
        created.fulfillment_id, "mrc_ship", FulfillmentStatus.IN_TRANSIT,
        location="Bengaluru hub",
    )
    assert in_transit.status == FulfillmentStatus.IN_TRANSIT
    delivered = service.update_status(
        created.fulfillment_id, "mrc_ship", FulfillmentStatus.DELIVERED
    )
    assert delivered.status == FulfillmentStatus.DELIVERED
    timeline = service.timeline(created.fulfillment_id, "mrc_ship")
    assert [e.status for e in timeline] == [
        FulfillmentStatus.FULFILLMENT_PENDING,
        FulfillmentStatus.SHIPPED,
        FulfillmentStatus.IN_TRANSIT,
        FulfillmentStatus.DELIVERED,
    ]
    with pytest.raises(ShippingError):
        service.update_status(created.fulfillment_id, "mrc_ship", FulfillmentStatus.SHIPPED)
    with pytest.raises(ShippingError):
        service.create_for_order("ord_1", "mrc_ship", ShippingMethod.STANDARD)


def test_fulfillment_return_mirroring() -> None:
    service = _fulfillment_service()
    created = service.create_for_order("ord_9", "mrc_ship", ShippingMethod.STANDARD)
    service.mark_shipped(created.fulfillment_id, "mrc_ship")
    service.update_status(created.fulfillment_id, "mrc_ship", FulfillmentStatus.IN_TRANSIT)
    service.update_status(created.fulfillment_id, "mrc_ship", FulfillmentStatus.DELIVERED)
    requested = service.mark_return_requested(created.fulfillment_id, "mrc_ship")
    assert requested.status == FulfillmentStatus.RETURN_REQUESTED
    returned = service.mark_returned(created.fulfillment_id, "mrc_ship")
    assert returned.status == FulfillmentStatus.RETURNED
