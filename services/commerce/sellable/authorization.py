"""Delegation resolution and authorization decisions (target §14.4).

The service answers one question: given a delegation grant, a requested
scope, and the transaction context, is the action ALLOWed, DENied, or does
it REQUIRE_CUSTOMER / REQUIRE_HUMAN approval? Merchant policy (allowed?)
and risk (how risky?) stay separate layers (§24.1); this layer answers
delegation fit only.

The pure ``decide`` function owns the rules so it is testable without a
database; ``AuthorizationService`` adds repository resolution for runtime
use. Every decision carries reason codes and matched policies so denials
are explainable in the ledger.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Protocol


class _DelegationLookup(Protocol):
    def get(self, delegation_id: str) -> object | None: ...


from sellable.contracts import utc_now
from sellable.delegations import (
    HIGH_RISK_SCOPES,
    ApprovalMode,
    AuthorizationDecision,
    AuthorizationOutcome,
    DelegationGrant,
    DelegationStatus,
    OperationScope,
)


def decide(
    grant: DelegationGrant | None,
    *,
    scope: OperationScope,
    merchant_id: str,
    amount_paise: int | None = None,
    risk_reference: str | None = None,
    authorization_ttl_minutes: int = 10,
    categories: list[str] | None = None,
    usage_count: int | None = None,
) -> AuthorizationDecision:
    """Resolve a delegation grant into an explicit authorization decision."""
    now = utc_now()
    expires_at = now + timedelta(minutes=authorization_ttl_minutes)

    def _deny(reason_code: str, matched: list[str] | None = None) -> AuthorizationDecision:
        return AuthorizationDecision(
            delegation_id=grant.delegation_id if grant is not None else None,
            scope_used=scope,
            amount_checked_paise=amount_paise,
            outcome=AuthorizationOutcome.DENY,
            reason_code=reason_code,
            matched_policies=matched or [],
            risk_reference=risk_reference,
            expires_at=expires_at,
        )

    if grant is None:
        return _deny("DELEGATION_UNKNOWN")
    if grant.status == DelegationStatus.REVOKED:
        # Revoked delegation invalidates future actions (§45).
        return _deny("DELEGATION_REVOKED")
    if not (grant.valid_from <= now < grant.expires_at):
        return _deny("DELEGATION_EXPIRED")
    if scope not in grant.operation_scopes:
        return _deny("SCOPE_NOT_GRANTED")
    if merchant_id != grant.merchant_scope:
        return _deny("MERCHANT_SCOPE_MISMATCH")
    if (
        amount_paise is not None
        and grant.amount_limit_paise is not None
        and amount_paise > grant.amount_limit_paise
    ):
        return _deny("AMOUNT_EXCEEDS_LIMIT")
    if categories and grant.category_scopes:
        outside = [c for c in categories if c not in grant.category_scopes]
        if outside:
            return _deny("CATEGORY_SCOPE_MISMATCH", ["DELEGATION.category_scopes"])
    if (
        usage_count is not None
        and grant.frequency_limit is not None
        and usage_count >= grant.frequency_limit
    ):
        return _deny("FREQUENCY_LIMIT_EXCEEDED", ["DELEGATION.frequency_limit"])

    matched = ["DELEGATION.valid", "DELEGATION.scope_fit"]
    if grant.approval_mode == ApprovalMode.REQUIRE_HUMAN:
        return AuthorizationDecision(
            delegation_id=grant.delegation_id,
            scope_used=scope,
            amount_checked_paise=amount_paise,
            outcome=AuthorizationOutcome.REQUIRE_HUMAN,
            reason_code="DELEGATION_REQUIRES_HUMAN",
            matched_policies=[*matched, "DELEGATION.approval_mode"],
            risk_reference=risk_reference,
            expires_at=expires_at,
        )
    if grant.approval_mode == ApprovalMode.REQUIRE_CUSTOMER:
        return AuthorizationDecision(
            delegation_id=grant.delegation_id,
            scope_used=scope,
            amount_checked_paise=amount_paise,
            outcome=AuthorizationOutcome.REQUIRE_CUSTOMER,
            reason_code="DELEGATION_REQUIRES_CUSTOMER",
            matched_policies=[*matched, "DELEGATION.approval_mode"],
            risk_reference=risk_reference,
            expires_at=expires_at,
        )
    if scope in HIGH_RISK_SCOPES:
        # High-risk scopes need transaction-bound authorization (§14.5):
        # a standing delegation alone never suffices.
        return AuthorizationDecision(
            delegation_id=grant.delegation_id,
            scope_used=scope,
            amount_checked_paise=amount_paise,
            outcome=AuthorizationOutcome.REQUIRE_CUSTOMER,
            reason_code="HIGH_RISK_SCOPE_REQUIRES_CUSTOMER",
            matched_policies=[*matched, "AUTHORIZATION.transaction_bound"],
            risk_reference=risk_reference,
            expires_at=expires_at,
        )
    return AuthorizationDecision(
        delegation_id=grant.delegation_id,
        scope_used=scope,
        amount_checked_paise=amount_paise,
        outcome=AuthorizationOutcome.ALLOW,
        reason_code="DELEGATION_VALID",
        matched_policies=matched,
        risk_reference=risk_reference,
        expires_at=expires_at,
    )


class AuthorizationService:
    """Repository-backed authorization for runtime use."""

    def __init__(
        self,
        delegation_lookup: _DelegationLookup | None = None,
        usage_lookup=None,
    ) -> None:
        self._lookup = delegation_lookup
        self._usage_lookup = usage_lookup

    def authorize(
        self,
        *,
        delegation_id: str,
        scope: OperationScope,
        merchant_id: str,
        amount_paise: int | None = None,
        risk_reference: str | None = None,
        categories: list[str] | None = None,
    ) -> AuthorizationDecision:
        grant = None
        if self._lookup is not None:
            record = self._lookup.get(delegation_id)
            if isinstance(record, DelegationGrant):
                grant = record
        usage_count = None
        if self._usage_lookup is not None:
            try:
                usage_count = int(self._usage_lookup(delegation_id))
            except Exception:  # noqa: BLE001 — usage is advisory, fail open to None
                usage_count = None
        return decide(
            grant,
            scope=scope,
            merchant_id=merchant_id,
            amount_paise=amount_paise,
            risk_reference=risk_reference,
            categories=categories,
            usage_count=usage_count,
        )
