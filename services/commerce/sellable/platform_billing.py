"""Platform billing meter (target §47): commercial control plane as a
read model over existing tables — no new money paths. Usage is computed,
never separately written, so metering can never diverge from the
transactional truth. Plan assignment persists when the admin surface
grows one; until then every merchant meters on FREE with env override.
"""

from __future__ import annotations

from datetime import datetime, timedelta


PLANS: dict[str, dict[str, int]] = {
    "FREE": {
        "orders_per_month": 100,
        "agent_runs_per_month": 1_000,
        "events_per_month": 50_000,
    },
    "GROWTH": {
        "orders_per_month": 5_000,
        "agent_runs_per_month": 50_000,
        "events_per_month": 2_000_000,
    },
    "SCALE": {
        "orders_per_month": 10**9,
        "agent_runs_per_month": 10**9,
        "events_per_month": 10**9,
    },
}


def resolve_plan(merchant_id: str, *, override: str | None = None) -> str:
    """Plan name for a merchant. Per-merchant persistence arrives with the
    billing UI; until then the deploy default applies to everyone."""
    del merchant_id
    plan = (override or "FREE").upper()
    return plan if plan in PLANS else "FREE"


def summarize_usage(
    *,
    order_repo,
    observability_repo,
    ledger,
    merchant_id: str,
    plan: str = "FREE",
    days: int = 30,
    now: datetime | None = None,
) -> dict[str, object]:
    """Metered usage vs quota for one merchant and window."""
    from sellable.contracts import utc_now

    moment = now or utc_now()
    since = moment - timedelta(days=max(days, 1))
    quotas = PLANS.get(plan, PLANS["FREE"])

    orders = [
        o for o in order_repo.all(merchant_id, limit=5000)
        if _aware(o.created_at) >= since
    ]
    runs = [
        r for r in observability_repo.list_runs(merchant_id, limit=500)
        if datetime.fromisoformat(r["started_at"]) >= since
    ]
    events = (
        ledger.count_events(merchant_id)
        if hasattr(ledger, "count_events")
        else 0
    )
    usage = {
        "orders": len(orders),
        "agent_runs": len(runs),
        "ledger_events": events,
    }
    quotas_used = {
        "orders_per_month": quotas["orders_per_month"],
        "agent_runs_per_month": quotas["agent_runs_per_month"],
        "events_per_month": quotas["events_per_month"],
    }
    over_quota = (
        usage["orders"] > quotas_used["orders_per_month"]
        or usage["agent_runs"] > quotas_used["agent_runs_per_month"]
    )
    return {
        "merchant_id": merchant_id,
        "plan": plan,
        "window_days": days,
        "usage": usage,
        "quotas": quotas_used,
        "over_quota": over_quota,
    }


def _aware(value: datetime) -> datetime:
    if getattr(value, "tzinfo", None) is None:
        from datetime import timezone as _tz

        return value.replace(tzinfo=_tz.utc)
    return value
