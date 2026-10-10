"""Data minimization helpers (target §37.4): agents receive minimum
context, and free-text evidence is scrubbed of direct identifiers before
it lands in the ledger. Deterministic regex redaction — no model, no
network, no guessing.
"""

from __future__ import annotations

import re


_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    # Card runs before phone: a spaced 16-digit run is a card, not a phone.
    # The trailing digit is mandatory so no separator is swallowed.
    ("card", re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")),
    ("phone", re.compile(r"(?<!\d)(?:\+?\d[\d\s-]{7,15}\d)(?!\d)")),
    ("upi", re.compile(r"[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}")),
)

_REDACTIONS = {
    "email": "[redacted-email]",
    "phone": "[redacted-phone]",
    "card": "[redacted-card]",
    "upi": "[redacted-upi]",
}


def redact_pii(text: str | None) -> str | None:
    """Replace direct identifiers in free text. Returns the input
    unchanged when there is nothing to scrub (None stays None)."""
    if not text:
        return text
    scrubbed = text
    for kind, pattern in _PATTERNS:
        scrubbed = pattern.sub(_REDACTIONS[kind], scrubbed)
    return scrubbed


def scrub_mapping(data: dict[str, object], *, fields: tuple[str, ...] = ("reason", "summary", "message", "note")) -> dict[str, object]:
    """Redact free-text values in a shallow evidence mapping."""
    scrubbed = dict(data)
    for field_name in fields:
        value = scrubbed.get(field_name)
        if isinstance(value, str):
            scrubbed[field_name] = redact_pii(value)
    return scrubbed
