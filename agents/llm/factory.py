"""Model factory: choose an LLM adapter from configuration.

Usage throughout the agent layer is simply::

    from agents.llm import get_llm
    llm = get_llm()
    reply = llm.complete([{"role": "user", "content": "..."}])

The policy engine, commerce core, consent, orders, payments, and ledger never
import this module; only the agent/orchestration layer does.
"""

from __future__ import annotations

from agents.llm.adapters.anthropic import AnthropicAdapter
from agents.llm.adapters.base import LLMAdapter
from agents.llm.adapters.mock import MockAdapter
from agents.llm.config import LLMConfig
from agents.llm.adapters.openai import (
    GoogleAdapter,
    OpenAIAdapter,
    OpenCodeGoAdapter,
    OpenCodeZenAdapter,
    OpenRouterAdapter,
)
from sellable.config import settings

_ADAPTER_BY_PROVIDER: dict[str, type[LLMAdapter]] = {
    "mock": MockAdapter,
    "deterministic": MockAdapter,
    "openai": OpenAIAdapter,
    "openrouter": OpenRouterAdapter,
    "opencode": OpenCodeZenAdapter,
    "opencode-go": OpenCodeGoAdapter,
    "anthropic": AnthropicAdapter,
    "google": GoogleAdapter,
    "gemini": GoogleAdapter,
}


def get_llm(config: LLMConfig | None = None) -> LLMAdapter:
    """Return the configured LLM adapter.

    Raises ``ValueError`` for an unknown provider. Credentials are validated
    lazily, when the adapter actually performs a completion.
    """
    resolved = config or LLMConfig(
        provider=settings.llm_provider.lower(),
        model=settings.llm_model or "",
        api_key=settings.llm_api_key,
        temperature=settings.llm_temperature,
    )
    adapter_cls = _ADAPTER_BY_PROVIDER.get(resolved.provider)
    if adapter_cls is None:
        known = ", ".join(sorted(_ADAPTER_BY_PROVIDER))
        raise ValueError(f"Unknown LLM provider '{resolved.provider}'. Choose one of: {known}.")
    return adapter_cls(resolved)


__all__ = ["get_llm"]
