"""Real refunds through the payment rail — money actually moves.

Every refund calls the provider (Razorpay test mode), persists the provider
refund id, and is idempotent per (merchant, idempotency_key): retried
requests return the existing refund record instead of refunding twice.
"""

from __future__ import annotations

from sellable.contracts import (
    LedgerActor,
    LedgerEvent,
    OrderStatus,
    Refund,
    RefundStatus,
)
from sellable.core import CommerceCore
from sellable.orders import InvalidOrderTransitionError
from sellable.payments.razorpay import RazorpayAdapter, RazorpayRequestError
from sellable.payments.service import UnexpectedOrderStateError
from sellable.repositories import RefundRepository


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

    def _repo(self) -> RefundRepository:
        if self._refund_repo is None:
            self._refund_repo = RefundRepository()
        return self._refund_repo

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
            return self._present(existing, order_trace=order.trace_id)
        if order.status not in (OrderStatus.PAID, OrderStatus.FULFILLED):
            raise ValueError(
                f"Refund requires a PAID or FULFILLED order; current status is {order.status}"
            )

        payment_id = core.ledger.last_provider_ref(order.trace_id, action="order.paid")
        if payment_id is None:
            raise ValueError(
                "No captured provider payment is recorded for this order; cannot refund"
            )
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
            )
        except RazorpayRequestError as error:
            failed = record.model_copy(update={"status": RefundStatus.FAILED})
            repo.save(failed)
            core.ledger.append(
                LedgerEvent(
                    trace_id=trace_id or order.trace_id,
                    merchant_id=order.merchant_id,
                    actor=LedgerActor.COMMERCE_CORE,
                    action="refund.failed",
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
                "status": RefundStatus.PROCESSED,
            }
        )
        repo.save(settled)
        partial = amount < order.amount_paise
        try:
            core.mark_refunded(
                order_id,
                provider_ref=provider_refund.provider_refund_id,
                partial=partial,
            )
        except InvalidOrderTransitionError as error:
            core.ledger.append(
                LedgerEvent(
                    trace_id=trace_id or order.trace_id,
                    merchant_id=order.merchant_id,
                    actor=LedgerActor.COMMERCE_CORE,
                    action="refund.unexpected_state",
                    inputs={"order_id": order_id, "order_status": order.status},
                    output={"settled": False},
                    reasoning_summary=(
                        "The provider refund succeeded but the order could not "
                        "transition; manual reconciliation required."
                    ),
                    provider_ref=provider_refund.provider_refund_id,
                )
            )
            raise UnexpectedOrderStateError(
                f"Order {order_id} in {order.status} cannot record the refund"
            ) from error
        return self._present(settled, order_trace=order.trace_id)

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
