"""Provider-agnostic payment surface (target §25): checkout code depends
on this protocol, never on a concrete provider. Razorpay ships first;
The Stripe test adapter and simulated rail are available only in development/test.
Deployments outside those environments accept Razorpay Test Mode only.
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
    """Construct the configured provider.

    Stripe and simulated rails are limited to development/test. Non-development
    deployments accept only Razorpay, whose adapter rejects live-mode keys.
    """
    from sellable.payments.simulated import SimulatedPaymentAdapter
    from sellable.payments.stripe import StripeAdapter

    selected = (name or getattr(config, "payment_provider", None) or "razorpay").lower()
    if selected == "stripe":
        if not getattr(config, "is_dev_environment", False):
            raise ValueError("Stripe is only available in development and test; use Razorpay Test Mode.")
        return StripeAdapter(config)
    if selected == "simulated":
        if not getattr(config, "is_dev_environment", False):
            raise ValueError("simulated payments are only available in development and test")
        return SimulatedPaymentAdapter()
    if selected != "razorpay":
        raise ValueError(f"unsupported payment provider: {selected}")

    from sellable.payments.razorpay import RazorpayAdapter

    return RazorpayAdapter(config)


def provider_is_valid(config) -> bool:
    """Local credential validation for the active provider (no network).

    Stronger than secret-presence: rejects placeholder values, wrong-mode
    keys (live keys on a test-only rail), and missing secrets. Used by the
    readiness gate so ``payment_health`` reflects validated credentials,
    not merely configured strings.
    """
    try:
        build_provider(config).validate_configuration()
    except Exception:  # noqa: BLE001 — any validation failure is unhealthy
        return False
    return True
