"""LLM configuration loaded from the runtime settings."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str | None
    temperature: float = 0.0
