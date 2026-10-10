"""Delegation and authorization contracts (target §14).

Replaces the narrow one-time consent model with a broader authorization and
delegation system: the customer delegates bounded permissions to an agent,
and every consequential action resolves delegation + merchant policy + risk
into an explicit authorization decision. The existing single-use
``Consent`` (payment ticket) is retained and becomes the transaction-bound
leaf of this model (§14.5); persistence and the authorization service
arrive in Phase 3.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from sellable.contracts import PositivePaise, StrictModel, new_id, utc_now


class OperationScope(StrEnum):
    """Example scopes (target §14.3). Higher-risk scopes require stronger
    authorization."""

    CATALOG_READ = "catalog:read"
    SEARCH_READ = "search:read"
    RECOMMENDATION_READ = "recommendation:read"
    CART_WRITE = "cart:write"
    CHECKOUT_WRITE = "checkout:write"
    ORDER_READ = "order:read"
    ORDER_CANCEL_REQUEST = "order:cancel_request"
    SHIPPING_READ = "shipping:read"
    RETURN_CREATE = "return:create"
    REFUND_REQUEST = "refund:request"
    SUPPORT_CREATE = "support:create"
    PAYMENT_AUTHORIZE = "payment:authorize"


#: Scopes that always require transaction-bound authorization (§14.5),
#: never a standing delegation alone. Checkout creation is reversible and
#: stays ALLOW-able under a valid delegation; the single-use payment
#: consent remains the transaction-bound money gate.
HIGH_RISK_SCOPES = frozenset(
    {
        OperationScope.PAYMENT_AUTHORIZE,
        OperationScope.REFUND_REQUEST,
    }
)


class ApprovalMode(StrEnum):
    AUTO = "AUTO"
    REQUIRE_CUSTOMER = "REQUIRE_CUSTOMER"
    REQUIRE_HUMAN = "REQUIRE_HUMAN"


class DelegationStatus(StrEnum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class DelegationGrant(StrictModel):
    """A bounded customer→agent delegation (target §14.2)."""

    delegation_id: str = Field(default_factory=lambda: new_id("dlg"))
    principal_customer_id: str = Field(min_length=1, max_length=128)
    subject_agent_id: str = Field(min_length=1, max_length=128)
    merchant_scope: str = Field(min_length=1, max_length=128)
    operation_scopes: list[OperationScope] = Field(min_length=1)
    category_scopes: list[str] = Field(default_factory=list)
    amount_limit_paise: PositivePaise | None = None
    currency: str = Field(default="INR", min_length=3, max_length=3)
    frequency_limit: int | None = Field(default=None, ge=1)
    approval_mode: ApprovalMode = ApprovalMode.AUTO
    valid_from: datetime = Field(default_factory=utc_now)
    expires_at: datetime
    status: DelegationStatus = DelegationStatus.ACTIVE
    created_at: datetime = Field(default_factory=utc_now)
    revoked_at: datetime | None = None

    @model_validator(mode="after")
    def _window_and_revocation_consistent(self) -> "DelegationGrant":
        if self.expires_at <= self.valid_from:
            raise ValueError("expires_at must be after valid_from")
        if self.status == DelegationStatus.REVOKED and self.revoked_at is None:
            raise ValueError("revoked delegations must carry revoked_at")
        if self.status != DelegationStatus.REVOKED and self.revoked_at is not None:
            raise ValueError("only revoked delegations may carry revoked_at")
        return self

    def is_usable(self, now: datetime | None = None) -> bool:
        """Usable iff ACTIVE and inside its validity window. Revoked or
        expired delegations invalidate future actions (§45)."""
        if self.status != DelegationStatus.ACTIVE:
            return False
        moment = now or utc_now()
        return self.valid_from <= moment < self.expires_at

    def covers(
        self,
        scope: OperationScope,
        *,
        merchant_id: str,
        amount_paise: int | None = None,
        now: datetime | None = None,
        categories: list[str] | None = None,
        usage_count: int | None = None,
    ) -> bool:
        """Check scope + merchant + amount-limit + category + frequency
        fit. Risk/policy checks are separate layers (§24.1); this answers
        delegation fit only."""
        if not self.is_usable(now):
            return False
        if scope not in self.operation_scopes:
            return False
        if merchant_id != self.merchant_scope:
            return False
        if (
            amount_paise is not None
            and self.amount_limit_paise is not None
            and amount_paise > self.amount_limit_paise
        ):
            return False
        if categories and self.category_scopes:
            if any(c not in self.category_scopes for c in categories):
                return False
        if (
            usage_count is not None
            and self.frequency_limit is not None
            and usage_count >= self.frequency_limit
        ):
            return False
        return True


class AuthorizationOutcome(StrEnum):
    """Authorization decision outcomes (target §14.4)."""

    ALLOW = "ALLOW"
    DENY = "DENY"
    REQUIRE_CUSTOMER = "REQUIRE_CUSTOMER"
    REQUIRE_HUMAN = "REQUIRE_HUMAN"


class AuthorizationDecision(StrictModel):
    """An explicit, attributable authorization record (target §14.4)."""

    decision_id: str = Field(default_factory=lambda: new_id("authz"))
    delegation_id: str | None = Field(default=None, max_length=128)
    scope_used: OperationScope
    amount_checked_paise: int | None = Field(default=None, ge=0)
    outcome: AuthorizationOutcome
    reason_code: str = Field(min_length=1, max_length=96)
    matched_policies: list[str] = Field(default_factory=list)
    risk_reference: str | None = Field(default=None, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime

    @model_validator(mode="after")
    def _expiry_follows_creation(self) -> "AuthorizationDecision":
        if self.expires_at <= self.created_at:
            raise ValueError("expires_at must be after created_at")
        return self

    @property
    def is_expired(self) -> bool:
        """Expired authorizations cannot execute (§45)."""
        return utc_now() >= self.expires_at
