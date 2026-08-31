"""Small, dependency-free base types and HTTP helpers for LLM adapters."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

Message = dict[str, Any]

_ADAPTER_REGISTRY: dict[str, type["LLMAdapter"]] = {}


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
    ) -> str:
        """Return the assistant's textual reply for the given conversation."""
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


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    """POST JSON and decode the JSON response using only the standard library."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:400]
        raise LLMError(f"Provider returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise LLMError(f"Provider request failed: {error.reason}") from error
