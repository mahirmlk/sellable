"""OpenAI-compatible chat-completion adapters (OpenAI, OpenRouter, Google)."""

from __future__ import annotations

from typing import Any

from agents.llm.adapters.base import LLMAdapter, Message, post_json


class _OpenAICompatibleAdapter(LLMAdapter):
    base_url = ""
    default_headers: dict[str, str] = {}

    def complete(
        self,
        messages: list[Message],
        *,
        temperature: float | None = None,
        tools: list[dict[str, Any]] | None = None,
    ) -> str:
        self._require_key()
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
        }
        if tools:
            payload["tools"] = tools
        headers = {"Authorization": f"Bearer {self.config.api_key}", **self.default_headers}
        data = post_json(f"{self.base_url}/chat/completions", payload, headers)
        message = data["choices"][0]["message"]
        return message.get("content") or ""


class OpenAIAdapter(_OpenAICompatibleAdapter):
    provider_name = "openai"
    default_model = "gpt-4o-mini"
    base_url = "https://api.openai.com/v1"


class OpenRouterAdapter(_OpenAICompatibleAdapter):
    provider_name = "openrouter"
    default_model = "openrouter/auto"
    base_url = "https://openrouter.ai/api/v1"
    default_headers = {
        "HTTP-Referer": "https://sellable.shop",
        "X-Title": "SELLABLE",
    }


class GoogleAdapter(_OpenAICompatibleAdapter):
    provider_name = "google"
    default_model = "gemini-2.0-flash"
    base_url = "https://generativelanguage.googleapis.com/v1beta/openai"


class OpenCodeZenAdapter(_OpenAICompatibleAdapter):
    """OpenCode Zen OpenAI-compatible endpoint.

    Zen keys and models live behind ``opencode.ai/zen/v1`` (not OpenRouter).
    A browser-style User-Agent is required to pass the Cloudflare edge.
    """

    provider_name = "opencode"
    default_model = "deepseek-v4-flash"
    base_url = "https://opencode.ai/zen/v1"
    default_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
        "HTTP-Referer": "https://sellable.shop",
        "X-Title": "SELLABLE",
    }
