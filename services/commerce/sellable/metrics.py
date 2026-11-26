"""Agent + commerce metric rollups (target §29.2): reliability, quality,
commerce, economics, and safety series computed from persisted telemetry
(runs, ledger, analytics). Bounded queries, portable across SQLite and
Postgres — no external metrics backend required.
"""

from __future__ import annotations

from datetime import datetime, timedelta


def _aware(value: datetime) -> datetime:
    if getattr(value, "tzinfo", None) is None:
        from datetime import timezone as _tz

        return value.replace(tzinfo=_tz.utc)
    return value


def _in_window(iso_started: str, since: datetime) -> bool:
    try:
        return datetime.fromisoformat(iso_started) >= since
    except Exception:  # noqa: BLE001 — unparsable rows drop out of windows
        return False


def agent_metrics(
    *,
    observability_repo,
    ledger,
    merchant_id: str,
    days: int = 7,
    now: datetime | None = None,
) -> dict[str, object]:
    """Reliability, quality, economics, and safety rollups (§29.2)."""
    from sellable.contracts import utc_now

    moment = now or utc_now()
    since = moment - timedelta(days=max(days, 1))

    runs = [
        r for r in observability_repo.list_runs(merchant_id, limit=200)
        if _in_window(r["started_at"], since)
    ]
    summaries = [observability_repo.run_summary(r["run_id"]) for r in runs]
    tool_calls = sum(s.get("tool_calls", 0) for s in summaries)
    tool_failures = sum(s.get("tool_failures", 0) for s in summaries)
    model_calls = sum(s.get("model_calls", 0) for s in summaries)
    model_cost = round(sum(s.get("model_cost_usd", 0.0) for s in summaries), 6)
    error_runs = sum(1 for r in runs if r["status"] == "ERROR")
    blocked_runs = sum(1 for r in runs if r["status"] == "BLOCKED")

    guardrail_blocks = policy_denials = auth_denials = risk_blocks = 0
    escalations = support_cases = 0
    injection_blocks = data_access_denials = 0
    guardrail_block_breakdown: dict[str, int] = {}
    for record in ledger.all_events(limit=1000, merchant_id=merchant_id):
        if _aware(record.timestamp) < since:
            continue
        action = record.action
        if action in ("seller.guardrail_blocked", "cs.guardrail_blocked"):
            guardrail_blocks += 1
            for reason in (record.inputs_json or {}).get("blocks", []) or []:
                if not isinstance(reason, str):
                    continue
                guardrail_block_breakdown[reason] = (
                    guardrail_block_breakdown.get(reason, 0) + 1
                )
                if "PROMPT_INJECTION" in reason:
                    injection_blocks += 1
                if reason.startswith("SCOPE") or "TOOL_SCOPE" in reason:
                    data_access_denials += 1
        elif action == "support.case.escalated":
            escalations += 1
        elif action == "support.case_created":
            support_cases += 1
        elif action == "risk.blocked":
            risk_blocks += 1
        elif action == "authorization.denied":
            auth_denials += 1
        elif action == "policy.checked" and (record.output_json or {}).get("verdict") == "DENY":
            policy_denials += 1

    model_rows = []
    try:
        model_rows = observability_repo.list_model_calls(merchant_id, limit=500)
    except Exception:  # noqa: BLE001 — telemetry is additive
        pass
    retried_calls = sum(1 for r in model_rows if r.get("retry_count", 0) > 0)
    errored_calls = sum(1 for r in model_rows if r.get("finish_reason") == "error")

    denominators = max(len(runs), 1)
    return {
        "window_days": days,
        "runs": len(runs),
        "reliability": {
            "run_success_rate_bps": (len(runs) - error_runs) * 10_000 // denominators,
            "tool_failure_rate_bps": tool_failures * 10_000 // max(tool_calls, 1),
            "blocked_run_rate_bps": blocked_runs * 10_000 // denominators,
            "escalation_rate_bps": escalations * 10_000 // denominators,
            "model_retry_rate_bps": retried_calls * 10_000 // max(len(model_rows), 1),
            "model_error_rate_bps": errored_calls * 10_000 // max(len(model_rows), 1),
        },
        "quality": {
            "policy_denials": policy_denials,
            "authorization_denials": auth_denials,
            "escalations": escalations,
            "support_cases": support_cases,
        },
        "economics": {
            "model_calls": model_calls,
            "model_cost_usd": model_cost,
            "cost_per_run_usd": round(model_cost / denominators, 6),
        },
        "safety": {
            "guardrail_blocks": guardrail_blocks,
            "guardrail_block_breakdown": guardrail_block_breakdown,
            "prompt_injection_blocks": injection_blocks,
            "data_access_denials": data_access_denials,
            "risk_blocks": risk_blocks,
            "auth_denials": auth_denials,
        },
    }


def commerce_metrics(
    *,
    analytics_repo,
    promotion_repo=None,
    merchant_id: str,
    days: int = 30,
    now: datetime | None = None,
) -> dict[str, object]:
    """Commerce rollups (§29.2 commerce + §34.2 core set)."""
    from sellable.contracts import utc_now

    moment = now or utc_now()
    overview = analytics_repo.overview(
        merchant_id, since=moment - timedelta(days=max(days, 1))
    )
    series = analytics_repo.timeseries(merchant_id, days=days, now=moment)
    promo_discount = 0
    promo_redemptions = 0
    if promotion_repo is not None:
        try:
            usage = promotion_repo.usage(merchant_id)
            promo_redemptions = sum(u["count"] for u in usage.values())
            promo_discount = sum(u["discount_paise"] for u in usage.values())
        except Exception:  # noqa: BLE001 — promos are additive to metrics
            pass
    gmv = overview.get("gmv_paise", 0)
    return {
        **overview,
        "promotion_redemptions": promo_redemptions,
        "promotion_discount_paise": promo_discount,
        "discount_leakage_bps": (promo_discount * 10_000 // gmv) if gmv else 0,
        "daily": series,
    }
