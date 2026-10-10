"""Negotiated protocol sessions (target §15.2, §15.3)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sellable.contracts import (
    AgentProfile,
    MerchantCapabilityProfile,
    ProtocolSession,
    ProtocolSessionStatus,
    utc_now,
)
from sellable.protocols.capabilities import negotiate


#: Default session lifetime.
SESSION_TTL = timedelta(hours=24)


class SessionError(ValueError):
    """The session cannot be used."""


class SessionNotFoundError(SessionError, LookupError):
    """No such session for this merchant (foreign ids stay invisible)."""


class SessionExpiredError(SessionError):
    """The session expired — negotiate again."""


class ProtocolSessionService:
    def __init__(self, session_repo: object) -> None:
        self._sessions = session_repo

    def negotiate(
        self,
        merchant_id: str,
        agent_profile: AgentProfile,
        merchant_profile: MerchantCapabilityProfile,
        *,
        delegation_id: str | None = None,
        ttl: timedelta = SESSION_TTL,
        now: datetime | None = None,
    ) -> ProtocolSession:
        """Intersect profiles into a session capability set and persist it."""
        moment = now or utc_now()
        session = ProtocolSession(
            agent_id=agent_profile.agent_id,
            merchant_id=merchant_id,
            protocol=agent_profile.protocol,
            protocol_version=agent_profile.protocol_version,
            active_capabilities=negotiate(merchant_profile, agent_profile),
            auth_context={"agent_identity": dict(agent_profile.identity)},
            delegation_id=delegation_id,
            created_at=moment,
            expires_at=moment + ttl,
        )
        self._sessions.save(session)
        return session

    def get(self, session_id: str, merchant_id: str) -> ProtocolSession:
        session = self._sessions.get(session_id, merchant_id)
        if session is None:
            raise SessionNotFoundError(f"Unknown session: {session_id}")
        if session.status is not ProtocolSessionStatus.ACTIVE:
            raise SessionError(f"session is {session.status.value}")
        if utc_now() >= session.expires_at:
            self._sessions.save(
                session.model_copy(update={"status": ProtocolSessionStatus.EXPIRED})
            )
            raise SessionExpiredError("session has expired")
        return session

    def require_capability(
        self, session_id: str, merchant_id: str, capability_id: str
    ) -> ProtocolSession:
        """Gate one canonical call on the negotiated set (§15.2: no assumed
        capabilities)."""
        session = self.get(session_id, merchant_id)
        if capability_id not in session.active_capabilities:
            raise SessionError(
                f"capability {capability_id} was not negotiated for this session"
            )
        return session

    def attach_delegation(
        self, session_id: str, merchant_id: str, delegation_id: str
    ) -> ProtocolSession:
        session = self.get(session_id, merchant_id)
        updated = session.model_copy(update={"delegation_id": delegation_id})
        self._sessions.save(updated)
        return updated

    def revoke(self, session_id: str, merchant_id: str) -> ProtocolSession:
        session = self.get(session_id, merchant_id)
        updated = session.model_copy(update={"status": ProtocolSessionStatus.REVOKED})
        self._sessions.save(updated)
        return updated

    def expire_due(self, merchant_id: str) -> int:
        expired = 0
        for session in self._sessions.active_for_merchant(merchant_id):
            if utc_now() >= session.expires_at:
                self._sessions.save(
                    session.model_copy(update={"status": ProtocolSessionStatus.EXPIRED})
                )
                expired += 1
        return expired
