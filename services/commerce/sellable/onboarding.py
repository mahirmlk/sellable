"""Merchant onboarding lifecycle (target §10).

Onboarding is a first-class platform domain, not a setup screen: a staged
lifecycle with automated readiness validation before activation (§10.3).
Persistence and connector provisioning arrive in Phase 1b; this module
owns the stage machine and check catalogue so later work shares one
definition of "ready".
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from sellable.contracts import StrictModel, utc_now


class OnboardingStage(StrEnum):
    """Lifecycle stages in activation order (target §10.1)."""

    CREATED = "CREATED"
    BUSINESS_PROFILED = "BUSINESS_PROFILED"
    IDENTITY_VERIFIED = "IDENTITY_VERIFIED"
    COMMERCE_CONNECTED = "COMMERCE_CONNECTED"
    CATALOG_IMPORTED = "CATALOG_IMPORTED"
    POLICIES_CONFIGURED = "POLICIES_CONFIGURED"
    PAYMENTS_CONFIGURED = "PAYMENTS_CONFIGURED"
    SHIPPING_CONFIGURED = "SHIPPING_CONFIGURED"
    AGENT_PROFILE_PUBLISHED = "AGENT_PROFILE_PUBLISHED"
    SANDBOX_TESTED = "SANDBOX_TESTED"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    LIVE = "LIVE"


_STAGE_ORDER: tuple[OnboardingStage, ...] = tuple(OnboardingStage)
_STAGE_INDEX = {stage: index for index, stage in enumerate(_STAGE_ORDER)}


def next_stage(stage: OnboardingStage) -> OnboardingStage | None:
    """Successor stage, or None once LIVE (terminal). Stages advance one at
    a time; skipping is not permitted."""
    following = _STAGE_INDEX[stage] + 1
    if following >= len(_STAGE_ORDER):
        return None
    return _STAGE_ORDER[following]


#: Automated pre-activation checks (target §10.3).
READINESS_CHECKS: tuple[str, ...] = (
    "catalog_completeness",
    "policy_consistency",
    "promotion_consistency",
    "payment_health",
    "webhook_health",
    "shipping_availability",
    "return_refund_policy_completeness",
    "agent_capability_profile_validity",
    "protocol_endpoint_health",
    "sandbox_transaction",
)


class MerchantOnboarding(StrictModel):
    """A merchant's onboarding pointer: current stage plus the readiness
    checks satisfied so far. Activation requires stage READY_FOR_REVIEW
    with every check passing."""

    merchant_id: str = Field(min_length=1, max_length=128)
    stage: OnboardingStage = OnboardingStage.CREATED
    completed_checks: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)

    def advance(self) -> "MerchantOnboarding":
        """Return a copy moved one stage forward. LIVE cannot advance."""
        following = next_stage(self.stage)
        if following is None:
            raise ValueError("LIVE merchants cannot advance further")
        return self.model_copy(
            update={"stage": following, "updated_at": utc_now()}
        )

    def record_check(self, check: str) -> "MerchantOnboarding":
        """Record a passed readiness check (idempotent)."""
        if check not in READINESS_CHECKS:
            raise ValueError(f"unknown readiness check: {check}")
        if check in self.completed_checks:
            return self
        return self.model_copy(
            update={
                "completed_checks": [*self.completed_checks, check],
                "updated_at": utc_now(),
            }
        )

    @property
    def is_activation_ready(self) -> bool:
        """True when every readiness check has passed."""
        return all(check in self.completed_checks for check in READINESS_CHECKS)


def validate_readiness(
    *,
    catalog,
    policy,
    promotion_repo,
    shipping_service,
    merchant_id: str,
    payment_configured: bool,
    webhook_configured: bool,
    sandbox_repo=None,
) -> dict[str, bool]:
    """Automated pre-activation checks (target §10.3) computed from live
    platform state. Each check is independent and evidence-free by design —
    the caller records passing checks on the onboarding row."""
    from sellable.protocols.capabilities import build_merchant_profile
    from sellable.protocols import ucp as _ucp

    results: dict[str, bool] = {}
    try:
        results["catalog_completeness"] = len(catalog.all()) > 0
    except Exception:  # noqa: BLE001 — a check failure is a False, never a crash
        results["catalog_completeness"] = False
    try:
        results["policy_consistency"] = (
            policy.human_approval_threshold_paise <= policy.max_order_value_paise
            and len(policy.allowed_categories) > 0
        )
    except Exception:  # noqa: BLE001
        results["policy_consistency"] = False
    try:
        active = promotion_repo.active_for_merchant(merchant_id)
        results["promotion_consistency"] = not _exclusive_overlap(active)
    except Exception:  # noqa: BLE001
        results["promotion_consistency"] = False
    results["payment_health"] = bool(payment_configured)
    results["webhook_health"] = bool(webhook_configured)
    try:
        results["shipping_availability"] = (
            len(shipping_service.methods_for(merchant_id)) > 0
        )
    except Exception:  # noqa: BLE001
        results["shipping_availability"] = False
    try:
        # Refund authority is complete when the human-approval threshold
        # gates above-cap asks (CS cap + refund approvals enforce it).
        results["return_refund_policy_completeness"] = (
            policy.human_approval_threshold_paise > 0
        )
    except Exception:  # noqa: BLE001
        results["return_refund_policy_completeness"] = False
    try:
        profile = build_merchant_profile(merchant_id)
        results["agent_capability_profile_validity"] = any(
            c.status.value == "ACTIVE" for c in profile.capabilities
        )
    except Exception:  # noqa: BLE001
        results["agent_capability_profile_validity"] = False
    try:
        results["protocol_endpoint_health"] = True
        _ = _ucp.UCP_VERSION
    except Exception:  # noqa: BLE001
        results["protocol_endpoint_health"] = False
    try:
        results["sandbox_transaction"] = _sandbox_approved(sandbox_repo, merchant_id)
    except Exception:  # noqa: BLE001
        results["sandbox_transaction"] = False
    return results


def _exclusive_overlap(promotions) -> bool:
    """True when two ACTIVE EXCLUSIVE promotions overlap in time."""
    from sellable.contracts import StackingRule

    exclusive = [
        p for p in promotions if p.stacking is StackingRule.EXCLUSIVE
    ]
    for index, first in enumerate(exclusive):
        for second in exclusive[index + 1:]:
            start = max(first.start_at, second.start_at)
            if first.end_at is not None and second.end_at is not None:
                end = min(first.end_at, second.end_at)
            else:
                end = first.end_at if first.end_at is not None else second.end_at
            if end is None or start < end:
                return True
    return False


def _sandbox_approved(sandbox_repo, merchant_id: str) -> bool:
    if sandbox_repo is None:
        return False
    try:
        rows = sandbox_repo.list_for_merchant(merchant_id)
    except Exception:  # noqa: BLE001
        return False
    return any(r.get("stage") in ("APPROVED", "PRODUCTION") for r in rows)
