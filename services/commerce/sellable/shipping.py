"""Shipping service and basic fulfillment (target §23).

Intentionally basic: method selection, serviceability, price, ETA,
tracking references, and carrier status ingestion. No warehouse, routing,
or carrier-optimization logic — connector interfaces cover those systems
(Phase 8).
"""

from __future__ import annotations

from sellable.contracts import (
    Fulfillment,
    FulfillmentStatus,
    ShippingMethod,
    ShippingMethodConfig,
    ShippingOption,
    TrackingEvent,
    new_id,
    utc_now,
)


#: Seed defaults installed for merchants with no configured methods.
DEFAULT_METHODS: tuple[ShippingMethodConfig, ...] = (
    ShippingMethodConfig(
        merchant_id="*",
        method=ShippingMethod.STANDARD,
        price_paise=4_900,
        eta_min_days=3,
        eta_max_days=5,
    ),
    ShippingMethodConfig(
        merchant_id="*",
        method=ShippingMethod.EXPRESS,
        price_paise=14_900,
        eta_min_days=1,
        eta_max_days=2,
    ),
    ShippingMethodConfig(
        merchant_id="*",
        method=ShippingMethod.PICKUP,
        price_paise=0,
        eta_min_days=0,
        eta_max_days=0,
    ),
)

# Current status → allowed next statuses (target §23.2).
_FULFILLMENT_TRANSITIONS: dict[FulfillmentStatus, frozenset[FulfillmentStatus]] = {
    FulfillmentStatus.ORDER_CONFIRMED: frozenset(
        {FulfillmentStatus.FULFILLMENT_PENDING, FulfillmentStatus.CANCELLED}
    ),
    FulfillmentStatus.FULFILLMENT_PENDING: frozenset(
        {FulfillmentStatus.SHIPPED, FulfillmentStatus.CANCELLED}
    ),
    FulfillmentStatus.SHIPPED: frozenset(
        {
            FulfillmentStatus.IN_TRANSIT,
            FulfillmentStatus.DELIVERY_FAILED,
            FulfillmentStatus.RETURN_REQUESTED,
        }
    ),
    FulfillmentStatus.IN_TRANSIT: frozenset(
        {
            FulfillmentStatus.DELIVERED,
            FulfillmentStatus.DELIVERY_FAILED,
            FulfillmentStatus.RETURN_REQUESTED,
        }
    ),
    FulfillmentStatus.DELIVERY_FAILED: frozenset(
        {FulfillmentStatus.IN_TRANSIT, FulfillmentStatus.CANCELLED}
    ),
    FulfillmentStatus.DELIVERED: frozenset({FulfillmentStatus.RETURN_REQUESTED}),
    FulfillmentStatus.CANCELLED: frozenset(),
    FulfillmentStatus.RETURN_REQUESTED: frozenset({FulfillmentStatus.RETURNED}),
    FulfillmentStatus.RETURNED: frozenset(),
}


class ShippingError(ValueError):
    """Shipping or fulfillment refused the requested action."""


class FulfillmentNotFoundError(ShippingError, LookupError):
    """No such fulfillment for this merchant."""


class ShippingService:
    def __init__(self, shipping_repo: object | None = None) -> None:
        self._methods = shipping_repo

    def configure(self, config: ShippingMethodConfig) -> ShippingMethodConfig:
        if self._methods is None:
            raise ShippingError("shipping methods are not configured")
        self._methods.save(config)
        return config

    def methods_for(self, merchant_id: str) -> list[ShippingMethodConfig]:
        if self._methods is None:
            return [c.model_copy(update={"merchant_id": merchant_id}) for c in DEFAULT_METHODS]
        configured = self._methods.active_for(merchant_id)
        if configured:
            return configured
        return [c.model_copy(update={"merchant_id": merchant_id}) for c in DEFAULT_METHODS]

    def quote(
        self,
        merchant_id: str,
        pincode: str,
        *,
        free_shipping: bool = False,
    ) -> list[ShippingOption]:
        """Serviceable options for a destination. A free-shipping promotion
        zeroes the STANDARD option; express/pickup stay priced."""
        options: list[ShippingOption] = []
        for config in self.methods_for(merchant_id):
            serviceable = not config.pincode_prefixes or any(
                pincode.startswith(prefix) for prefix in config.pincode_prefixes
            )
            options.append(
                ShippingOption(
                    method=config.method,
                    price_paise=(
                        0
                        if free_shipping and config.method is ShippingMethod.STANDARD
                        else config.price_paise
                    ),
                    eta_min_days=config.eta_min_days,
                    eta_max_days=config.eta_max_days,
                    serviceable=serviceable,
                )
            )
        return options


class FulfillmentService:
    def __init__(self, fulfillment_repo: object) -> None:
        self._fulfillments = fulfillment_repo

    def get(self, fulfillment_id: str, merchant_id: str) -> Fulfillment:
        fulfillment = self._fulfillments.get(fulfillment_id, merchant_id)
        if fulfillment is None:
            raise FulfillmentNotFoundError(f"Unknown fulfillment: {fulfillment_id}")
        return fulfillment

    def for_order(self, order_id: str, merchant_id: str) -> Fulfillment | None:
        return self._fulfillments.for_order(order_id, merchant_id)

    def timeline(self, fulfillment_id: str, merchant_id: str) -> list[TrackingEvent]:
        self.get(fulfillment_id, merchant_id)
        return self._fulfillments.timeline(fulfillment_id, merchant_id)

    def create_for_order(
        self, order_id: str, merchant_id: str, method: ShippingMethod,
        *, tracking_reference: str | None = None, carrier: str | None = None,
    ) -> Fulfillment:
        if self._fulfillments.for_order(order_id, merchant_id) is not None:
            raise ShippingError("a fulfillment already exists for this order")
        fulfillment = Fulfillment(
            merchant_id=merchant_id, order_id=order_id, method=method,
            tracking_reference=tracking_reference, carrier=carrier,
        )
        self._fulfillments.save(fulfillment)
        self._track(fulfillment, fulfillment.status, location=None)
        return fulfillment

    def mark_shipped(
        self,
        fulfillment_id: str,
        merchant_id: str,
        *,
        tracking_reference: str | None = None,
        carrier: str | None = None,
    ) -> Fulfillment:
        fulfillment = self.get(fulfillment_id, merchant_id)
        updated = fulfillment.model_copy(
            update={
                "tracking_reference": tracking_reference or new_id("trk"),
                "carrier": carrier,
                "updated_at": utc_now(),
            }
        )
        return self._move(updated, FulfillmentStatus.SHIPPED, location=None)

    def update_status(
        self,
        fulfillment_id: str,
        merchant_id: str,
        status: FulfillmentStatus,
        *,
        location: str | None = None,
    ) -> Fulfillment:
        """Status ingestion — carrier adapters call this in Phase 8."""
        return self._move(self.get(fulfillment_id, merchant_id), status, location=location)

    def mark_return_requested(self, fulfillment_id: str, merchant_id: str) -> Fulfillment:
        return self._move(
            self.get(fulfillment_id, merchant_id),
            FulfillmentStatus.RETURN_REQUESTED,
            location=None,
        )

    def mark_returned(self, fulfillment_id: str, merchant_id: str) -> Fulfillment:
        return self._move(
            self.get(fulfillment_id, merchant_id), FulfillmentStatus.RETURNED, location=None
        )

    def cancel(self, fulfillment_id: str, merchant_id: str) -> Fulfillment:
        return self._move(
            self.get(fulfillment_id, merchant_id), FulfillmentStatus.CANCELLED, location=None
        )

    # ------------------------------------------------------------------

    def _move(
        self, fulfillment: Fulfillment, target: FulfillmentStatus, *, location: str | None
    ) -> Fulfillment:
        if target not in _FULFILLMENT_TRANSITIONS[fulfillment.status]:
            raise ShippingError(
                f"cannot move fulfillment from {fulfillment.status.value} to {target.value}"
            )
        updated = fulfillment.model_copy(update={"status": target, "updated_at": utc_now()})
        self._fulfillments.save(updated)
        self._track(updated, target, location=location)
        return updated

    def _track(
        self, fulfillment: Fulfillment, status: FulfillmentStatus, *, location: str | None
    ) -> None:
        self._fulfillments.append_tracking(
            TrackingEvent(
                fulfillment_id=fulfillment.fulfillment_id,
                status=status,
                location=location,
            )
        )
