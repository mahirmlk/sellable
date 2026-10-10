"""Model gateway (target §8.2): provider-agnostic model access with
telemetry, bounded retries, and fallback routing.

Every call records provider, model, latency, token estimates, cost
estimate, finish reason, error, and retry count — the model-level half of
§29 observability. Commerce code never imports this module; only agents do.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any


logger = logging.getLogger("sellable.agents.model_gateway")

Message = dict[str, Any]

#: Estimated USD per 1k input/output tokens by provider prefix. Estimates
#: only (billing truth stays with the provider invoice); missing entries
#: cost zero so unlisted providers never inflate figures.
_COST_PER_1K = {
    "openai/gpt-4o": (2.50, 10.00),
    "openai/gpt-4o-mini": (0.15, 0.60),
    "openai/o1": (15.00, 60.00),
    "anthropic/claude-opus": (15.00, 75.00),
    "anthropic/claude-sonnet": (3.00, 15.00),
    "anthropic/claude-haiku": (0.25, 1.25),
    "google/gemini-2.0-flash": (0.10, 0.40),
    "google/gemini-1.5-pro": (1.25, 5.00),
    "openrouter/": (1.00, 3.00),
    "opencode/": (0.00, 0.00),
    "opencode-go/": (0.00, 0.00),
    "mock/": (0.00, 0.00),
    "deterministic/": (0.00, 0.00),
}


def estimate_tokens(messages: list[Message]) -> int:
    """Character-based token estimate (~4 chars/token). Estimates are for
    cost/latency telemetry, never for billing or context enforcement."""
    chars = sum(len(str(m.get("content", ""))) + 16 for m in messages)
    return max(chars // 4, 1)


def estimate_cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    key = f"{provider}/{model}".lower()
    for prefix, (rate_in, rate_out) in _COST_PER_1K.items():
        if key.startswith(prefix):
            return round(input_tokens / 1000 * rate_in + output_tokens / 1000 * rate_out, 6)
    return 0.0


@dataclass
class ModelCallRecord:
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0
    latency_ms: int = 0
    finish_reason: str = ""
    error: str = ""
    retry_count: int = 0
    fallback_used: bool = False


@dataclass
class ModelGateway:
    """Wraps one primary adapter with telemetry, retry, and an optional
    fallback adapter. A recorder callable persists records when provided."""

    adapter: Any
    fallback: Any | None = None
    max_retries: int = 1
    calls: list[ModelCallRecord] = field(default_factory=list)
    recorder: Any | None = None  # record_model(record) — best-effort

    @property
    def provider(self) -> str:
        return getattr(self.adapter, "provider_name", "unknown")

    @property
    def model(self) -> str:
        return getattr(self.adapter, "model", "") or ""

    def complete(
        self, messages: list[Message], *, timeout: int = 10, purpose: str = ""
    ) -> tuple[str, ModelCallRecord]:
        """Complete with one retry on the primary, then the fallback.
        Raises the last error when everything fails (callers fall back to
        deterministic text — the commerce flow never breaks)."""
        input_tokens = estimate_tokens(messages)
        last_error = ""
        for attempt in range(self.max_retries + 1):
            started = time.perf_counter()
            try:
                reply = self.adapter.complete(messages, timeout=timeout)
                record = self._record(
                    self.provider, self.model, input_tokens, reply,
                    started, finish_reason="stop", retry_count=attempt,
                )
                return reply, record
            except Exception as error:  # noqa: BLE001 — provider failure is data
                last_error = str(error)[:300]
                logger.warning("model call failed (attempt %d): %s", attempt, last_error)
        if self.fallback is not None:
            started = time.perf_counter()
            try:
                reply = self.fallback.complete(messages, timeout=timeout)
                record = self._record(
                    getattr(self.fallback, "provider_name", "fallback"),
                    getattr(self.fallback, "model", ""),
                    input_tokens, reply, started,
                    finish_reason="stop", fallback_used=True, retry_count=self.max_retries + 1,
                )
                return reply, record
            except Exception as error:  # noqa: BLE001 — fallback failure is data
                last_error = str(error)[:300]
        record = ModelCallRecord(
            provider=self.provider, model=self.model, input_tokens=input_tokens,
            error=last_error, retry_count=self.max_retries + 1,
            finish_reason="error", fallback_used=self.fallback is not None,
        )
        self._store(record, purpose=purpose)
        raise RuntimeError(last_error or "model call failed")

    def _record(
        self, provider: str, model: str, input_tokens: int, reply: str,
        started: float, *, finish_reason: str, retry_count: int = 0,
        fallback_used: bool = False, purpose: str = "",
    ) -> ModelCallRecord:
        output_tokens = max(len(reply) // 4, 1)
        record = ModelCallRecord(
            provider=provider, model=model,
            input_tokens=input_tokens, output_tokens=output_tokens,
            estimated_cost_usd=estimate_cost_usd(provider, model, input_tokens, output_tokens),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=finish_reason, retry_count=retry_count,
            fallback_used=fallback_used,
        )
        self._store(record, purpose=purpose)
        return record

    def _store(self, record: ModelCallRecord, *, purpose: str = "") -> None:
        self.calls.append(record)
        if self.recorder is not None:
            try:
                self.recorder(record, purpose=purpose)
            except Exception:  # noqa: BLE001 — telemetry never breaks runs
                pass

    @property
    def total_cost_usd(self) -> float:
        return round(sum(c.estimated_cost_usd for c in self.calls), 6)
