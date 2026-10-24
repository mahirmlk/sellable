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
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:  # pragma: no cover — annotation-only
    from sellable.resilience import CircuitBreaker


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



def email_channel_configured(settings=None) -> bool:
    """True when an SMTP relay and recipients are configured (§35 email)."""
    from sellable.config import settings as default_settings

    cfg = settings or default_settings
    return bool(cfg.smtp_host and cfg.smtp_from and cfg.smtp_recipients)


def send_email_for_event(event, rule: dict[str, object], settings=None) -> bool:
    """Deliver one urgent merchant event by email. Best-effort by design:
    the in-app feed and webhook channels are the delivery truth; email is
    an additive attention channel. Returns True when handed to the relay."""
    import smtplib
    from email.message import EmailMessage

    from sellable.config import settings as default_settings

    cfg = settings or default_settings
    if not email_channel_configured(cfg):
        return False
    recipients = [
        address.strip()
        for address in str(cfg.smtp_recipients).split(",")
        if address.strip()
    ]
    message = EmailMessage()
    message["From"] = str(cfg.smtp_from)
    message["To"] = ", ".join(recipients)
    message["Subject"] = f"[SELLABLE {rule['urgency']}] {rule['title']}"
    body = str(rule.get("body") or "")
    detail = (
        f"{body}\n\nEvent: {event.event_type}\n"
        f"Merchant: {event.merchant_id}\nTrace: {event.trace_id}\n"
    )
    message.set_content(detail)
    try:
        with smtplib.SMTP(str(cfg.smtp_host), int(cfg.smtp_port), timeout=10) as smtp:
            smtp.starttls()
            smtp.send_message(message)
        return True
    except Exception as error:  # noqa: BLE001 — email never breaks commerce
        logger.warning("Email notification failed: %s", error)
        return False

def notify_for_event(event, *, notification_repo=None, webhook_dispatcher=None) -> list[str]:
    """Persist merchant feed entries and fan out to matching subscriptions.
    Returns created notification ids. Feed rows are idempotent per (event,
    rule) via a dedupe key, so at-least-once bus redelivery never
    duplicates the merchant feed."""
    created: list[str] = []
    if notification_repo is not None:
        for index, rule in enumerate(merchant_notifications_for(event)):
            # One feed row per (event, rule): bus redelivery of the same
            # event never duplicates the merchant notification feed.
            notification_id = notification_repo.create(
                merchant_id=event.merchant_id,
                channel="inapp",
                event_type=event.event_type,
                title=str(rule["title"]),
                body=str(rule["body"]),
                urgency=str(rule["urgency"]),
                trace_id=event.trace_id,
                dedupe_key=f"{event.event_id}:{index}:{rule['urgency']}",
            )
            if notification_id is not None:
                created.append(notification_id)
            if str(rule["urgency"]) == "URGENT":
                send_email_for_event(event, rule)
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

    def __init__(self, webhooks, *, post_fn=None, max_attempts: int = 3) -> None:
        self._webhooks = webhooks
        self._post = post_fn or post_json
        self._max_attempts = max_attempts
        # §46.2 circuit breakers: a subscription endpoint that keeps failing
        # is skipped fast instead of each delivery paying the full timeout.
        # Bounded map; subscriptions are a small per-merchant set.
        self._breakers: dict[str, "CircuitBreaker"] = {}

    def _breaker_for(self, subscription: dict[str, object]) -> "CircuitBreaker":
        from sellable.resilience import CircuitBreaker

        key = str(subscription.get("subscription_id") or subscription.get("url") or "?")
        breaker = self._breakers.get(key)
        if breaker is None:
            breaker = CircuitBreaker(
                name=f"webhook:{key}", failure_threshold=5, cooldown_seconds=60.0
            )
            self._breakers[key] = breaker
        return breaker

    def dispatch(self, event) -> int:
        """Deliver to all matching subscriptions. Returns deliveries made.
        An open breaker skips the subscription (the retry log records it as
        SKIPPED_CIRCUIT_OPEN)."""
        made = 0
        for subscription in self._webhooks.matching_subscriptions(
            event.merchant_id, event.event_type
        ):
            from sellable.resilience import CircuitOpenError

            try:
                self._breaker_for(subscription).before_call()
            except CircuitOpenError:
                self._record_skipped(subscription, event)
                continue
            try:
                self._deliver_to(subscription, event)
            except Exception:
                self._breaker_for(subscription).record_failure()
                raise
            self._breaker_for(subscription).record_success()
            made += 1
        return made

    def _record_skipped(self, subscription: dict[str, object], event) -> None:
        """Best-effort SKIPPED_CIRCUIT_OPEN row so triage sees the gap."""
        try:
            from sellable.contracts import new_id
            from sellable.repositories import WebhookRepository

            self._webhooks.log_dispatch(
                dispatch_id=new_id("whd"),
                subscription_id=str(subscription.get("subscription_id") or ""),
                merchant_id=event.merchant_id,
                event_id=event.event_id,
                event_type=event.event_type,
                status="SKIPPED_CIRCUIT_OPEN",
                attempts=0,
                last_status_code=None,
                last_error="circuit open; endpoint skipped",
            )
        except Exception:  # noqa: BLE001 — triage evidence is best-effort
            pass

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
