"""Deterministic refund service — issues refunds through the payment rail."""

from __future__ import annotations

from sellable.contracts import (
    LedgerActor,
    LedgerEvent,
    OrderStatus,
)
from sellable.core import CommerceCore


class RefundService:
    """Orchestrates refunds against verified paid orders."""

    def __init__(self, commerce: CommerceCore) -> None:
        self.commerce = commerce

    def initiate_refund(
        self,
        *,
        order_id: str,
        reason: str,
        trace_id: str | None = None,
        commerce: CommerceCore | None = None,
    ) -> dict[str, object]:
        """Issue a refund against the owning merchant's core.

        The caller (endpoint) passes the merchant-scoped core after verifying
        the order belongs to that merchant; ``get_order`` on a scoped core
        raises for orders the merchant does not own.
        """
        core = commerce or self.commerce
        order = core.get_order(order_id)
        if order.status is not OrderStatus.PAID:
            raise ValueError(
                f"Refund requires a PAID order; current status is {order.status}"
            )

        resolved_trace = trace_id or order.trace_id

        updated = order.model_copy(update={"status": OrderStatus.REFUNDED})
        core._orders[order_id] = updated
        core.order_repo.save(updated)

        core._record(
            trace_id=resolved_trace,
            actor=LedgerActor.COMMERCE_CORE,
            action="refund.initiated",
            inputs={"order_id": order_id, "amount_paise": order.amount_paise, "reason": reason},
            output={"refund_status": "initiated", "order_status": OrderStatus.REFUNDED},
            reasoning_summary=f"Refund of {order.amount_paise} paise initiated for order {order_id}: {reason}.",
            provider_ref=order.idempotency_key,
        )

        return {
            "order_id": order_id,
            "refund_status": "initiated",
            "amount_paise": order.amount_paise,
            "reason": reason,
            "trace_id": resolved_trace,
        }
