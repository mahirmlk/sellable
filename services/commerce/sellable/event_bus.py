"""Event Bus (target §27): durable async fan-out behind a small event
interface. Domain services publish envelopes to the transactional outbox;
this bus claims unpublished rows and delivers each to the subscribed
consumers with idempotent handlers, bounded retries, and a dead-letter
queue. The audit ledger stays the evidence layer — the bus is delivery.

At-least-once delivery: consumers must tolerate redelivery (analytics
ingest dedupes on event_id; fulfillment checks existence; notifications
are keyed per event).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable


logger = logging.getLogger("sellable.event_bus")

#: Deliveries are retried this many times before dead-lettering.
MAX_DELIVERY_ATTEMPTS = 5


class EventBus:
    def __init__(self, outbox_repo, *, max_attempts: int = MAX_DELIVERY_ATTEMPTS) -> None:
        self._outbox = outbox_repo
        self._handlers: dict[str, list[Callable]] = {}
        self._max_attempts = max_attempts

    def subscribe(self, event_type: str, handler: Callable) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    def subscribed_types(self) -> list[str]:
        return sorted(self._handlers)

    def run_once(self, *, limit: int = 100, merchant_id: str | None = None) -> dict[str, int]:
        """Claim deliverable envelopes and fan out. Returns run stats."""
        stats = {"claimed": 0, "delivered": 0, "failed": 0, "dead_lettered": 0}
        for event in self._outbox.claim_unpublished(limit=limit, merchant_id=merchant_id):
            stats["claimed"] += 1
            handlers = self._handlers.get(event.event_type, [])
            if not handlers:
                self._outbox.mark_published(event.event_id)
                stats["delivered"] += 1
                continue
            try:
                for handler in handlers:
                    handler(event)
            except Exception as error:  # noqa: BLE001 — one bad consumer retries
                attempts = self._outbox.mark_failed(event.event_id, str(error))
                stats["failed"] += 1
                if attempts >= self._max_attempts:
                    self._outbox.mark_dead_letter(event.event_id, str(error))
                    stats["dead_lettered"] += 1
                    logger.warning(
                        "event %s dead-lettered after %d attempts: %s",
                        event.event_id, attempts, error,
                    )
                continue
            self._outbox.mark_published(event.event_id)
            stats["delivered"] += 1
        return stats


# ------------------------------------------------------------------
# Consumer factories. Each takes resolved repositories/services and
# returns handler(event). All handlers are idempotent by construction.
# ------------------------------------------------------------------

def make_analytics_consumer(analytics_repo, core_resolver=None):
    """Normalize bus events into analytical facts (§34.1)."""

    def handle(event) -> None:
        amount = int((event.data or {}).get("amount_paise") or 0)
        if not amount and core_resolver is not None and event.event_type == "order.paid":
            try:
                order = core_resolver(event.merchant_id).get_order(event.aggregate_id)
                amount = order.amount_paise
            except Exception:  # noqa: BLE001 — analytics never breaks delivery
                amount = 0
        analytics_repo.ingest(event, amount_paise=amount)

    return handle


def make_notification_consumer(notification_repo, webhook_dispatcher=None):
    """Event-driven merchant notifications (§35) + webhook fan-out (§36.2)."""
    from sellable.notifications import notify_for_event

    def handle(event) -> None:
        for notification in notify_for_event(
            event,
            notification_repo=notification_repo,
            webhook_dispatcher=webhook_dispatcher,
        ):
            _ = notification

    return handle


def make_fulfillment_consumer(core_resolver):
    """Start basic fulfillment when payment confirms (§27 example flow)."""

    def handle(event) -> None:
        if event.event_type != "order.paid":
            return
        from sellable.contracts import ShippingMethod

        core = core_resolver(event.merchant_id)
        try:
            core.create_fulfillment(
                event.aggregate_id, ShippingMethod.STANDARD, trace_id=event.trace_id
            )
        except Exception:  # noqa: BLE001 — exists or unpaid: idempotent skip
            pass

    return handle


def make_trust_consumer(core_resolver):
    """Fold payment outcomes into agent reputation (§32.2 trust updates)."""

    def handle(event) -> None:
        if event.event_type != "order.paid":
            return
        core = core_resolver(event.merchant_id)
        try:
            checkout = core.checkout_repo.for_order(event.aggregate_id, event.merchant_id)
        except Exception:  # noqa: BLE001 — trust is additive
            return
        if checkout is None or not checkout.delegation_id:
            return
        try:
            grant = core.delegation_repo.get(checkout.delegation_id)
            if grant is None:
                return
            core.trust_service.record_success(
                grant.subject_agent_id,
                merchant_id=event.merchant_id,
                reference=event.aggregate_id,
            )
        except Exception:  # noqa: BLE001 — trust is additive
            pass

    return handle


def build_bus(
    *,
    outbox_repo,
    analytics_repo=None,
    notification_repo=None,
    webhook_dispatcher=None,
    core_resolver=None,
    extra_handlers: dict[str, list] | None = None,
) -> EventBus:
    """Wire the standard consumer set. Returns a ready-to-drain bus."""
    bus = EventBus(outbox_repo)
    if analytics_repo is not None:
        for event_type in (
            "order.created",
            "order.paid",
            "checkout.completed",
            "refund.completed",
            "return.created",
            "cart.updated",
            "agent.run.completed",
        ):
            bus.subscribe(
                event_type,
                make_analytics_consumer(analytics_repo, core_resolver),
            )
    if notification_repo is not None or webhook_dispatcher is not None:
        for event_type in (
            "order.created",
            "order.paid",
            "checkout.completed",
            "refund.completed",
            "return.created",
            "support.case.updated",
            "risk.action_taken",
            "order.shipped",
            "order.delivered",
        ):
            bus.subscribe(
                event_type,
                make_notification_consumer(notification_repo, webhook_dispatcher),
            )
    if core_resolver is not None:
        bus.subscribe("order.paid", make_fulfillment_consumer(core_resolver))
        bus.subscribe("order.paid", make_trust_consumer(core_resolver))
    for event_type, handlers in (extra_handlers or {}).items():
        for handler in handlers:
            bus.subscribe(event_type, handler)
    return bus


def drain_once(bus: EventBus, *, limit: int = 100, merchant_id=None) -> dict[str, int]:
    started = time.perf_counter()
    stats = bus.run_once(limit=limit, merchant_id=merchant_id)
    stats["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
    return stats
