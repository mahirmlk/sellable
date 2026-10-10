"""Run recording (target §8.3, §29.1): one recorder per agent execution,
stamping versions, persisting run/model/tool telemetry best-effort.
"""

from __future__ import annotations

import logging
import time
from uuid import uuid4


logger = logging.getLogger("sellable.agents.recorder")


def new_run_id(prefix: str = "run") -> str:
    return f"{prefix}_{uuid4().hex}"


def new_call_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class AgentRunRecorder:
    """Best-effort telemetry sink. Every method swallows persistence
    failures — observability must never break a commerce run."""

    def __init__(
        self,
        repository=None,
        *,
        merchant_id: str = "",
        agent_id: str = "",
        run_id: str | None = None,
    ) -> None:
        self._repo = repository
        self.merchant_id = merchant_id
        self.agent_id = agent_id
        self.run_id = run_id or new_run_id()

    def open_run(self, *, trace_id: str, versions=None, session_id=None,
                 customer_id=None, model_version: str = "") -> str:
        if self._repo is None:
            return self.run_id
        try:
            self._repo.open_run(
                run_id=self.run_id,
                merchant_id=self.merchant_id,
                trace_id=trace_id,
                agent_id=self.agent_id,
                agent_version=getattr(versions, "agent_version", ""),
                prompt_version=getattr(versions, "prompt_version", ""),
                policy_bundle_version=getattr(versions, "policy_bundle_version", ""),
                tool_registry_version=getattr(versions, "tool_registry_version", ""),
                model_version=model_version
                or getattr(versions, "model_version", ""),
                session_id=session_id,
                customer_id=customer_id,
            )
        except Exception as exc:  # noqa: BLE001 — telemetry is additive
            logger.warning("run open failed: %s", exc)
        return self.run_id

    def close_run(self, *, status: str, outcome: str | None = None,
                  error: str | None = None) -> None:
        if self._repo is None:
            return
        try:
            self._repo.close_run(
                self.run_id, status=status, outcome=outcome, error=error
            )
        except Exception as exc:  # noqa: BLE001 — telemetry is additive
            logger.warning("run close failed: %s", exc)

    def record_model(self, record, *, purpose: str = "") -> None:
        """ModelGateway recorder hook (record, purpose)."""
        if self._repo is None:
            return
        try:
            self._repo.record_model_call(
                call_id=new_call_id("mcall"),
                run_id=self.run_id,
                merchant_id=self.merchant_id,
                provider=record.provider,
                model=record.model,
                input_tokens=record.input_tokens,
                output_tokens=record.output_tokens,
                estimated_cost_usd=record.estimated_cost_usd,
                latency_ms=record.latency_ms,
                finish_reason=record.finish_reason,
                error=record.error or None,
                retry_count=record.retry_count,
                fallback_used=record.fallback_used,
            )
        except Exception as exc:  # noqa: BLE001 — telemetry is additive
            logger.warning("model record failed: %s", exc)

    def tool(self, name: str, *, status: str = "OK", latency_ms: int = 0,
             error: str | None = None, version: str = "1",
             policy_decision_id: str | None = None,
             risk_decision_id: str | None = None,
             authorization_id: str | None = None) -> None:
        if self._repo is None:
            return
        try:
            self._repo.record_tool_call(
                tool_call_id=new_call_id("tcall"),
                run_id=self.run_id,
                merchant_id=self.merchant_id,
                tool_name=name,
                tool_version=version,
                status=status,
                latency_ms=latency_ms,
                error=error,
                policy_decision_id=policy_decision_id,
                risk_decision_id=risk_decision_id,
                authorization_id=authorization_id,
            )
        except Exception as exc:  # noqa: BLE001 — telemetry is additive
            logger.warning("tool record failed: %s", exc)

    def timed_tool(self, name: str, **kwargs):
        """Context manager timing a tool call and recording it."""
        return _TimedTool(self, name, kwargs)


class _TimedTool:
    def __init__(self, recorder: AgentRunRecorder, name: str, kwargs: dict) -> None:
        self._recorder = recorder
        self._name = name
        self._kwargs = kwargs
        self._started = 0.0

    def __enter__(self) -> "_TimedTool":
        self._started = time.perf_counter()
        return self

    def fail(self, error: str) -> None:
        self._kwargs["status"] = "ERROR"
        self._kwargs["error"] = error[:300]

    def __exit__(self, exc_type, exc, tb) -> bool:
        latency_ms = int((time.perf_counter() - self._started) * 1000)
        if exc_type is not None and self._kwargs.get("status") == "OK":
            self._kwargs["status"] = "ERROR"
            self._kwargs["error"] = str(exc)[:300]
        self._recorder.tool(self._name, latency_ms=latency_ms, **self._kwargs)
        return False
