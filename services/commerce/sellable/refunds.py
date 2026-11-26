"""Real refunds through the payment rail — money actually moves.

Every refund calls the provider (Razorpay test mode), persists the provider
refund id, and is idempotent per (merchant, idempotency_key): retried
requests return the existing refund record instead of refunding twice.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from threading import RLock

from sellable.contracts import (
    LedgerActor,
    LedgerEvent,
    OrderStatus,
    Refund,
    RefundStatus,
)
from sellable.core import CommerceCore
from sellable.orders import InvalidOrderTransitionError
from sellable.payments.razorpay import (
    InvalidWebhookSignatureError,
    RazorpayAdapter,
    RazorpayConfigurationError,
    RazorpayRequestError,
)
from sellable.payments.service import UnexpectedOrderStateError
from sellable.repositories import RefundRepository

logger = logging.getLogger(__name__)


class RefundService:
    """Issues provider refunds against verified paid orders."""

    def __init__(
        self,
        commerce: CommerceCore,
        rail: RazorpayAdapter | None = None,
        refund_repo: RefundRepository | None = None,
    ) -> None:
        self.commerce = commerce
        self.rail = rail
        self._refund_repo = refund_repo
        # The initial production topology is one process/replica. Serialize
        # refund balance checks and reservations inside that process so two
        # concurrent partial refunds cannot both spend the same balance.
        self._refund_lock = RLock()
        self._settlement_lock = RLock()

    def _repo(self) -> RefundRepository:
        if self._refund_repo is None:
            self._refund_repo = RefundRepository()
        return self._refund_repo

    def handle_webhook(
        self,
        body: bytes,
        signature: str | None,
        *,
        event_id: str | None,
        core_for_merchant: Callable[[str], CommerceCore],
    ) -> dict[str, object]:
        """Verify and reconcile signed Razorpay refund status events.

        Refund status and the webhook delivery claim are committed together.
        Processed settlement is idempotent, so a duplicate event can repair a
        crash between committing refund status and updating the order ledger.
        """
        if self.rail is None:
            raise RazorpayConfigurationError("Razorpay refund rail is not configured")
        self.rail.verify_webhook(body, signature)
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as error:
            raise ValueError("Refund webhook body is not valid JSON") from error
        if not isinstance(payload, dict):
            raise ValueError("Refund webhook payload must be an object")

        event_name = payload.get("event")
        if not isinstance(event_name, str) or not event_name.startswith("refund."):
            raise ValueError("Unsupported Razorpay refund webhook event")
        if event_name not in {"refund.created", "refund.processed", "refund.failed"}:
            return {"status": "ignored", "event_type": event_name}

        section = payload.get("payload")
        refund_section = section.get("refund") if isinstance(section, dict) else None
        entity = (
            refund_section.get("entity")
            if isinstance(refund_section, dict)
            else None
        )
        if not isinstance(entity, dict):
            raise ValueError("Refund webhook entity is invalid")
        provider_refund_id = entity.get("id")
        provider_payment_id = entity.get("payment_id")
        raw_amount = entity.get("amount")
        provider_status = entity.get("status")
        currency = entity.get("currency", "INR")
        try:
            amount_paise = int(raw_amount)
        except (TypeError, ValueError) as error:
            raise ValueError("Refund webhook amount is invalid") from error
        if (
            not isinstance(provider_refund_id, str)
            or not provider_refund_id
            or not isinstance(provider_payment_id, str)
            or not provider_payment_id
            or amount_paise <= 0
            or currency != "INR"
        ):
            raise ValueError("Refund webhook entity is missing valid identifiers or amount")

        statuses = {
            "pending": RefundStatus.PENDING,
            "processed": RefundStatus.PROCESSED,
            "failed": RefundStatus.FAILED,
        }
        if not isinstance(provider_status, str) or provider_status not in statuses:
            raise ValueError("Refund webhook has an unsupported provider status")
        target_status = statuses[provider_status]
        if event_name == "refund.processed" and target_status is not RefundStatus.PROCESSED:
            raise UnexpectedOrderStateError(
                "Signed refund.processed event has a non-processed status"
            )
        if event_name == "refund.failed" and target_status is not RefundStatus.FAILED:
            raise UnexpectedOrderStateError(
                "Signed refund.failed event has a non-failed status"
            )

        repo = self._repo()
        refund = repo.for_provider_refund_id(provider_refund_id)
        if refund is None:
            notes = entity.get("notes")
            order_id = notes.get("local_order_id") if isinstance(notes, dict) else None
            if isinstance(order_id, str):
                refund = repo.match_ambiguous_provider_refund(
                    provider_payment_id=provider_payment_id,
                    order_id=order_id,
                    amount_paise=amount_paise,
                )
        if refund is None:
            # Acknowledging an uncorrelated money event would silently lose
            # settlement. Return a retryable conflict so operators can reconcile
            # the provider record before the event is acknowledged.
            logger.error("Signed Razorpay refund event could not be correlated")
            raise UnexpectedOrderStateError(
                "Signed Razorpay refund event could not be matched to a local refund"
            )

        if (
            refund.amount_paise != amount_paise
            or (
                refund.provider_payment_id is not None
                and refund.provider_payment_id != provider_payment_id
            )
        ):
            raise UnexpectedOrderStateError(
                "Signed Razorpay refund event does not match the stored refund request"
            )

        # Razorpay's event ID is a header, while the webhook signature
        # authenticates the raw body. Do not let an unsigned header override
        # delivery deduplication: a replayed signed body must keep one claim.
        delivery_key = "refund:" + hashlib.sha256(body).hexdigest()
        with self._settlement_lock:
            updated, _changed = repo.reconcile_provider_status(
                refund_id=refund.refund_id,
                provider_refund_id=provider_refund_id,
                status=target_status,
                delivery_key=delivery_key,
            )
            if updated is None:
                logger.error("Signed Razorpay refund event lost its local refund row")
                raise UnexpectedOrderStateError(
                    "Signed Razorpay refund event has no local refund record"
                )

            core = core_for_merchant(updated.merchant_id)
            order = core.get_order(updated.order_id)
            if updated.status is RefundStatus.PROCESSED:
                total_processed = sum(
                    item.amount_paise
                    for item in repo.for_order(updated.merchant_id, updated.order_id)
                    if item.status is RefundStatus.PROCESSED
                )
                self._settle_processed_refund(
                    core,
                    order,
                    updated.provider_refund_id,
                    partial=total_processed < order.amount_paise,
                )
            elif updated.status is RefundStatus.FAILED:
                events = core.ledger.for_trace(
                    order.trace_id, merchant_id=order.merchant_id
                )
                if not any(
                    event.provider_ref == updated.provider_refund_id
                    and event.action == "refund.failed"
                    for event in events
                ):
                    core.ledger.append(
                        LedgerEvent(
                            trace_id=order.trace_id,
                            merchant_id=order.merchant_id,
                            actor=LedgerActor.COMMERCE_CORE,
                            action="refund.failed",
                            inputs={
                                "order_id": order.order_id,
                                "refund_id": updated.refund_id,
                                "amount_paise": updated.amount_paise,
                                "source": "razorpay_webhook",
                            },
                            output={"status": "failed"},
                            reasoning_summary="Razorpay reported that the test-mode refund failed.",
                            provider_ref=updated.provider_refund_id,
                        )
                    )
            return {
                "status": updated.status.value.lower(),
                "refund_id": updated.refund_id,
                "provider_refund_id": updated.provider_refund_id or "",
                "order_id": updated.order_id,
            }

    def initiate_refund(
        self,
        *,
        order_id: str,
        reason: str,
        amount_paise: int | None = None,
        idempotency_key: str | None = None,
        trace_id: str | None = None,
        commerce: CommerceCore | None = None,
    ) -> dict[str, object]:
        with self._refund_lock:
            return self._initiate_refund(
                order_id=order_id,
                reason=reason,
                amount_paise=amount_paise,
                idempotency_key=idempotency_key,
                trace_id=trace_id,
                commerce=commerce,
            )

    def _initiate_refund(
        self,
        *,
        order_id: str,
        reason: str,
        amount_paise: int | None = None,
        idempotency_key: str | None = None,
        trace_id: str | None = None,
        commerce: CommerceCore | None = None,
    ) -> dict[str, object]:
        """Refund a paid order through the provider.

        The caller (endpoint) passes the merchant-scoped core after verifying
        the order belongs to that merchant; ``get_order`` on a scoped core
        raises for orders the merchant does not own.
        """
        if self.rail is None:
            raise RazorpayRequestError(
                "Refund rail is not configured", retryable=False
            )
        core = commerce or self.commerce
        order = core.get_order(order_id)
        amount = amount_paise if amount_paise is not None else order.amount_paise
        if amount <= 0 or amount > order.amount_paise:
            raise ValueError(
                f"Refund amount must be between 1 and {order.amount_paise} paise"
            )
        key = idempotency_key or f"rfnd:{order.order_id}:{amount}"
        repo = self._repo()
        # Idempotency first: a retried request must return the recorded
        # result even though the first call already advanced the order to
        # REFUNDED (checking status first would 400 every legitimate retry).
        existing = repo.for_idempotency_key(order.merchant_id, key)
        if existing is not None:
            if (
                existing.order_id != order.order_id
                or existing.amount_paise != amount
                or existing.reason != reason
            ):
                raise ValueError("Idempotency key was already used for a different refund request")
            if existing.status is RefundStatus.PROCESSED:
                total = sum(
                    item.amount_paise
                    for item in repo.for_order(order.merchant_id, order.order_id)
                    if item.status is RefundStatus.PROCESSED
                )
                self._settle_processed_refund(
                    core, order, existing.provider_refund_id,
                    partial=total < order.amount_paise,
                )
                return self._present(existing, order_trace=order.trace_id)
            if existing.status is RefundStatus.FAILED:
                return self._present(existing, order_trace=order.trace_id)
            record = existing
        else:
            record = None
        if order.status not in (OrderStatus.PAID, OrderStatus.FULFILLED):
            if record is None:
                raise ValueError(
                    f"Refund requires a PAID or FULFILLED order; current status is {order.status}"
                )

        payment_id = core.ledger.last_provider_ref(order.trace_id, action="order.paid")
        if payment_id is None:
            raise ValueError(
                "No captured provider payment is recorded for this order; cannot refund"
            )
        prior_refunds = repo.for_order(order.merchant_id, order.order_id)
        already_refunded = sum(
            item.amount_paise
            for item in prior_refunds
            if item.status is not RefundStatus.FAILED
            and (record is None or item.refund_id != record.refund_id)
        )
        if already_refunded + amount > order.amount_paise:
            raise ValueError("Refund amount exceeds the order's remaining refundable balance")
        if record is None:
            record = Refund(
                merchant_id=order.merchant_id,
                order_id=order.order_id,
                amount_paise=amount,
                provider_payment_id=payment_id,
                reason=reason,
                status=RefundStatus.PENDING,
                idempotency_key=key,
            )
            repo.save(record)

        try:
            provider_refund = self.rail.refund(
                payment_id,
                amount,
                notes={"local_order_id": order.order_id, "trace_id": order.trace_id},
                idempotency_key=f"sellable:{order.merchant_id}:{order.order_id}:{key}",
            )
        except RazorpayRequestError as error:
            status = RefundStatus.PENDING if error.retryable else RefundStatus.FAILED
            repo.save(record.model_copy(update={"status": status}))
            core.ledger.append(
                LedgerEvent(
                    trace_id=trace_id or order.trace_id,
                    merchant_id=order.merchant_id,
                    actor=LedgerActor.COMMERCE_CORE,
                    action="refund.retryable_failure" if error.retryable else "refund.failed",
                    inputs={
                        "order_id": order_id,
                        "amount_paise": amount,
                        "reason": reason,
                    },
                    output={"retryable": error.retryable},
                    reasoning_summary=f"The provider refund failed: {error}",
                    provider_ref=payment_id,
                )
            )
            raise

        settled = record.model_copy(
            update={
                "provider_refund_id": provider_refund.provider_refund_id,
                "status": {
                    "pending": RefundStatus.PENDING,
                    "processed": RefundStatus.PROCESSED,
                    "failed": RefundStatus.FAILED,
                }[provider_refund.status],
            }
        )
        with self._settlement_lock:
            repo.save(settled)
            # A webhook may have advanced this row while the provider call was
            # returning. Continue from persisted monotonic state, never this stale
            # response snapshot.
            settled = repo.for_idempotency_key(order.merchant_id, key) or settled
            if settled.status is not RefundStatus.PROCESSED:
                return self._present(settled, order_trace=order.trace_id)
            total_refunded = sum(
                item.amount_paise
                for item in repo.for_order(order.merchant_id, order.order_id)
                if item.status is RefundStatus.PROCESSED
            )
            self._settle_processed_refund(
                core,
                order,
                settled.provider_refund_id,
                partial=total_refunded < order.amount_paise,
            )
            return self._present(settled, order_trace=order.trace_id)

    def _settle_processed_refund(
        self, core: CommerceCore, order, provider_refund_id: str | None, *, partial: bool
    ) -> None:
        if not provider_refund_id:
            return
        # Webhooks and provider API responses can reconcile the same refund
        # concurrently. Serialize the short order/ledger transition without
        # holding a lock across provider network I/O.
        with self._settlement_lock:
            events = core.ledger.for_trace(order.trace_id, merchant_id=order.merchant_id)
            if any(
                event.provider_ref == provider_refund_id
                and event.action in {"refund.settled", "refund.partial_settled"}
                for event in events
            ):
                return
            try:
                core.mark_refunded(
                    order.order_id,
                    provider_ref=provider_refund_id,
                    partial=partial,
                )
            except InvalidOrderTransitionError as error:
                raise UnexpectedOrderStateError(
                    f"Order {order.order_id} in {order.status} cannot record the refund"
                ) from error

    @staticmethod
    def _present(refund: Refund, *, order_trace: str) -> dict[str, object]:
        return {
            "refund_id": refund.refund_id,
            "order_id": refund.order_id,
            "amount_paise": refund.amount_paise,
            "provider_payment_id": refund.provider_payment_id,
            "provider_refund_id": refund.provider_refund_id,
            "refund_status": "initiated"
            if refund.status is RefundStatus.PENDING
            else refund.status.value.lower(),
            "reason": refund.reason,
            "trace_id": order_trace,
        }

