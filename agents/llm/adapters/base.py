"""Small, dependency-free base types and HTTP helpers for LLM adapters."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

Message = dict[str, Any]

_ADAPTER_REGISTRY: dict[str, type["LLMAdapter"]] = {}


def reply_skus_known(reply: str, known_skus: set[str]) -> bool:
    """Fail-closed check that an LLM reply names no unknown SKU-like tokens.

    Tokens shaped like catalog SKUs (uppercase alnum groups joined by dashes,
    e.g. ``AUDIO-CASE-01``) must all belong to ``known_skus``. Anything else
    — a hallucinated product code in buyer-facing text — rejects the reply so
    the caller falls back to its deterministic message. Fail-closed by design:
    a false positive only costs the LLM phrasing, never correctness.
    """
    import re

    for token in re.findall(r"\b(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)+\b", reply):
        if token not in known_skus:
            return False
    return True


def reply_amounts_known(reply: str, allowed_paise: set[int]) -> bool:
    """Fail-closed check that an LLM reply invents no money amounts.

    Every money-shaped token — ``₹24,999``, ``Rs. 24999.00``, ``INR 4,650.50``,
    or ``499900 paise`` — is normalized to paise and must exactly match one of
    the authoritative amounts supplied by the commerce core. A model that
    converts, rounds, reformats, or simply hallucinates a figure (the classic
    paise-vs-rupees slip) produces a value outside the set and the whole reply
    is rejected so the caller can fall back to its deterministic message.
    Replies that name no money amount pass trivially. Fail-closed by design:
    a false positive only costs the LLM phrasing, never correctness.
    """
    import re

    matches = re.findall(
        r"(?:(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*)\s*paise)",
        reply,
        flags=re.IGNORECASE,
    )
    for rupees, paise in matches:
        if paise:
            amount = int(paise.replace(",", ""))
        else:
            amount = round(float(rupees.replace(",", "")) * 100)
        if amount not in allowed_paise:
            return False
    return True


class LLMError(RuntimeError):
    """Raised when a provider cannot satisfy a completion request."""


class LLMAdapter:
    """Common interface shared by every provider adapter."""

    provider_name = "base"
    default_model = ""

    def __init__(self, config: "LLMConfig") -> None:
        self.config = config

    @property
    def model(self) -> str:
        return self.config.model or self.default_model

    def complete(
        self,
        messages: list[Message],
        *,
        temperature: float | None = None,
        tools: list[dict[str, Any]] | None = None,
        timeout: int = 90,
    ) -> str:
        """Return the assistant's textual reply for the given conversation."""
        raise NotImplementedError

    def probe(self, *, timeout: int = 10) -> None:
        """Perform a lightweight connectivity/config check. Raise on failure.

        Used by the backend status service to report an honest LLM state. The
        result is cached with a short TTL by the caller; this is never called on
        every dashboard refresh.
        """
        raise NotImplementedError

    def _require_key(self) -> None:
        if not self.config.api_key:
            raise LLMError(
                f"The '{self.config.provider}' provider requires an API key, but none is configured."
            )

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if cls.provider_name:
            _ADAPTER_REGISTRY[cls.provider_name] = cls


def post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    *,
    timeout: int = 90,
) -> dict[str, Any]:
    """POST JSON and decode the JSON response using only the standard library."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:400]
        raise LLMError(f"Provider returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise LLMError(f"Provider request failed: {error.reason}") from error
    except TimeoutError as error:
        raise LLMError("Provider request timed out") from error
