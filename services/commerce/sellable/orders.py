"""Deterministic order state transitions independent of payment and agents."""

from __future__ import annotations

from sellable.contracts import OrderStatus


class InvalidOrderTransitionError(ValueError):
    pass


# NOTE: QUOTED was pruned — orders are created directly as AWAITING_CONSENT
# and no QUOTED row was ever persisted, so the enum value is gone entirely.
_ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.AWAITING_CONSENT: {OrderStatus.CONSENTED, OrderStatus.ABORTED},
    OrderStatus.CONSENTED: {OrderStatus.PAYMENT_PENDING, OrderStatus.ABORTED},
    # PAYMENT_PENDING → ABORTED requires cancelling the live provider link
    # first (console reject does this); the edge alone never strands a
    # payable link.
    OrderStatus.PAYMENT_PENDING: {
        OrderStatus.PAID,
        OrderStatus.PAYMENT_FAILED,
        OrderStatus.ABORTED,
    },
    OrderStatus.PAYMENT_FAILED: {OrderStatus.PAYMENT_PENDING, OrderStatus.ABORTED},
    OrderStatus.PAID: {OrderStatus.FULFILLED, OrderStatus.REFUNDED},
    OrderStatus.FULFILLED: {OrderStatus.REFUNDED},
    OrderStatus.ABORTED: set(),
    OrderStatus.REFUNDED: set(),
}


def transition(current: OrderStatus, target: OrderStatus) -> OrderStatus:
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise InvalidOrderTransitionError(f"Cannot transition from {current} to {target}")
    return target
