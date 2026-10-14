"""OpenAI Agentic Commerce Protocol scaffold (UPDATE.md §9.4).

Disabled by default (``SELLABLE_ACP_ENABLED``). When enabled, exposes an
ACP-shaped view of the canonical AUTHORIZED checkout — session state,
authoritative totals, and idempotency guidance — mapped from SELLABLE's own
checkout machine, never a parallel implementation.

Explicit non-goals: this scaffold makes no conformance or certification
claims, and implementing it does not grant partner onboarding, approval,
or placement in ChatGPT / Instant Checkout — those are separate external
dependencies owned by the partner program.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any


ACP_VERSION = "acp-0"
ACP_SPEC_REFERENCE = "https://developers.openai.com/commerce"
ACP_DISABLED_CODE = "acp_disabled"

_SIGNATURE_TOLERANCE_SECONDS = 300


class AcpError(ValueError):
    """The ACP scaffold refused the request."""


class AcpAuthError(AcpError):
    """Signed-request authentication failed."""


def build_checkout_session(checkout: Any, *, currency: str = "INR") -> dict[str, Any]:
    """Map a canonical AUTHORIZED checkout to ACP session state.

    Only AUTHORIZED checkouts are exposable: anything earlier has no
    settled totals, anything later is already transacting. The mapping is
    read-only — it never mutates checkout, order, or payment state.
    """
    from sellable.contracts import CheckoutStatus

    status = getattr(checkout, "status", None)
    if status != CheckoutStatus.AUTHORIZED:
        raise AcpError(
            f"Checkout {getattr(checkout, 'checkout_id', '?')} is {status}, "
            "not AUTHORIZED; ACP sessions require settled totals"
        )
    lines = [
        {
            "sku": line.sku,
            "quantity": line.quantity,
            "unit_price_paise": line.unit_price_paise,
        }
        for line in (getattr(checkout, "lines", None) or [])
    ]
    return {
        "session_id": checkout.checkout_id,
        "merchant_id": checkout.merchant_id,
        "status": "authorized",
        "currency": currency,
        "items": lines,
        "totals": {
            "subtotal_paise": checkout.subtotal_paise,
            "discount_total_paise": checkout.discount_total_paise,
            "tax_total_paise": checkout.tax_total_paise,
            "shipping_total_paise": checkout.shipping_total_paise,
            "grand_total_paise": checkout.grand_total_paise,
        },
        "price_hash": getattr(checkout, "price_hash", None),
        "authorization_id": getattr(checkout, "authorization_id", None),
        "expires_at": checkout.expires_at.isoformat()
        if getattr(checkout, "expires_at", None) is not None
        else None,
        "idempotency": "Repeat this session id on retry; order creation stays idempotent on its own key.",
    }


def verify_signed_request(
    *,
    body: bytes,
    timestamp: str | None,
    nonce: str | None,
    signature: str | None,
    secret: str | None,
    agent_id: str | None,
    method: str,
    path: str,
    now: float | None = None,
) -> str:
    """Verify an ACP-style HMAC-SHA256 signed request.

    Canonical string: ``timestamp.nonce.agent_id.method.path.body_sha256``.
    Returns the authenticated agent id. Raises AcpAuthError on any failure
    (missing fields, stale timestamp, unknown agent, bad signature) using
    constant-time comparison.
    """
    if not secret:
        raise AcpAuthError("ACP signing secret is not configured")
    if not agent_id:
        raise AcpAuthError("ACP agent id is missing")
    if not timestamp or not nonce or not signature:
        raise AcpAuthError("ACP signature headers are missing")
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        raise AcpAuthError("ACP timestamp is invalid") from None
    if abs((now if now is not None else time.time()) - sent_at) > _SIGNATURE_TOLERANCE_SECONDS:
        raise AcpAuthError("ACP signature timestamp outside tolerance")
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = ".".join(
        [timestamp, nonce, agent_id, method.upper(), path, body_hash]
    )
    expected = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise AcpAuthError("ACP signature is invalid")
    return agent_id
