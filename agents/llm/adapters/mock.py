"""Deterministic mock adapter for local development and offline tests."""

from __future__ import annotations

from typing import Any

from agents.llm.adapters.base import LLMAdapter, Message


class MockAdapter(LLMAdapter):
    """Returns a deterministic reply without touching the network."""

    provider_name = "mock"
    default_model = "mock"

    def complete(
        self,
        messages: list[Message],
        *,
        temperature: float | None = None,
        tools: list[dict[str, Any]] | None = None,
        timeout: int = 90,
    ) -> str:
        last_user = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), ""
        )
        return f"[mock:{self.model}] Acknowledged: {last_user}"

    def probe(self, *, timeout: int = 10) -> None:
        """Deterministic provider is always available; nothing to check."""
        return None
