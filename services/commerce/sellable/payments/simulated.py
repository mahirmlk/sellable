"""Simulated payment adapter for the sandbox (target §31.1): full
provider-surface compatibility with zero network access. No production
payment execution is possible through this adapter by construction — it
has no HTTP client, no credentials, and no webhook verifier.

The module contains no ``urllib``/``http`` imports; that absence is the
isolation guarantee (asserted in tests).
"""

from __future__ import annotations

from typing import Any

from sellable.contracts import new_id
from sellable.payments.razorpay import (
    ProviderOrder,
    ProviderPaymentLink,
    ProviderRefund,
)


class SimulatedPaymentAdapter:
    """Drop-in surface replacement for RazorpayAdapter (test/sandbox only)."""

    provider_name = "simulated"

    def __init__(self, *, fail_captures: bool = False) -> None:
        self.fail_captures = fail_captures
        self.orders: dict[str, dict[str, Any]] = {}
        self.links: dict[str, dict[str, Any]] = {}
        self.refunds: dict[str, dict[str, Any]] = {}

    def create_order(self, order) -> ProviderOrder:
        provider_order_id = new_id("sim_order")
        self.orders[provider_order_id] = {
            "order_id": order.order_id,
            "amount_paise": order.amount_paise,
            "status": "created",
        }
        return ProviderOrder(
            provider_order_id=provider_order_id,
            amount_paise=order.amount_paise,
            currency="INR",
            status="created",
        )

    def create_payment_link(self, order, *, callback_url: str | None = None) -> ProviderPaymentLink:
        link_id = new_id("sim_link")
        provider_order_id = new_id("sim_order")
        self.links[link_id] = {
            "order_id": order.order_id,
            "amount_paise": order.amount_paise,
            "status": "created",
            "provider_order_id": provider_order_id,
        }
        return ProviderPaymentLink(
            provider_link_id=link_id,
            short_url=f"https://sandbox.pay/{link_id}",
            amount_paise=order.amount_paise,
            currency="INR",
            status="created",
            provider_order_id=provider_order_id,
        )

    def capture(self, provider_order_id: str) -> dict[str, Any]:
        """Simulate customer payment: succeeds unless fail_captures."""
        record = self.orders.get(provider_order_id)
        if record is None:
            raise ValueError(f"Unknown simulated order: {provider_order_id}")
        if self.fail_captures:
            record["status"] = "failed"
            return {"status": "failed", "provider_order_id": provider_order_id}
        record["status"] = "captured"
        payment_id = new_id("sim_pay")
        record["payment_id"] = payment_id
        return {
            "status": "captured",
            "provider_order_id": provider_order_id,
            "provider_payment_id": payment_id,
            "amount_paise": record["amount_paise"],
        }

    def refund(
        self, payment_id: str, amount_paise: int, *, notes: dict[str, str] | None = None
    ) -> ProviderRefund:
        if amount_paise <= 0:
            raise ValueError("Refund amount must be positive")
        refund_id = new_id("sim_rfnd")
        self.refunds[refund_id] = {
            "payment_id": payment_id,
            "amount_paise": amount_paise,
        }
        return ProviderRefund(
            provider_refund_id=refund_id,
            provider_payment_id=payment_id,
            amount_paise=amount_paise,
            currency="INR",
            status="processed",
        )

    def cancel_payment_link(self, link_id: str) -> None:
        record = self.links.get(link_id)
        if record is None:
            raise ValueError(f"Unknown simulated link: {link_id}")
        record["status"] = "cancelled"

    def verify_webhook(self, body: bytes, signature: str | None) -> None:
        # Sandbox settlement never flows through webhooks: core.mark_paid is
        # the settlement path. Any webhook-shaped input is rejected so a
        # test can never mistake simulation for provider authority.
        raise ValueError("simulated adapter settles only through core.mark_paid")

    def validate_configuration(self) -> None:
        return None
