"""Agent identity and reputation scaffolding (target §13).

Phase 1a: pure, transport-safe contracts only — no persistence, no network.
Identity answers *who is this agent*; reputation answers *how has it
behaved*. Reputation is a risk signal, never the sole authorization
mechanism (§13.3). Persistence and credential issuance arrive in Phase 1b.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from sellable.contracts import StrictModel, new_id, utc_now


class AgentType(StrEnum):
    """Agent identity classes (target §13.1)."""

    SELLABLE_INTERNAL_AGENT = "SELLABLE_INTERNAL_AGENT"
    MERCHANT_OWNED_AGENT = "MERCHANT_OWNED_AGENT"
    CUSTOMER_AGENT = "CUSTOMER_AGENT"
    PLATFORM_AGENT = "PLATFORM_AGENT"
    INTEGRATION_AGENT = "INTEGRATION_AGENT"


class CredentialStatus(StrEnum):
    ACTIVE = "ACTIVE"
    ROTATED = "ROTATED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class AgentIdentity(StrictModel):
    """First-class agent identity (target §13 header fields)."""

    agent_id: str = Field(default_factory=lambda: new_id("agent"))
    agent_type: AgentType
    owner_id: str = Field(min_length=1, max_length=128)
    issuer: str = Field(min_length=1, max_length=256)
    client_id: str | None = Field(default=None, max_length=128)
    credential_status: CredentialStatus = CredentialStatus.ACTIVE
    credential_expires_at: datetime | None = None
    capability_profile: str | None = Field(default=None, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    last_seen_at: datetime | None = None

    def is_credential_usable(self, now: datetime | None = None) -> bool:
        """Usable iff ACTIVE and unexpired (short-lived creds per §37.1)."""
        if self.credential_status != CredentialStatus.ACTIVE:
            return False
        moment = now or utc_now()
        return self.credential_expires_at is None or self.credential_expires_at > moment


class AgentReputation(StrictModel):
    """Behavioral reputation record (target §13.3). Explanatory counters plus
    a decomposable score — never the sole authorization mechanism."""

    agent_id: str = Field(min_length=1, max_length=128)
    successful_transactions: int = Field(default=0, ge=0)
    failed_transactions: int = Field(default=0, ge=0)
    policy_denials: int = Field(default=0, ge=0)
    fraud_flags: int = Field(default=0, ge=0)
    abuse_flags: int = Field(default=0, ge=0)
    authorization_failures: int = Field(default=0, ge=0)
    average_order_value_paise: int = Field(default=0, ge=0)
    support_incidents: int = Field(default=0, ge=0)
    merchant_acceptance_rate_bps: int = Field(default=0, ge=0, le=10_000)
    customer_complaints: int = Field(default=0, ge=0)
    reputation_score_bps: int = Field(default=0, ge=0, le=10_000)
    score_confidence_bps: int = Field(default=0, ge=0, le=10_000)
    last_updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def _no_score_without_history(self) -> "AgentReputation":
        total = self.successful_transactions + self.failed_transactions
        if total == 0 and self.reputation_score_bps != 0:
            raise ValueError("reputation_score_bps must be 0 with no transaction history")
        return self
