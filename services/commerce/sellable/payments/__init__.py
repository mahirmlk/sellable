"""Provider-agnostic payment surface (target §25): checkout code depends
on this protocol, never on a concrete provider. Razorpay ships first;
Stripe (test mode) second; the simulated adapter serves the sandbox.
Select with ``PAYMENT_PROVIDER`` (razorpay|stripe|simulated).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class PaymentProvider(Protocol):
    """Structural provider contract behind the orchestrator."""

    provider_name: str

    def create_order(self, order: Any) -> Any: ...
    def create_payment_link(self, order: Any, *, callback_url: str | None = ...) -> Any: ...
    def refund(self, payment_id: str, amount_paise: int, *, notes: Any = ...) -> Any: ...
    def cancel_payment_link(self, link_id: str) -> None: ...
    def verify_webhook(self, body: bytes, signature: str | None) -> None: ...
    def validate_configuration(self) -> None: ...


def build_provider(config, name: str | None = None):
    """Construct the configured provider (stdlib only, no new deps)."""
    from sellable.payments.simulated import SimulatedPaymentAdapter
    from sellable.payments.stripe import StripeAdapter

    selected = (name or getattr(config, "payment_provider", None) or "razorpay").lower()
    if selected == "stripe":
        from sellable.payments.stripe import StripeAdapter

        return StripeAdapter(config)
    if selected == "simulated":
        return SimulatedPaymentAdapter()
    from sellable.payments.razorpay import RazorpayAdapter

    return RazorpayAdapter(config)
