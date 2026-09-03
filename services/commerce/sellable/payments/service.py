"""Payment orchestration: consent → pending → provider → verified settlement."""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable

from sellable.contracts import (
    LedgerActor,
    LedgerEvent,
    Order,
    OrderStatus,
    PaymentAttempt,
    PaymentStatus,
)
from sellable.core import CommerceCore
from sellable.orders import InvalidOrderTransitionError
from sellable.payments.razorpay import (
    RazorpayAdapter,
    RazorpayRequestError,
)


logger = logging.getLogger("sellable.payments")


class UnknownProviderOrderError(ValueError):
    pass


class UnsupportedWebhookEventError(ValueError):
    pass


class UnexpectedOrderStateError(ValueError):
    """A verified webhook arrived for an order that cannot legally move.

    Raised instead of letting the strict state machine raise an unhandled
    500: the money event is real, so it gets a ledger row
    (webhook.unexpected_state) and the endpoint answers 409.
    """


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
        # Guards start_payment / retry_payment check-and-set so concurrent
        # calls cannot mint two live provider links for one order.
        self._lock = threading.Lock()
        self._attempt_by_order_id: dict[str, PaymentAttempt] = {}
        self._local_order_by_provider_order_id: dict[str, str] = {}
        self._local_order_by_link_id: dict[str, str] = {}
        # NOTE: delivery dedupe and retry budgets are persisted, not kept in
        # memory: webhook deliveries live in the `webhook_deliveries` table
        # (LedgerRepository.claim_delivery) and retries are counted from
        # `retry.started` ledger events, so both survive restarts and work
        # across replicas.
        self._core_by_order_id: dict[str, CommerceCore] = {}

    def _core_for(self, order_id: str) -> CommerceCore:
        return self._core_by_order_id.get(order_id, self.commerce)

    def _resolve_webhook_order(
        self,
        *,
        event_name: str,
        payment: dict[str, Any],
        payload: dict[str, Any],
    ) -> tuple[CommerceCore, Order, str | None]:
        """Resolve the local order (and its merchant core) from a webhook.

        Resolution order: in-memory maps → persisted provider references on
        the order row → the order id itself. Survives process restarts.
        Also returns the link id for delivery-key construction.
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
        return core, resolved, link_id

    def _rebuild_attempt(self, order: Order) -> PaymentAttempt:
        """Rebuild the attempt from the persisted order row.

        Value-equal to the original attempt (including the payment URL), so
        post-restart retries and fresh-service replays hand back the same
        payable link instead of minting a second one.
        """
        attempt = PaymentAttempt(
            order_id=order.order_id,
            provider_order_id=order.provider_link_id or order.order_id,
            payment_url=order.provider_payment_url,
            idempotency_key=order.idempotency_key,
        )
        self._attempt_by_order_id[order.order_id] = attempt
        return attempt

    def start_payment(self, *, order_id: str, consent_id: str, commerce: CommerceCore | None = None) -> PaymentAttempt:
        core = commerce or self.commerce
        # Do not consume single-use consent merely to discover missing credentials.
        self.rail.validate_configuration()
        with self._lock:
            existing = self._attempt_by_order_id.get(order_id)
            if existing is not None:
                return existing
            # Single-live-link invariant (reconcile-then-reuse): a persisted
            # PAYMENT_PENDING order with provider refs already has a live
            # link — after a restart, a crash between calls, or a concurrent
            # double-start — so return it instead of minting a second one.
            # DB-first read: another process may have advanced the order.
            order = core.get_order(order_id)
            if order.status is OrderStatus.PAYMENT_PENDING and order.provider_link_id:
                if order.provider_link_id in self._local_order_by_link_id:
                    self._local_order_by_link_id[order.provider_link_id] = order_id
                return self._rebuild_attempt(order)
            consented_order = core.consume_consent(consent_id, order_id=order_id)
            pending_order = core.mark_payment_pending(order_id)
            self._core_by_order_id[order_id] = core
            return self._create_provider_attempt(order_id, pending_order.trace_id, core)

    def cancel_provider_link(
        self, order_id: str, *, commerce: CommerceCore | None = None
    ) -> bool:
        """Cancel the live provider link for an order, if one is recorded.

        Returns True when a link was cancelled. Used before aborting a
        PAYMENT_PENDING order so the aborted order can never be paid after.
        """
        core = commerce or self._core_for(order_id)
        order = core.get_order(order_id)
        if not order.provider_link_id:
            return False
        self.rail.cancel_payment_link(order.provider_link_id)
        self._record(
            core=core,
            trace_id=order.trace_id,
            action="payment.link_cancelled",
            inputs={"order_id": order_id},
            output={"provider_link_id": order.provider_link_id},
            provider_ref=order.provider_link_id,
            explanation="Cancelled the live provider payment link ahead of aborting the order.",
        )
        return True

    def retry_payment(self, *, order_id: str, commerce: CommerceCore | None = None) -> PaymentAttempt:
        """Perform at most one bounded, idempotent retry after a verified failure."""
        core = commerce or self._core_for(order_id)
        order = core.get_order(order_id)

        if order.status is not OrderStatus.PAYMENT_FAILED:
            raise ValueError(
                f"Retry requires a PAYMENT_FAILED order; current status is {order.status}"
            )
        with self._lock:
            # Restart-proof budget: count `retry.started` ledger events for
            # this trace instead of trusting process memory. Checked under the
            # lock so concurrent retries cannot both pass.
            retries = core.ledger.count_actions(order.trace_id, "retry.started")
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
            order_id,
            link_id=provider_link.provider_link_id,
            provider_order_id=provider_link.provider_order_id,
            payment_url=provider_link.short_url,
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

    _SUPPORTED_WEBHOOK_EVENTS = frozenset(
        {
            "payment.captured",
            "payment_link.paid",
            "payment.failed",
            "payment_link.cancelled",
        }
    )

    def handle_webhook(
        self, body: bytes, signature: str | None, *, extra_flags: list[str] | None = None
    ) -> PaymentAttempt:
        """Verify and reconcile a Razorpay webhook (dev simulation included).

        ``extra_flags`` marks synthetic provenance (e.g. ``["simulated"]``) on
        the resulting ledger events so demo money is never narrated as
        verified provider money.
        """
        self.rail.verify_webhook(body, signature)
        try:
            payload = json.loads(body)
            event_name = payload.get("event")
            payload_section = payload.get("payload") or {}
            link_entity = (payload_section.get("payment_link") or {}).get("entity") or {}
            # payment_link.cancelled carries ONLY a payment_link entity — there
            # is no payment.entity (nothing was paid). Parse per event family
            # instead of unconditionally requiring payment.entity.
            payment = (payload_section.get("payment") or {}).get("entity") or {}
        except (AttributeError, json.JSONDecodeError) as error:
            raise UnsupportedWebhookEventError("Webhook payload is not a supported Razorpay payment event") from error
        if not isinstance(event_name, str) or event_name not in self._SUPPORTED_WEBHOOK_EVENTS:
            raise UnsupportedWebhookEventError(f"Unsupported Razorpay event: {event_name}")
        provider_payment_id = payment.get("id")

        # Resolution order: in-memory map → payload reference_id → persisted
        # order row (provider refs live in the DB), so settlement survives
        # process restarts. Razorpay's link lifecycle offers paid/cancelled;
        # customer-side failures arrive as payment.failed on the link's
        # internal order.
        try:
            core, local_order, link_id = self._resolve_webhook_order(
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
            attempt = self._rebuild_attempt(local_order)
        # Persisted delivery claim, atomic across processes and replicas:
        # duplicates return the current attempt with no new rows. The amount
        # is part of the key: a mismatched delivery must not burn the key for
        # a later corrected event for the same payment, while identical
        # redeliveries still collapse to one ledger row.
        amount_token = payment.get("amount")
        delivery_key = (
            f"{event_name}:{provider_payment_id or link_id or local_order_id}"
            f":{amount_token}"
        )
        if not core.ledger.claim_delivery(delivery_key):
            # Duplicate delivery: answer from authoritative DB state, not from
            # a blank rebuilt attempt — after a restart the in-memory attempt
            # knows nothing about the settlement that already happened.
            if local_order.status is OrderStatus.PAID:
                attempt = attempt.model_copy(
                    update={
                        "status": PaymentStatus.CAPTURED,
                        "provider_payment_id": (
                            attempt.provider_payment_id
                            or core.ledger.last_provider_ref(local_order.trace_id)
                        ),
                    }
                )
                self._attempt_by_order_id[local_order_id] = attempt
            elif local_order.status is OrderStatus.PAYMENT_FAILED:
                attempt = attempt.model_copy(update={"status": PaymentStatus.FAILED})
                self._attempt_by_order_id[local_order_id] = attempt
            return attempt
        flags = list(extra_flags) if extra_flags else []
        provenance_note = (
            " (Simulated provider event — dev only, not real provider money.)"
            if "simulated" in flags
            else ""
        )

        if event_name in ("payment.captured", "payment_link.paid"):
            try:
                raw_amount = payment.get("amount")
                captured_amount = None if raw_amount is None else int(raw_amount)
            except (TypeError, ValueError):
                captured_amount = None
            if (
                provider_payment_id is None
                or captured_amount is None
                or captured_amount != local_order.amount_paise
            ):
                self._record(
                    core=core,
                    trace_id=local_order.trace_id,
                    action="webhook.amount_mismatch",
                    inputs={"event": event_name, "provider_payment_id": provider_payment_id},
                    output={
                        "provider_amount_paise": payment.get("amount"),
                        "order_amount_paise": local_order.amount_paise,
                    },
                    provider_ref=provider_payment_id,
                    explanation=(
                        "The captured amount does not match the local order amount (or is "
                        "missing); the order was not settled." + provenance_note
                    ),
                    flags=flags,
                )
                return attempt
            if local_order.status is OrderStatus.PAID:
                # Already settled: redelivery, or payment_link.paid racing
                # payment.captured for the same settlement. A second DISTINCT
                # capture is real money kept by the provider account — never
                # drop it silently; flag it for refund/reconciliation.
                if (
                    provider_payment_id
                    and attempt.provider_payment_id
                    and attempt.provider_payment_id != provider_payment_id
                ):
                    self._record(
                        core=core,
                        trace_id=local_order.trace_id,
                        action="webhook.duplicate_capture",
                        inputs={
                            "event": event_name,
                            "order_id": local_order_id,
                            "first_payment_id": attempt.provider_payment_id,
                            "second_payment_id": provider_payment_id,
                        },
                        output={"order_status": "PAID"},
                        provider_ref=provider_payment_id,
                        explanation=(
                            "A second distinct capture arrived for an already-settled order. "
                            "The order stays PAID; the extra payment needs a refund or manual "
                            "reconciliation." + provenance_note
                        ),
                        flags=flags,
                    )
                return attempt
            try:
                core.mark_paid(local_order_id, provider_ref=provider_payment_id)
            except InvalidOrderTransitionError as error:
                self._record(
                    core=core,
                    trace_id=local_order.trace_id,
                    action="webhook.unexpected_state",
                    inputs={
                        "event": event_name,
                        "order_id": local_order_id,
                        "order_status": local_order.status,
                        "provider_payment_id": provider_payment_id,
                    },
                    output={"settled": False},
                    provider_ref=provider_payment_id,
                    explanation=(
                        f"A verified {event_name} webhook arrived for an order in "
                        f"{local_order.status}; the strict state machine refused settlement. "
                        "Manual reconciliation required." + provenance_note
                    ),
                    flags=flags,
                )
                raise UnexpectedOrderStateError(
                    f"Order {local_order_id} in {local_order.status} cannot settle {event_name}"
                ) from error
            updated_attempt = attempt.model_copy(
                update={
                    "provider_payment_id": provider_payment_id,
                    "status": PaymentStatus.CAPTURED,
                }
            )
            explanation = (
                "Verified Razorpay payment webhook and settled the local order."
                + provenance_note
            )
        else:  # payment.failed / payment_link.cancelled
            reason = (
                str(payment.get("error_description") or "")
                or (
                    "The payment link was cancelled; it can no longer be paid."
                    if event_name == "payment_link.cancelled"
                    else "Razorpay reported a failed payment"
                )
            )
            if local_order.status is OrderStatus.PAYMENT_FAILED:
                return attempt  # already failed — idempotent
            try:
                core.mark_payment_failed(
                    local_order_id, reason=reason, provider_ref=provider_payment_id
                )
            except InvalidOrderTransitionError as error:
                self._record(
                    core=core,
                    trace_id=local_order.trace_id,
                    action="webhook.unexpected_state",
                    inputs={
                        "event": event_name,
                        "order_id": local_order_id,
                        "order_status": local_order.status,
                    },
                    output={"recorded": False},
                    provider_ref=provider_payment_id,
                    explanation=(
                        f"A verified {event_name} webhook arrived for an order in "
                        f"{local_order.status}; the strict state machine refused the failure "
                        "transition. Manual reconciliation required." + provenance_note
                    ),
                    flags=flags,
                )
                raise UnexpectedOrderStateError(
                    f"Order {local_order_id} in {local_order.status} cannot record {event_name}"
                ) from error
            updated_attempt = attempt.model_copy(
                update={
                    "provider_payment_id": provider_payment_id,
                    "status": PaymentStatus.FAILED,
                    "failure_reason": reason,
                }
            )
            explanation = (
                "Verified Razorpay payment failure webhook and recorded the explicit failure state."
                + provenance_note
            )

        self._attempt_by_order_id[local_order_id] = updated_attempt
        self._record(
            core=core,
            trace_id=local_order.trace_id,
            action="webhook.reconciled",
            inputs={"event": event_name, "provider_order_id": attempt.provider_order_id},
            output={"order_id": local_order_id, "status": updated_attempt.status},
            provider_ref=provider_payment_id,
            explanation=explanation,
            flags=flags,
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
        flags: list[str] | None = None,
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
                flags=flags or [],
            )
        )
