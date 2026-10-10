"""Event-driven notifications (target §35) and outbound webhook fan-out
(target §36.2). Consumers call ``notify_for_event``; rules decide the
merchant feed entries, and matching subscriptions receive signed HTTP
deliveries. No messages are ever sent inside core database transactions —
only from bus consumers.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import urllib.request
from uuid import uuid4


logger = logging.getLogger("sellable.notifications")

#: Events merchants and agent platforms may subscribe to (§36.2 + lifecycle).
SUBSCRIBABLE_EVENTS = (
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

_SIGNATURE_HEADER = "X-Sellable-Signature"
_EVENT_HEADER = "X-Sellable-Event"


def _inr(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def merchant_notifications_for(event) -> list[dict[str, object]]:
    """In-app merchant feed entries for one bus event. Returns rule dicts
    (title, body, urgency); the caller persists them."""
    data = event.data or {}
    event_type = event.event_type
    if event_type == "order.paid":
        amount = int(data.get("amount_paise") or 0)
        return [{
            "title": f"Order {event.aggregate_id} paid"
            + (f" ({_inr(amount)})" if amount else ""),
            "body": f"Payment confirmed for order {event.aggregate_id}.",
            "urgency": "NORMAL",
        }]
    if event_type == "order.created" and data.get("requires_approval"):
        return [{
            "title": f"Approval needed: order {event.aggregate_id}",
            "body": "A transaction exceeded the human-approval threshold.",
            "urgency": "URGENT",
        }]
    if event_type == "refund.completed":
        return [{
            "title": f"Refund settled for order {event.aggregate_id}",
            "body": "The provider confirmed the refund.",
            "urgency": "NORMAL",
        }]
    if event_type == "support.case.updated" and data.get("status") == "ESCALATED":
        return [{
            "title": f"Support escalation {event.aggregate_id}",
            "body": "A case was escalated to human support with full context.",
            "urgency": "URGENT",
        }]
    if event_type == "risk.action_taken":
        reasons = data.get("reasons") or []
        return [{
            "title": f"Risk block on {event.aggregate_type} {event.aggregate_id}",
            "body": f"Blocked: {', '.join(reasons) if reasons else 'risk policy'}.",
            "urgency": "URGENT",
        }]
    if event_type == "checkout.completed":
        return [{
            "title": f"Checkout {event.aggregate_id} completed",
            "body": f"Linked order {data.get('order_id')}.",
            "urgency": "NORMAL",
        }]
    return []


def notify_for_event(event, *, notification_repo=None, webhook_dispatcher=None) -> list[str]:
    """Persist merchant feed entries and fan out to matching subscriptions.
    Returns created notification ids. Idempotent per event only when the
    caller dedupes — the bus delivers at-least-once, so redelivery may
    duplicate feed rows (keyed per event for triage)."""
    created: list[str] = []
    if notification_repo is not None:
        for rule in merchant_notifications_for(event):
            created.append(
                notification_repo.create(
                    merchant_id=event.merchant_id,
                    channel="inapp",
                    event_type=event.event_type,
                    title=str(rule["title"]),
                    body=str(rule["body"]),
                    urgency=str(rule["urgency"]),
                    trace_id=event.trace_id,
                )
            )
    if webhook_dispatcher is not None and event.event_type in SUBSCRIBABLE_EVENTS:
        webhook_dispatcher.dispatch(event)
    return created


def sign_payload(secret: str, raw_body: bytes) -> str:
    """HMAC-SHA256 signature over the exact delivery bytes."""
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def post_json(
    url: str, payload: dict[str, object], headers: dict[str, str], *, timeout: int = 10
) -> int:
    """POST JSON, returning the HTTP status. stdlib only (no new deps)."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status or 200)
    except Exception as error:  # noqa: BLE001 — delivery failure is data
        raise RuntimeError(f"webhook delivery failed: {error}") from error


class WebhookDispatcher:
    """Signed outbound deliveries with attempt logging (target §36.2)."""

    def __init__(self, webhook_repo, *, post_fn=None, max_attempts: int = 3) -> None:
        self._webhooks = webhook_repo
        self._post = post_fn or post_json
        self._max_attempts = max_attempts

    def dispatch(self, event) -> int:
        """Deliver to all matching subscriptions. Returns deliveries made."""
        made = 0
        for subscription in self._webhooks.matching_subscriptions(
            event.merchant_id, event.event_type
        ):
            self._deliver_to(subscription, event)
            made += 1
        return made

    def _deliver_to(self, subscription: dict[str, object], event) -> None:
        from sellable.contracts import new_id

        payload = {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "merchant_id": event.merchant_id,
            "aggregate_type": event.aggregate_type,
            "aggregate_id": event.aggregate_id,
            "trace_id": event.trace_id,
            "occurred_at": event.occurred_at.isoformat()
            if hasattr(event.occurred_at, "isoformat")
            else str(event.occurred_at),
            "data": dict(event.data or {}),
        }
        raw = json.dumps(payload).encode("utf-8")
        signature = sign_payload(str(subscription["secret"]), raw)
        headers = {
            _SIGNATURE_HEADER: signature,
            _EVENT_HEADER: event.event_type,
        }
        attempts = 0
        last_code: int | None = None
        last_error: str | None = None
        status = "FAILED"
        while attempts < self._max_attempts:
            attempts += 1
            try:
                last_code = int(
                    self._post(str(subscription["url"]), payload, headers)
                )
                if 200 <= last_code < 300:
                    status = "SENT"
                    last_error = None
                    break
                last_error = f"HTTP {last_code}"
            except Exception as error:  # noqa: BLE001 — delivery failure is data
                last_error = str(error)[:300]
        self._webhooks.log_dispatch(
            dispatch_id=new_id("whd"),
            subscription_id=str(subscription["subscription_id"]),
            merchant_id=event.merchant_id,
            event_id=event.event_id,
            event_type=event.event_type,
            status=status,
            attempts=attempts,
            last_status_code=last_code,
            last_error=last_error,
        )
