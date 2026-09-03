"""Razorpay test-mode adapter kept outside commerce and agent code."""

from __future__ import annotations

from typing import Any

import razorpay
from razorpay.errors import BadRequestError, GatewayError, ServerError, SignatureVerificationError

from sellable.config import Settings
from sellable.contracts import Order, StrictModel


class RazorpayConfigurationError(RuntimeError):
    pass


class RazorpayRequestError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class InvalidWebhookSignatureError(ValueError):
    pass


class ProviderOrder(StrictModel):
    provider_order_id: str
    amount_paise: int
    currency: str
    status: str


class ProviderPaymentLink(StrictModel):
    provider_link_id: str
    short_url: str
    amount_paise: int
    currency: str
    status: str
    # Razorpay creates an internal order for every payment link; carrying it
    # lets payment.captured webhooks (which reference payment.order_id)
    # resolve back to the local order.
    provider_order_id: str | None = None


class RazorpayAdapter:
    provider_name = "razorpay"
    _base_url = "https://api.razorpay.com/v1"

    def __init__(self, config: Settings, *, client: Any | None = None) -> None:
        self.config = config
        self._client = client

    def create_order(self, order: Order) -> ProviderOrder:
        self.validate_configuration()
        response = self._create(
            self._sdk_client.order,
            {
                "amount": order.amount_paise,
                "currency": "INR",
                "receipt": f"sellable_{order.order_id[-24:]}",
                "notes": {"local_order_id": order.order_id, "trace_id": order.trace_id},
            },
        )
        return ProviderOrder(
            provider_order_id=response["id"],
            amount_paise=response["amount"],
            currency=response["currency"],
            status=response["status"],
        )

    def create_payment_link(
        self, order: Order, *, callback_url: str | None = None
    ) -> ProviderPaymentLink:
        self.validate_configuration()
        payload: dict[str, Any] = {
            "amount": order.amount_paise,
            "currency": "INR",
            "reference_id": order.order_id,
            "description": f"SELLABLE order {order.order_id}",
            "notes": {"local_order_id": order.order_id, "trace_id": order.trace_id},
        }
        if callback_url:
            payload["callback_url"] = callback_url
            payload["callback_method"] = "get"
        response = self._create(self._sdk_client.payment_link, payload)
        return ProviderPaymentLink(
            provider_link_id=response["id"],
            short_url=response["short_url"],
            amount_paise=response["amount"],
            currency=response["currency"],
            status=response["status"],
            provider_order_id=response.get("order_id"),
        )

    def verify_webhook(self, body: bytes, signature: str | None) -> None:
        self._ensure_webhook_configuration()
        if not signature:
            raise InvalidWebhookSignatureError("Razorpay webhook signature is missing")
        try:
            # The SDK expects the original JSON text; do not parse or reserialize it.
            self._sdk_client.utility.verify_webhook_signature(
                body.decode("utf-8"), signature, self.config.razorpay_webhook_secret
            )
        except (SignatureVerificationError, UnicodeDecodeError) as error:
            raise InvalidWebhookSignatureError("Razorpay webhook signature is invalid") from error

    def validate_configuration(self) -> None:
        self._ensure_test_configuration()

    @property
    def _sdk_client(self) -> Any:
        if self._client is None:
            self._client = razorpay.Client(
                auth=(self.config.razorpay_key_id, self.config.razorpay_key_secret)
            )
            self._client.set_app_details({"title": "SELLABLE", "version": "0.1.0"})
        return self._client

    @staticmethod
    def _create(resource: Any, payload: dict[str, Any], *, max_retries: int = 2) -> dict[str, Any]:
        import time

        last_error: RazorpayRequestError | None = None
        for attempt in range(max_retries + 1):
            try:
                return resource.create(payload)
            except BadRequestError as error:
                raise RazorpayRequestError("Razorpay rejected the request", retryable=False) from error
            except (GatewayError, ServerError) as error:
                last_error = RazorpayRequestError(
                    f"Razorpay could not complete the request (attempt {attempt + 1})",
                    retryable=True,
                )
                if attempt < max_retries:
                    time.sleep(1 * (attempt + 1))
        raise last_error  # type: ignore[misc]

    def _ensure_test_configuration(self) -> None:
        if not self.config.razorpay_is_configured:
            raise RazorpayConfigurationError("Razorpay test credentials are not configured")
        if not self.config.razorpay_key_id.startswith("rzp_test_"):
            raise RazorpayConfigurationError("SELLABLE only accepts Razorpay test-mode credentials")

    def _ensure_webhook_configuration(self) -> None:
        if not self.config.razorpay_is_configured:
            raise RazorpayConfigurationError("Razorpay webhook secret is not configured")
