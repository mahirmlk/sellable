"""Provider-failure isolation (§46.2): a minimal thread-safe circuit breaker.

External dependencies must fail safely and quickly: once a provider shows
sustained failures, further calls fail fast (CircuitOpenError) instead of
each caller paying the full timeout. After a cooldown the breaker lets one
probe through (half-open); success closes it, failure reopens it.

The breaker never changes outcomes — it only bounds how long callers wait
for a dependency that is already down. Business classification of provider
errors stays with the adapters.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import StrEnum


class CircuitOpenError(RuntimeError):
    """The breaker is open: the dependency is known-bad, fail fast."""

    def __init__(self, name: str, cooldown_remaining_s: float) -> None:
        super().__init__(
            f"circuit '{name}' is open; retry in {cooldown_remaining_s:.1f}s"
        )
        self.name = name
        self.cooldown_remaining_s = cooldown_remaining_s


class BreakerState(StrEnum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


@dataclass
class CircuitBreaker:
    """Failure-count breaker with a time-boxed open state.

    ``failure_threshold`` consecutive failures open the circuit;
    ``cooldown_seconds`` later, one call may probe (half-open). A probe
    success closes it; a probe failure reopens it. All state transitions
    are thread-safe; per-process scope is intentional (single-worker
    deployment invariant).
    """

    name: str
    failure_threshold: int = 5
    cooldown_seconds: float = 30.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _consecutive_failures: int = 0
    _opened_at: float = 0.0
    _state: BreakerState = BreakerState.CLOSED

    @property
    def state(self) -> BreakerState:
        with self._lock:
            return self._effective_state(time.monotonic())

    def _effective_state(self, now: float) -> BreakerState:
        if self._state is BreakerState.OPEN:
            if now - self._opened_at >= self.cooldown_seconds:
                return BreakerState.HALF_OPEN
            return BreakerState.OPEN
        return self._state

    def before_call(self) -> None:
        """Raise CircuitOpenError when the dependency is known-bad."""
        now = time.monotonic()
        with self._lock:
            state = self._effective_state(now)
            if state is BreakerState.OPEN:
                raise CircuitOpenError(
                    self.name, self.cooldown_seconds - (now - self._opened_at)
                )
            if state is BreakerState.HALF_OPEN:
                # One probe at a time: while a probe is in flight, treat the
                # circuit as open for everyone else.
                if self._consecutive_failures < 0:  # probe-in-flight marker
                    raise CircuitOpenError(self.name, self.cooldown_seconds)
                self._consecutive_failures = -1
                return
            return

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._state = BreakerState.CLOSED

    def record_failure(self) -> None:
        with self._lock:
            if self._consecutive_failures < 0:
                # The probe failed: reopen with a fresh cooldown.
                self._consecutive_failures = self.failure_threshold
                self._opened_at = time.monotonic()
                self._state = BreakerState.OPEN
                return
            self._consecutive_failures += 1
            if (
                self._state is BreakerState.CLOSED
                and self._consecutive_failures >= self.failure_threshold
            ):
                self._state = BreakerState.OPEN
                self._opened_at = time.monotonic()

    def call(self, fn, /, *args, **kwargs):
        """Run ``fn`` under the breaker. Any exception counts as a provider
        failure; success resets the count."""
        self.before_call()
        try:
            result = fn(*args, **kwargs)
        except Exception:
            self.record_failure()
            raise
        self.record_success()
        return result
