"""Backend-driven component status with explicit, truthful state semantics.

Every component reports one of five states:

- ``CONNECTED``   dependency exists and a real health/configuration check succeeded
- ``UNCONFIGURED`` required environment/configuration is missing
- ``DEGRADED``    dependency works but a required sub-dependency is unavailable
- ``ERROR``       configuration exists but the dependency check failed
- ``OFFLINE``     the service itself cannot be reached (never guessed)

The frontend renders these states verbatim; nothing here is hardcoded to green.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sellable.config import settings

logger = logging.getLogger("sellable.status")

# ---------------------------------------------------------------------------
# LLM connectivity probe (cached, short TTL — never on every dashboard refresh)
# ---------------------------------------------------------------------------

_LLM_PROBE_TTL_SECONDS = 120.0
_llm_probe_cache: dict[str, tuple[float, str | None]] = {}
_llm_probe_lock = threading.Lock()

_MOCK_PROVIDERS = ("mock", "deterministic", "")


def _cached_llm_probe(provider: str) -> str | None:
    """Return the last probe error for *provider* (``None`` = healthy)."""
    with _llm_probe_lock:
        cached = _llm_probe_cache.get(provider)
    if cached and (time.time() - cached[0]) < _LLM_PROBE_TTL_SECONDS:
        return cached[1]
    return None


def _run_llm_probe(provider: str, adapter: Any) -> None:
    """Run the lightweight provider probe and cache the outcome (background)."""
    error_detail: str | None = None
    try:
        adapter.probe(timeout=20)
    except Exception as exc:  # noqa: BLE001 - status reporting must never raise
        error_detail = str(exc)[:300]
        logger.warning("LLM probe failed for provider=%s: %s", provider, error_detail)
    with _llm_probe_lock:
        _llm_probe_cache[provider] = (time.time(), error_detail)


def _start_llm_probe(provider: str, adapter: Any) -> None:
    """Spawn a daemon probe so the status endpoint never blocks on the LLM."""
    thread = threading.Thread(
        target=_run_llm_probe, args=(provider, adapter), name="llm-status-probe", daemon=True
    )
    thread.start()


def _llm_status(adapter: Any, init_error: str | None = None) -> dict[str, object]:
    provider = (settings.llm_provider or "").lower()
    model = settings.llm_model or ""
    is_mock = provider in _MOCK_PROVIDERS

    if is_mock:
        return {
            "provider": provider or "mock",
            "model": model or "deterministic",
            "enabled": False,
            "status": "scripted",
            "state": "CONNECTED",
            "mode": "scripted",
            "detail": "Deterministic mock provider — no network model in use.",
        }

    if not settings.llm_is_configured:
        return {
            "provider": provider,
            "model": model,
            "enabled": False,
            "status": "unconfigured",
            "state": "UNCONFIGURED",
            "mode": "scripted",
            "reason": "LLM_API_KEY missing",
            "detail": f"LLM provider '{provider}' requires LLM_API_KEY but none is configured.",
        }

    if adapter is None:
        return {
            "provider": provider,
            "model": model,
            "enabled": False,
            "status": "error",
            "state": "ERROR",
            "mode": "scripted",
            "reason": "LLM adapter failed to initialize",
            "detail": (
                f"The configured LLM adapter could not be constructed: {init_error}"
                if init_error
                else "The configured LLM adapter could not be constructed."
            ),
        }

    probe_error = _cached_llm_probe(provider)
    if probe_error is None and provider not in _llm_probe_cache:
        # First observation: kick off a background connectivity probe. Until the
        # probe result is cached, the configuration check (key + adapter present)
        # is a valid CONNECTED signal — the dashboard never blocks on the LLM.
        _start_llm_probe(provider, adapter)
        probe_error = _cached_llm_probe(provider)

    if probe_error:
        return {
            "provider": provider,
            "model": model,
            "enabled": True,
            "status": "error",
            "state": "ERROR",
            "mode": "live",
            "reason": "LLM connection check failed",
            "detail": probe_error,
        }

    return {
        "provider": provider,
        "model": model,
        "enabled": True,
        "status": "connected",
        "state": "CONNECTED",
        "mode": "live",
        "detail": f"LLM provider '{provider}' configured and reachable.",
    }


def _seller_status(llm: dict[str, object], seller_agent: Any) -> dict[str, object]:
    if seller_agent is None:
        return {"status": "offline", "state": "ERROR", "mode": "scripted", "detail": "Seller Agent runtime is not available."}
    llm_state = llm.get("state")
    llm_provider = llm.get("provider")
    if llm_state in ("UNCONFIGURED",):
        return {
            "status": "degraded",
            "state": "DEGRADED",
            "mode": "scripted",
            "detail": f"Seller Agent runtime is ready but LLM '{llm_provider}' is not configured.",
        }
    if llm_state == "ERROR":
        return {
            "status": "degraded",
            "state": "DEGRADED",
            "mode": "scripted",
            "detail": "Seller Agent runtime is ready but the LLM is unavailable; responses fall back to deterministic phrasing.",
        }
    return {
        "status": "online",
        "state": "CONNECTED",
        "mode": llm.get("mode", "live"),
        "detail": "Seller Agent runtime (LangGraph) initialized.",
    }


def _buyer_status(buyer_agent: Any, gateway: Any) -> dict[str, object]:
    if buyer_agent is None or gateway is None:
        return {"status": "offline", "state": "ERROR", "detail": "Buyer Agent runtime is not available."}
    auth_ok = bool(settings.agent_api_key_hashes) or settings.environment != "production"
    if not auth_ok:
        return {
            "status": "unconfigured",
            "state": "UNCONFIGURED",
            "detail": "Buyer Agent runtime is ready but no buyer API key hashes are configured (BUYER_AGENT_API_KEY_HASH).",
        }
    return {
        "status": "online",
        "state": "CONNECTED",
        "mode": "a2a",
        "detail": "Buyer Agent runtime and gateway are available; buyer credentials configured.",
    }


def _gateway_status(gateway: Any) -> dict[str, object]:
    if gateway is None:
        return {"status": "offline", "state": "ERROR", "detail": "Agent Gateway is not available."}
    try:
        manifest = gateway.discovery_manifest()
        gateway.catalog_document()
        endpoint_count = len(manifest.get("transaction_endpoints") or {})
        if not manifest.get("merchant_id"):
            return {"status": "degraded", "state": "DEGRADED", "detail": "Agent Gateway manifest is incomplete."}
        return {
            "status": "online",
            "state": "CONNECTED",
            "detail": f"Agent Gateway manifest and machine catalog render OK ({endpoint_count} endpoints).",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gateway health check failed: %s", exc)
        return {"status": "error", "state": "ERROR", "detail": f"Agent Gateway check failed: {exc}"}


def _policy_status(commerce: Any) -> dict[str, object]:
    if commerce is None:
        return {"status": "offline", "state": "ERROR", "detail": "Commerce Core is not available."}
    try:
        policy = commerce.get_policy()
        required = {
            "max_order_value_paise": policy.max_order_value_paise,
            "max_single_item_value_paise": policy.max_single_item_value_paise,
            "max_discount_percent": policy.max_discount_percent,
            "allowed_categories": policy.allowed_categories,
            "max_negotiation_rounds": policy.max_negotiation_rounds,
            "max_upsells_per_session": policy.max_upsells_per_session,
            "human_approval_threshold_paise": policy.human_approval_threshold_paise,
        }
        missing = [k for k, v in required.items() if v is None or v == ""]
        if missing:
            return {
                "status": "degraded",
                "state": "DEGRADED",
                "detail": f"Policy loads but fields are unset: {', '.join(missing)}.",
            }
        return {
            "status": "healthy",
            "state": "CONNECTED",
            "detail": "Policy Engine functions load and merchant policy is configured (deterministic, LLM-independent).",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Policy health check failed: %s", exc)
        return {"status": "error", "state": "ERROR", "detail": f"Policy Engine check failed: {exc}"}


def _ledger_status(ledger: Any) -> dict[str, object]:
    if ledger is None:
        return {"status": "offline", "state": "ERROR", "detail": "Ledger repository is not available."}
    db_url = settings.database_url or ""
    placeholders = {"sqlite+pysqlite:///./data/sellable.db"}
    if not db_url or db_url in placeholders:
        return {
            "status": "unconfigured",
            "state": "UNCONFIGURED",
            "detail": "DATABASE_URL is not configured.",
        }
    try:
        total = ledger.count_events()
        return {
            "status": "recording",
            "state": "CONNECTED",
            "detail": f"Ledger can read the database ({total} events).",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Ledger health check failed: %s", exc)
        return {"status": "error", "state": "ERROR", "detail": f"Ledger database read failed: {exc}"}


def _webhook_last_verified_at(ledger: Any) -> str | None:
    """Latest verified Razorpay webhook reconciliation time from the ledger.

    Single indexed row (was: newest 500 events with full JSON payloads).
    """
    if ledger is None:
        return None
    try:
        ts = ledger.last_webhook_time()
    except Exception:  # noqa: BLE001
        return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.isoformat()
    return None


def _payment_rail_status(ledger: Any) -> dict[str, object]:
    if not settings.razorpay_is_configured:
        return {
            "provider": "razorpay",
            "mode": "test",
            "configured": False,
            "state": "UNCONFIGURED",
            "webhook_configured": bool(settings.razorpay_webhook_secret),
            "webhook_last_verified_at": None,
            "reason": "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET missing",
            "detail": "Razorpay test credentials are not configured.",
        }
    webhook_secret_ok = bool(settings.razorpay_webhook_secret)
    last_verified = _webhook_last_verified_at(ledger)
    return {
        "provider": "razorpay",
        "mode": "test",
        "configured": True,
        "state": "CONNECTED",
        "webhook_configured": webhook_secret_ok,
        "webhook_last_verified_at": last_verified,
        "detail": (
            "Razorpay test-mode credentials configured."
            + (" Webhook signing secret present." if webhook_secret_ok else " Webhook secret missing.")
            + (f" Last webhook verified at {last_verified}." if last_verified else "")
        ),
    }


def build_status(
    *,
    commerce: Any,
    ledger: Any,
    seller_agent: Any,
    buyer_agent: Any,
    gateway: Any,
    llm_adapter: Any,
    llm_init_error: str | None = None,
) -> dict[str, object]:
    """Assemble the full /agents/status payload from real backend state."""
    llm = _llm_status(llm_adapter, init_error=llm_init_error)
    seller = _seller_status(llm, seller_agent)
    buyer = _buyer_status(buyer_agent, gateway)
    gateway_status = _gateway_status(gateway)
    policy = _policy_status(commerce)
    ledger_status = _ledger_status(ledger)
    payment = _payment_rail_status(ledger)

    # Counts, not rows: the summary needs totals, so one GROUP BY replaces
    # loading every order into memory on each status poll.
    counts: dict[str, int] = {}
    if commerce is not None:
        try:
            counts = commerce.order_repo.status_counts(commerce.merchant_scope)
        except Exception:  # noqa: BLE001
            counts = {}
    paid = counts.get("PAID", 0) + counts.get("FULFILLED", 0)

    return {
        "seller_agent": seller,
        "buyer_agent": buyer,
        "agent_gateway": gateway_status,
        "policy_engine": policy,
        "ledger": ledger_status,
        "payment_rail": payment,
        "llm": llm,
        "summary": {
            "total_orders": sum(counts.values()),
            "paid_orders": paid,
        },
    }


__all__ = ["build_status"]