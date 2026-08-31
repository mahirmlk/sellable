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
    ) -> dict[str, object]:
        order = self.commerce.get_order(order_id)
        if order.status is not OrderStatus.PAID:
            raise ValueError(
                f"Refund requires a PAID order; current status is {order.status}"
            )

        resolved_trace = trace_id or order.trace_id

        updated = order.model_copy(update={"status": OrderStatus.REFUNDED})
        self.commerce._orders[order_id] = updated
        self.commerce.order_repo.save(updated)

        self.commerce._record(
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
