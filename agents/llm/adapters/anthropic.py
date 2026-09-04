"""Anthropic Messages API adapter."""

from __future__ import annotations

from typing import Any

from agents.llm.adapters.base import LLMAdapter, Message, post_json


class AnthropicAdapter(LLMAdapter):
    provider_name = "anthropic"
    default_model = "claude-3-5-haiku-latest"
    base_url = "https://api.anthropic.com/v1"

    def complete(
        self,
        messages: list[Message],
        *,
        temperature: float | None = None,
        tools: list[dict[str, Any]] | None = None,
        timeout: int = 90,
    ) -> str:
        self._require_key()
        system = "\n".join(
            message["content"] for message in messages if message.get("role") == "system"
        ).strip()
        turns = [message for message in messages if message.get("role") != "system"]
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": turns,
            "temperature": temperature if temperature is not None else self.config.temperature,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = tools
        headers = {
            "x-api-key": str(self.config.api_key),
            "anthropic-version": "2023-06-01",
        }
        data = post_json(f"{self.base_url}/messages", payload, headers, timeout=timeout)
        blocks = data.get("content", [])
        return "".join(block.get("text", "") for block in blocks if block.get("type") == "text")
