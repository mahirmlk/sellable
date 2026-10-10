"""Stripe test-mode adapter behind the provider protocol (target §25).

Stdlib HTTPS only (no Stripe SDK dependency): PaymentIntents for
headless/A2A charges, Payment Links for conversational checkout, refunds,
and HMAC webhook verification. Test mode only — live keys are refused at
configuration time.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from sellable.payments.razorpay import (
    ProviderOrder,
    ProviderPaymentLink,
    ProviderRefund,
)


class StripeConfigurationError(RuntimeError):
    pass


class StripeRequestError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class InvalidStripeSignatureError(ValueError):
    pass


class StripeAdapter:
    """Test-mode Stripe behind the orchestrator protocol."""

    provider_name = "stripe"
    _base_url = "https://api.stripe.com/v1"

    def __init__(self, config, *, transport=None) -> None:
        self.config = config
        self._transport = transport or _https_form

    # ------------------------------------------------------------------
    # Provider surface
    # ------------------------------------------------------------------

    def create_order(self, order) -> ProviderOrder:
        """A PaymentIntent is Stripe's headless charge object."""
        self.validate_configuration()
        response = self._call(
            "POST",
            "/payment_intents",
            {
                "amount": str(order.amount_paise),
                "currency": "inr",
                "metadata[local_order_id]": order.order_id,
                "metadata[trace_id]": order.trace_id,
                "automatic_payment_methods[enabled]": "true",
            },
        )
        return ProviderOrder(
            provider_order_id=response["id"],
            amount_paise=int(response["amount"]),
            currency=str(response["currency"]).upper(),
            status=response.get("status", "requires_payment_method"),
        )

    def create_payment_link(self, order, *, callback_url: str | None = None) -> ProviderPaymentLink:
        self.validate_configuration()
        price = self._call(
            "POST",
            "/prices",
            {
                "unit_amount": str(order.amount_paise),
                "currency": "inr",
                "product_data[name]": f"SELLABLE order {order.order_id}",
            },
        )
        payload: dict[str, str] = {"line_items[0][price]": price["id"], "line_items[0][quantity]": "1"}
        if callback_url:
            payload["after_completion[type]"] = "redirect"
            payload["after_completion[redirect][url]"] = callback_url
        link = self._call("POST", "/payment_links", payload)
        return ProviderPaymentLink(
            provider_link_id=link["id"],
            short_url=link["url"],
            amount_paise=order.amount_paise,
            currency="INR",
            status="active" if link.get("active", True) else "inactive",
            provider_order_id=None,
        )

    def refund(
        self, payment_id: str, amount_paise: int, *, notes: dict[str, str] | None = None
    ) -> ProviderRefund:
        self.validate_configuration()
        if amount_paise <= 0:
            raise StripeRequestError("Refund amount must be positive", retryable=False)
        payload: dict[str, str] = {
            "payment_intent": payment_id,
            "amount": str(amount_paise),
        }
        if notes:
            for index, (key, value) in enumerate(notes.items()):
                payload[f"metadata[{key}]"] = value
        try:
            response = self._call("POST", "/refunds", payload)
        except StripeRequestError as error:
            raise StripeRequestError(f"Stripe rejected the refund: {error}") from error
        return ProviderRefund(
            provider_refund_id=response["id"],
            provider_payment_id=payment_id,
            amount_paise=int(response.get("amount", amount_paise)),
            currency=str(response.get("currency", "inr")).upper(),
            status=response.get("status", "succeeded"),
        )

    def cancel_payment_link(self, link_id: str) -> None:
        self.validate_configuration()
        self._call("POST", f"/payment_links/{link_id}", {"active": "false"})

    def verify_webhook(self, body: bytes, signature: str | None) -> None:
        """Verify a Stripe `Stripe-Signature` header (t=...,v1=...)."""
        secret = self.config.stripe_webhook_secret
        if not secret:
            raise StripeConfigurationError("Stripe webhook secret is not configured")
        if not signature:
            raise InvalidStripeSignatureError("Stripe signature is missing")
        timestamp, signatures = _parse_signature_header(signature)
        if abs(time.time() - timestamp) > 300:
            raise InvalidStripeSignatureError("Stripe signature timestamp outside tolerance")
        expected = hmac.new(
            secret.encode("utf-8"), f"{timestamp}.{body.decode('utf-8')}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not any(hmac.compare_digest(expected, candidate) for candidate in signatures):
            raise InvalidStripeSignatureError("Stripe signature is invalid")

    def validate_configuration(self) -> None:
        key = self.config.stripe_secret_key
        if not key or key in ("", "replace_me"):
            raise StripeConfigurationError("Stripe secret key is not configured")
        if key.startswith("sk_live_"):
            raise StripeConfigurationError("Live Stripe keys are refused; test mode only")

    # ------------------------------------------------------------------

    def _call(self, method: str, path: str, form: dict[str, str]) -> dict[str, Any]:
        credentials = base64.b64encode(f"{self.config.stripe_secret_key}:".encode()).decode()
        try:
            return self._transport(
                method, f"{self._base_url}{path}", form, {"Authorization": f"Basic {credentials}"}
            )
        except _TransportError as error:
            raise StripeRequestError(str(error), retryable=error.retryable) from error


class _TransportError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def _https_form(
    method: str, url: str, form: dict[str, str], headers: dict[str, str]
) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(form).encode("utf-8")
    request = urllib.request.Request(
        url, data=encoded, headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8", errors="replace"))
            message = detail.get("error", {}).get("message", f"HTTP {error.code}")
        except Exception:  # noqa: BLE001 — fall back to the status
            message = f"HTTP {error.code}"
        raise _TransportError(message, retryable=error.code in (429, 500, 502, 503, 504)) from error
    except urllib.error.URLError as error:
        raise _TransportError(f"Stripe request failed: {error.reason}", retryable=True) from error


def _parse_signature_header(header: str) -> tuple[int, list[str]]:
    timestamp = 0
    signatures: list[str] = []
    for part in header.split(","):
        name, _, value = part.partition("=")
        if name.strip() == "t":
            timestamp = int(value)
        elif name.strip() == "v1":
            signatures.append(value)
    if not timestamp or not signatures:
        raise InvalidStripeSignatureError("Malformed Stripe signature header")
    return timestamp, signatures
