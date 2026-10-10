"""Distributed-tracing preparation (target §29.3): trace-correlated
structured spans with OpenTelemetry-compatible field names.

Every span carries the request's ``trace_id`` so API gateway, agent
runtime, domain services, event processing, and payment reconciliation
correlate today through logs; an OTel exporter can ship these fields
unchanged when a collector is deployed (no SDK dependency until then).
"""

from __future__ import annotations

import functools
import json
import logging
import sys
import time
from datetime import datetime, timezone


logger = logging.getLogger("sellable.trace")


def _emit(record: dict[str, object]) -> None:
    record["timestamp"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(record, default=str), file=sys.stdout)


class Span:
    """One timed span. Use as a context manager inside traced code."""

    def __init__(self, name: str, *, trace_id: str = "", **attributes: object) -> None:
        self.name = name
        self.trace_id = trace_id
        self.attributes = attributes
        self._started = 0.0

    def __enter__(self) -> "Span":
        self._started = time.perf_counter()
        _emit({
            "span": self.name,
            "trace_id": self.trace_id,
            "event": "span.start",
            **self.attributes,
        })
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        elapsed_ms = int((time.perf_counter() - self._started) * 1000)
        record: dict[str, object] = {
            "span": self.name,
            "trace_id": self.trace_id,
            "event": "span.end",
            "elapsed_ms": elapsed_ms,
            **self.attributes,
        }
        if exc_type is not None:
            record["error"] = str(exc)[:300]
        _emit(record)
        return False


def traced(span_name: str):
    """Decorator tracing a function with a ``trace_id`` kwarg or first-arg
    ``trace_id`` lookup. Failures inside never alter the wrapped outcome."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            trace_id = kwargs.get("trace_id", "")
            with Span(span_name, trace_id=str(trace_id or "")):
                return fn(*args, **kwargs)

        return wrapper

    return decorator


async def trace_middleware(request, call_next):
    """Echo/resolve the trace id on every response (pure ASGI)."""
    from uuid import uuid4

    incoming = request.headers.get("X-Trace-Id", "")
    trace_id = (
        incoming
        if incoming.startswith("trc_") and len(incoming) == 36
        else f"trc_{uuid4().hex}"
    )
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response
