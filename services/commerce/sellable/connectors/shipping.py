"""Shipping carrier adapters (target §23, §43 adapters/shipping): the
fulfillment core stays fixed while carriers plug in behind one interface.
Manual handling is the default; HTTP carriers add label creation and live
tracking fetches. Stdlib HTTPS only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from sellable.contracts import FulfillmentStatus


class CarrierError(RuntimeError):
    pass


class ShipmentLabel:
    """Label created through a carrier (tracking + carrier name)."""

    def __init__(self, tracking_reference: str, carrier: str, raw: dict | None = None) -> None:
        self.tracking_reference = tracking_reference
        self.carrier = carrier
        self.raw = raw or {}


class CarrierAdapter:
    """Carrier surface behind fulfillment (create/track)."""

    name = "manual"

    def create_shipment(
        self, *, order_id: str, merchant_id: str, method: str, destination_pincode: str
    ) -> ShipmentLabel:
        raise NotImplementedError

    def fetch_tracking(self, tracking_reference: str) -> tuple[FulfillmentStatus, str | None]:
        """Return (status, location). Raises CarrierError when unknown."""
        raise NotImplementedError


class ManualCarrier(CarrierAdapter):
    """Human-operated shipping: labels are issued by hand, tracking flows
    through the inbound carrier webhook. Always available, never networked."""

    name = "manual"

    def create_shipment(
        self, *, order_id: str, merchant_id: str, method: str, destination_pincode: str
    ) -> ShipmentLabel:
        from sellable.contracts import new_id

        return ShipmentLabel(
            tracking_reference=new_id("trk"),
            carrier="manual",
            raw={"method": method, "pincode": destination_pincode},
        )

    def fetch_tracking(self, tracking_reference: str) -> tuple[FulfillmentStatus, str | None]:
        raise CarrierError("manual carrier has no live tracking; use the inbound webhook")


_STATUS_MAP = {
    "created": FulfillmentStatus.FULFILLMENT_PENDING,
    "pending": FulfillmentStatus.FULFILLMENT_PENDING,
    "shipped": FulfillmentStatus.SHIPPED,
    "in_transit": FulfillmentStatus.IN_TRANSIT,
    "out_for_delivery": FulfillmentStatus.IN_TRANSIT,
    "delivered": FulfillmentStatus.DELIVERED,
    "failed": FulfillmentStatus.DELIVERY_FAILED,
    "cancelled": FulfillmentStatus.CANCELLED,
}


class GenericHttpCarrier(CarrierAdapter):
    """Any carrier with a JSON HTTP API (base URL + bearer secret from env).
    Secrets never touch the database row; pass them at construction."""

    name = "http"

    def __init__(
        self, *, base_url: str, api_secret: str, carrier_name: str = "http",
        timeout_seconds: int = 15, fetcher=None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_secret = api_secret
        self.carrier_name = carrier_name
        self.timeout_seconds = timeout_seconds
        self._fetcher = fetcher

    def create_shipment(
        self, *, order_id: str, merchant_id: str, method: str, destination_pincode: str
    ) -> ShipmentLabel:
        payload = self._request(
            "POST",
            "/shipments",
            {
                "order_id": order_id,
                "merchant_id": merchant_id,
                "method": method,
                "destination_pincode": destination_pincode,
            },
        )
        tracking = payload.get("tracking_reference") or payload.get("tracking_id")
        if not tracking:
            raise CarrierError("carrier did not return a tracking reference")
        return ShipmentLabel(
            tracking_reference=str(tracking), carrier=self.carrier_name, raw=payload
        )

    def fetch_tracking(self, tracking_reference: str) -> tuple[FulfillmentStatus, str | None]:
        payload = self._request("GET", f"/tracking/{tracking_reference}", {})
        status = _STATUS_MAP.get(str(payload.get("status", "")).lower())
        if status is None:
            raise CarrierError(f"unknown carrier status: {payload.get('status')}")
        return status, payload.get("location")

    def _request(self, method: str, path: str, payload: dict) -> dict:
        if self._fetcher is not None:
            return dict(self._fetcher(method=method, path=path, payload=payload))
        body = json.dumps(payload).encode("utf-8") if method != "GET" else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_secret}",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise CarrierError(f"carrier returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise CarrierError(f"carrier unreachable: {error.reason}") from error


def carrier_for(name: str, **kwargs) -> CarrierAdapter:
    if name == "manual":
        return ManualCarrier()
    if name == "http":
        return GenericHttpCarrier(**kwargs)
    raise ValueError(f"Unknown carrier adapter: {name}")
