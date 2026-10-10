"""Online evaluation (target §30.7): compare production windows against
baselines across quality, tool, policy, fraud, conversion, cost, and
support signals. Baselines are explicit arguments — the console passes
the prior window, CI passes the last release numbers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta


@dataclass
class MetricDrift:
    metric: str
    baseline: float
    current: float
    delta_bps: int
    drifted: bool


@dataclass
class DriftReport:
    drifted: bool
    metrics: list = field(default_factory=list)


DEFAULT_DRIFT_THRESHOLDS_BPS = {
    "tool_error_rate": 2_000,  # ±20pp
    "policy_denial_rate": 2_000,
    "conversion_rate_bps": 1_500,  # ±15% relative handled below
    "cost_per_run_usd": 5_000,
    "fraud_rate": 500,
    "support_resolution_rate": 2_000,
}


def compare(
    baseline: dict[str, float],
    current: dict[str, float],
    thresholds_bps: dict[str, int] | None = None,
) -> DriftReport:
    """Compare two stat snapshots. Rates compare in basis points of
    absolute delta; conversion compares relatively (business drift)."""
    thresholds = {**DEFAULT_DRIFT_THRESHOLDS_BPS, **(thresholds_bps or {})}
    metrics: list[MetricDrift] = []
    for metric, base in baseline.items():
        value = current.get(metric, base)
        if metric == "conversion_rate_bps":
            delta_bps = (
                int(abs(value - base) * 10_000 / base) if base else 0
            )
        elif metric in ("cost_per_run_usd",):
            delta_bps = int(abs(value - base) * 10_000 / base) if base else (
                10_000 if value else 0
            )
        else:
            delta_bps = int(abs(value - base) * 10_000)
        limit = thresholds.get(metric, 2_000)
        metrics.append(
            MetricDrift(
                metric=metric,
                baseline=base,
                current=value,
                delta_bps=delta_bps,
                drifted=delta_bps > limit,
            )
        )
    return DriftReport(
        drifted=any(m.drifted for m in metrics), metrics=metrics
    )


def collect_production_stats(
    *,
    ledger,
    observability_repo,
    analytics_repo,
    merchant_id: str,
    days: int = 7,
    now: datetime | None = None,
) -> dict[str, float]:
    """Assemble the §30.7 signal set for one window (bounded queries)."""
    from sellable.contracts import utc_now

    moment = now or utc_now()
    since = moment - timedelta(days=max(days, 1))

    runs = observability_repo.list_runs(merchant_id, limit=100)
    windowed_runs = [
        r for r in runs
        if datetime.fromisoformat(r["started_at"]) >= since
    ]
    tool_calls = tool_failures = 0
    cost_usd = 0.0
    for run in windowed_runs:
        summary = observability_repo.run_summary(run["run_id"])
        tool_calls += summary.get("tool_calls", 0)
        tool_failures += summary.get("tool_failures", 0)
        cost_usd += summary.get("model_cost_usd", 0.0)

    policy_total = policy_denied = 0
    fraud_flags = 0
    for record in ledger.all_events(limit=500, merchant_id=merchant_id):
        occurred = record.timestamp
        if getattr(occurred, "tzinfo", None) is None:
            from datetime import timezone as _tz

            occurred = occurred.replace(tzinfo=_tz.utc)
        if occurred < since:
            continue
        if record.action == "policy.checked":
            policy_total += 1
            if (record.output_json or {}).get("verdict") == "DENY":
                policy_denied += 1
        if record.action == "risk.blocked":
            fraud_flags += 1

    overview = analytics_repo.overview(merchant_id, since=since)
    orders_paid = overview.get("orders_paid", 0)
    return {
        "tool_error_rate": (tool_failures / tool_calls) if tool_calls else 0.0,
        "policy_denial_rate": (policy_denied / policy_total) if policy_total else 0.0,
        "conversion_rate_bps": float(overview.get("conversion_rate_bps", 0)),
        "cost_per_run_usd": (cost_usd / len(windowed_runs)) if windowed_runs else 0.0,
        "fraud_rate": float(fraud_flags),
        "support_resolution_rate": 0.0,  # resolved/total needs case history scan (Phase 8)
    }
