"""LLM provider factory tests: adapter wiring, Go endpoint, honest failures."""

from __future__ import annotations

import pytest

from agents.llm.adapters.base import LLMError
from agents.llm.adapters.openai import OpenCodeGoAdapter, OpenCodeZenAdapter
from agents.llm.config import LLMConfig
from agents.llm.factory import get_llm


def test_opencode_go_provider_resolves_to_go_adapter() -> None:
    llm = get_llm(
        LLMConfig(provider="opencode-go", model="deepseek-v4-flash", api_key="test-key")
    )
    assert isinstance(llm, OpenCodeGoAdapter)
    assert llm.model == "deepseek-v4-flash"
    assert llm.base_url == "https://opencode.ai/zen/go/v1"


def test_opencode_provider_still_resolves_to_zen_adapter() -> None:
    llm = get_llm(
        LLMConfig(provider="opencode", model="deepseek-v4-flash", api_key="test-key")
    )
    assert isinstance(llm, OpenCodeZenAdapter)
    assert llm.base_url == "https://opencode.ai/zen/v1"


def test_missing_key_fails_honestly_without_mock_fallback() -> None:
    llm = get_llm(
        LLMConfig(provider="opencode-go", model="deepseek-v4-flash", api_key=None)
    )
    with pytest.raises(LLMError) as exc:
        llm.complete([{"role": "user", "content": "ping"}])
    assert "requires an API key" in str(exc.value)
