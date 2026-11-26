"""Readiness guardrails for the production expiry worker."""

from __future__ import annotations

from datetime import timedelta

import pytest

from sellable.config import Settings
from sellable.contracts import utc_now
from sellable import main


class _AliveThread:
    def is_alive(self) -> bool:
        return True


def _configure(monkeypatch, *, enabled=True, last_success=None, last_error=None, thread=None):
    monkeypatch.setattr(
        main,
        "settings",
        Settings(
            environment="production",
            maintenance_worker=True if enabled else False,
            maintenance_interval_seconds=60,
        ),
    )
    monkeypatch.setattr(main, "_MAINTENANCE_THREAD", thread)
    monkeypatch.setattr(main, "_MAINTENANCE_LAST_SUCCESS", last_success)
    monkeypatch.setattr(main, "_MAINTENANCE_LAST_ERROR", last_error)


def test_production_readiness_requires_enabled_live_maintenance_worker(monkeypatch) -> None:
    _configure(monkeypatch, enabled=False)
    assert main._maintenance_readiness() == "unavailable"

    _configure(monkeypatch, thread=None)
    assert main._maintenance_readiness() == "unavailable"


def test_production_readiness_reports_initializing_and_failed_sweeps(monkeypatch) -> None:
    _configure(monkeypatch, thread=_AliveThread())
    assert main._maintenance_readiness() == "initializing"

    _configure(
        monkeypatch,
        thread=_AliveThread(),
        last_success=utc_now(),
        last_error="sweep_failed",
    )
    assert main._maintenance_readiness() == "degraded"


def test_production_readiness_requires_recent_successful_sweep(monkeypatch) -> None:
    _configure(
        monkeypatch,
        thread=_AliveThread(),
        last_success=utc_now() - timedelta(seconds=30),
    )
    assert main._maintenance_readiness() == "ok"

    _configure(
        monkeypatch,
        thread=_AliveThread(),
        last_success=utc_now() - timedelta(minutes=10),
    )
    assert main._maintenance_readiness() == "stale"


def test_development_can_explicitly_disable_maintenance(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        Settings(environment="test", maintenance_worker=False),
    )
    assert main._maintenance_readiness() == "ok"

def test_production_startup_rejects_disabled_maintenance_worker(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        Settings(environment="production", maintenance_worker=False),
    )
    with pytest.raises(RuntimeError, match="requires the maintenance worker"):
        main._assert_production_configuration()


def test_development_startup_may_disable_maintenance_worker(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        Settings(environment="test", maintenance_worker=False),
    )
    main._assert_production_configuration()
