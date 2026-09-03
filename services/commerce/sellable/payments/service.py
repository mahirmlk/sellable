"""Payment orchestration: consent → pending → provider → verified settlement."""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from sellable.contracts import LedgerActor, LedgerEvent, Order, PaymentAttempt, PaymentStatus
from sellable.core import CommerceCore
from sellable.payments.razorpay import (
    RazorpayAdapter,
    RazorpayRequestError,
)


logger = logging.getLogger("sellable.payments")


class UnknownProviderOrderError(ValueError):
    pass


class UnsupportedWebhookEventError(ValueError):
    pass


class PaymentService:
    MAX_RETRIES = 1

    def __init__(
        self,
        commerce: CommerceCore,
        rail: RazorpayAdapter,
        core_resolver: "Callable[[str], CommerceCore] | None" = None,
    ) -> None:
        # ``commerce`` is the default core (the agent-gateway/demo merchant).
        # Callers may pass a different merchant's core per request; the core
        # used for each order is remembered so webhooks settle against the
        # correct merchant's state. ``core_resolver`` (merchant_id → core)
        # lets webhook settlement rebuild the right merchant core after a
        # process restart, when in-memory maps are gone.

        self.commerce = commerce
        self.rail = rail
        self._core_resolver = core_resolver
        self._attempt_by_order_id: dict[str, PaymentAttempt] = {}
        self._local_order_by_provider_order_id: dict[str, str] = {}
        self._local_order_by_link_id: dict[str, str] = {}
        self._processed_delivery_keys: set[str] = set()
        self._retry_count_by_order_id: dict[str, int] = {}
        self._core_by_order_id: dict[str, CommerceCore] = {}

    def _core_for(self, order_id: str) -> CommerceCore:
        return self._core_by_order_id.get(order_id, self.commerce)

    def _resolve_webhook_order(
        self,
        *,
        event_name: str,
        payment: dict[str, Any],
        payload: dict[str, Any],
    ) -> tuple[CommerceCore, Order]:
        """Resolve the local order (and its merchant core) from a webhook.

        Resolution order: in-memory maps → persisted provider references on
        the order row → the order id itself. Survives process restarts.
        """
        link_entity = (payload.get("payload", {}).get("payment_link", {}) or {}).get("entity", {}) or {}
        link_id = str(link_entity.get("id") or "") or None
        reference_id = str(link_entity.get("reference_id") or "") or None
        provider_order_id = str(payment.get("order_id") or "") or None
        order_repo = self.commerce.order_repo

        resolved: Order | None = None
        # 1. In-memory fast path (same process as start_payment)
        if link_id and link_id in self._local_order_by_link_id:
            oid = self._local_order_by_link_id[link_id]
            resolved = self._core_by_order_id.get(oid, self.commerce).get_order(oid) if oid in self._core_by_order_id else order_repo.get(oid)
        elif provider_order_id and provider_order_id in self._local_order_by_provider_order_id:
            oid = self._local_order_by_provider_order_id[provider_order_id]
            resolved = self._core_by_order_id.get(oid, self.commerce).get_order(oid) if oid in self._core_by_order_id else order_repo.get(oid)
        # 2. Persisted provider references (works after a restart)
        if resolved is None and link_id:
            resolved = order_repo.for_provider(link_id=link_id)
        if resolved is None and provider_order_id:
            resolved = order_repo.for_provider(provider_order_id=provider_order_id)
        # 3. The reference_id IS the local order id for payment links
        if resolved is None and reference_id and reference_id.startswith("ord_"):
            resolved = order_repo.get(reference_id)
        if resolved is None:
            raise UnknownProviderOrderError("Webhook references an unknown provider order")

        core = self._core_by_order_id.get(resolved.order_id)
        if core is None:
            core = self._core_resolver(resolved.merchant_id) if self._core_resolver else self.commerce
            self._core_by_order_id[resolved.order_id] = core
        return core, resolved

    def start_payment(self, *, order_id: str, consent_id: str, commerce: CommerceCore | None = None) -> PaymentAttempt:
        core = commerce or self.commerce
        existing = self._attempt_by_order_id.get(order_id)
        if existing is not None:
            return existing

        # Do not consume single-use consent merely to discover missing credentials.
        self.rail.validate_configuration()
        consented_order = core.consume_consent(consent_id, order_id=order_id)
        pending_order = core.mark_payment_pending(order_id)
        self._core_by_order_id[order_id] = core
        return self._create_provider_attempt(order_id, pending_order.trace_id, core)

    def retry_payment(self, *, order_id: str, commerce: CommerceCore | None = None) -> PaymentAttempt:
        """Perform at most one bounded, idempotent retry after a verified failure."""
        core = commerce or self._core_for(order_id)
        order = core.get_order(order_id)
        from sellable.contracts import OrderStatus

        if order.status is not OrderStatus.PAYMENT_FAILED:
            raise ValueError(
                f"Retry requires a PAYMENT_FAILED order; current status is {order.status}"
            )
        retries = self._retry_count_by_order_id.get(order_id, 0)
        if retries >= self.MAX_RETRIES:
            core.mark_aborted(order_id, reason="Retry limit reached")
            self._record(
                core=core,
                trace_id=order.trace_id,
                action="retry.aborted",
                inputs={"order_id": order_id, "attempts": retries},
                output={"order_status": "ABORTED"},
                explanation=(
                    "The bounded retry limit was reached; the order was aborted without "
                    "creating a duplicate payment or order."
                ),
            )
            raise ValueError("Retry limit reached; the order has been aborted")

        self._retry_count_by_order_id[order_id] = retries + 1
        self._core_by_order_id[order_id] = core
        self._record(
            core=core,
            trace_id=order.trace_id,
            action="retry.started",
            inputs={"order_id": order_id, "attempt": retries + 1, "max_attempts": self.MAX_RETRIES},
            output={"started": True},
            explanation=(
                "One bounded retry was started for the same logical transaction and "
                "idempotency boundary."
            ),
            provider_ref=order.idempotency_key,
        )
        pending_order = core.mark_payment_pending(order_id)
        try:
            return self._create_provider_attempt(order_id, pending_order.trace_id, core)
        except RazorpayRequestError as error:
            core.mark_payment_failed(order_id, reason=str(error))
            self._record(
                core=core,
                trace_id=order.trace_id,
                action="retry.failed",
                inputs={"order_id": order_id, "attempt": retries + 1},
                output={"retryable": error.retryable},
                explanation="The bounded retry also failed; no duplicate settlement was created.",
            )
            raise

    def _create_provider_attempt(self, order_id: str, trace_id: str, core: CommerceCore) -> PaymentAttempt:
        pending_order = core.get_order(order_id)
        try:
            # Human checkout uses a hosted Razorpay Payment Link (spec §10):
            # the browser receives only a public short_url — no keys, no SDK,
            # and the provider never confirms through the frontend.
            provider_link = self.rail.create_payment_link(pending_order)
            if (
                provider_link.amount_paise != pending_order.amount_paise
                or provider_link.currency != "INR"
            ):
                raise RazorpayRequestError(
                    "Razorpay response does not match the local order amount or currency"
                )
        except RazorpayRequestError as error:
            core.mark_payment_failed(order_id, reason=str(error))
            self._record(
                core=core,
                trace_id=trace_id,
                action="payment.failure_classified",
                inputs={"order_id": order_id},
                output={"retryable": error.retryable},
                explanation=(
                    "The provider request failed. A single bounded retry is available "
                    "when the failure is retryable; otherwise the transaction aborts."
                ),
            )
            raise

        attempt = PaymentAttempt(
            order_id=order_id,
            provider_order_id=provider_link.provider_link_id,
            payment_url=provider_link.short_url,
            idempotency_key=pending_order.idempotency_key,
        )
        self._attempt_by_order_id[order_id] = attempt
        self._local_order_by_link_id[provider_link.provider_link_id] = order_id
        # Razorpay creates an internal order for every payment link; mapping
        # it lets payment.captured webhooks (which reference payment.order_id)
        # resolve even when only the captured event arrives.
        if provider_link.provider_order_id:
            self._local_order_by_provider_order_id[provider_link.provider_order_id] = order_id
        # Persisted references: webhook settlement must survive restarts.
        core.attach_provider_refs(
            order_id, link_id=provider_link.provider_link_id, provider_order_id=provider_link.provider_order_id
        )
        self._record(
            core=core,
            trace_id=trace_id,
            action="payment.attempted",
            inputs={"order_id": order_id, "amount_paise": pending_order.amount_paise},
            output={"provider_link_id": provider_link.provider_link_id, "payment_url": provider_link.short_url},
            provider_ref=provider_link.provider_link_id,
            explanation="Created a Razorpay test-mode Payment Link after policy approval and consent.",
        )
        return attempt

    def handle_webhook(self, body: bytes, signature: str | None) -> PaymentAttempt:
        self.rail.verify_webhook(body, signature)
        try:
            payload = json.loads(body)
            event_name = payload["event"]
            payment = payload["payload"]["payment"]["entity"]
            provider_payment_id = payment["id"]
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            raise UnsupportedWebhookEventError("Webhook payload is not a supported Razorpay payment event") from error

        # Resolution order: in-memory map → payload reference_id → persisted
        # order row (provider refs live in the DB), so settlement survives
        # process restarts. Razorpay's link lifecycle offers paid/cancelled;
        # customer-side failures arrive as payment.failed on the link's
        # internal order.
        try:
            core, local_order = self._resolve_webhook_order(
                event_name=event_name, payment=payment, payload=payload
            )
        except UnknownProviderOrderError:
            logger.warning(
                "Webhook for an unknown provider order ignored (event=%s payment=%s)",
                event_name,
                provider_payment_id,
            )
            raise
        local_order_id = local_order.order_id
        attempt = self._attempt_by_order_id.get(local_order_id)
        if attempt is None:
            # Restarted since the attempt was created — rebuild the minimal
            # attempt from the persisted order so settlement can proceed.
            attempt = PaymentAttempt(
                order_id=local_order_id,
                provider_order_id=local_order.provider_link_id or local_order_id,
                idempotency_key=local_order.idempotency_key,
            )
            self._attempt_by_order_id[local_order_id] = attempt
        delivery_key = f"{event_name}:{provider_payment_id}"
        if delivery_key in self._processed_delivery_keys:
            return attempt

        if event_name in ("payment.captured", "payment_link.paid"):
            captured_amount = payment.get("amount")
            if captured_amount is not None and int(captured_amount) != local_order.amount_paise:
                self._record(
                    core=core,
                    trace_id=local_order.trace_id,
                    action="webhook.amount_mismatch",
                    inputs={"event": event_name, "provider_payment_id": provider_payment_id},
                    output={
                        "provider_amount_paise": captured_amount,
                        "order_amount_paise": local_order.amount_paise,
                    },
                    provider_ref=provider_payment_id,
                    explanation=(
                        "The captured amount does not match the local order amount; the order "
                        "was not settled."
                    ),
                )
                return attempt
            # Cross-event duplicate: payment_link.paid and payment.captured can
            # both announce the same settlement — the first one wins.
            if attempt.status is PaymentStatus.CAPTURED:
                return attempt
            core.mark_paid(local_order_id, provider_ref=provider_payment_id)
            updated_attempt = attempt.model_copy(
                update={
                    "provider_payment_id": provider_payment_id,
                    "status": PaymentStatus.CAPTURED,
                }
            )
            explanation = "Verified Razorpay payment webhook and settled the local order."
        elif event_name in ("payment.failed", "payment_link.cancelled"):
            reason = (
                str(payment.get("error_description") or "")
                or (
                    "The payment link was cancelled; it can no longer be paid."
                    if event_name == "payment_link.cancelled"
                    else "Razorpay reported a failed payment"
                )
            )
            if local_order.status is PaymentStatus.FAILED:
                return attempt  # already failed — idempotent
            core.mark_payment_failed(
                local_order_id, reason=reason, provider_ref=provider_payment_id
            )
            updated_attempt = attempt.model_copy(
                update={
                    "provider_payment_id": provider_payment_id,
                    "status": PaymentStatus.FAILED,
                    "failure_reason": reason,
                }
            )
            explanation = "Verified Razorpay payment failure webhook and recorded the explicit failure state."
        else:
            raise UnsupportedWebhookEventError(f"Unsupported Razorpay event: {event_name}")

        self._attempt_by_order_id[local_order_id] = updated_attempt
        self._processed_delivery_keys.add(delivery_key)
        self._record(
            core=core,
            trace_id=local_order.trace_id,
            action="webhook.reconciled",
            inputs={"event": event_name, "provider_order_id": attempt.provider_order_id},
            output={"order_id": local_order_id, "status": updated_attempt.status},
            provider_ref=provider_payment_id,
            explanation=explanation,
        )
        return updated_attempt

    def _record(
        self,
        *,
        trace_id: str,
        action: str,
        inputs: dict[str, object],
        output: dict[str, object],
        explanation: str,
        provider_ref: str | None = None,
        core: CommerceCore | None = None,
    ) -> None:
        (core or self.commerce).ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                merchant_id=(core or self.commerce).merchant_scope,
                actor=LedgerActor.RAZORPAY,
                action=action,
                inputs=inputs,
                output=output,
                reasoning_summary=explanation,
                provider_ref=provider_ref,
            )
        )
