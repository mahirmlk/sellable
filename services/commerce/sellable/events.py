"""Platform event envelope (target §27.3).

The Event Bus is for distributed communication and async processing; the
Audit Ledger is for durable evidence (§4.5). This envelope is the bus
contract: at-least-once delivery with idempotent consumers, versioned event
types, and transactional-outbox publishing (bus implementation in Phase 6).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from sellable.contracts import StrictModel, new_id, utc_now


#: Normalized outbound webhook/subscription types (target §36.2).
CANONICAL_EVENT_TYPES = (
    "cart.updated",
    "checkout.completed",
    "order.created",
    "order.paid",
    "order.shipped",
    "order.delivered",
    "return.created",
    "refund.completed",
    "support.case.updated",
    "agent.run.completed",
    "risk.action_taken",
)


class EventActor(StrictModel):
    type: str = Field(min_length=1, max_length=64)
    id: str = Field(min_length=1, max_length=128)


class PlatformEvent(StrictModel):
    """Versioned, tenant-scoped bus envelope (target §27.3)."""

    event_id: str = Field(default_factory=lambda: new_id("evt"))
    event_type: str = Field(min_length=1, max_length=128)
    event_version: int = Field(default=1, ge=1)
    occurred_at: datetime = Field(default_factory=utc_now)
    tenant_id: str = Field(min_length=1, max_length=128)
    merchant_id: str = Field(min_length=1, max_length=128)
    aggregate_type: str = Field(min_length=1, max_length=64)
    aggregate_id: str = Field(min_length=1, max_length=128)
    trace_id: str = Field(pattern=r"^trc_[0-9a-f]{32}$")
    actor: EventActor
    data: dict[str, Any] = Field(default_factory=dict)


def new_event(
    *,
    event_type: str,
    tenant_id: str,
    merchant_id: str,
    aggregate_type: str,
    aggregate_id: str,
    trace_id: str,
    actor_type: str,
    actor_id: str,
    data: dict[str, Any] | None = None,
    event_version: int = 1,
) -> PlatformEvent:
    """Build a well-formed envelope with server-generated identity."""
    return PlatformEvent(
        event_type=event_type,
        event_version=event_version,
        tenant_id=tenant_id,
        merchant_id=merchant_id,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        trace_id=trace_id,
        actor=EventActor(type=actor_type, id=actor_id),
        data=dict(data or {}),
    )
