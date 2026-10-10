"""Customer identity linking (target §12, UCP identity-linking).

Public or agent-authenticated access is never identical to
user-authenticated access: linking is an explicit two-step handshake.
Create a PENDING link (the one-time code is shown once); approve with the
code (customer proof via the agent channel) or merchant approval; after
that the customer counts as AUTHENTICATED for support and delegation
flows. Full OAuth 2.0 issuance arrives with Phase 6 platform auth.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sellable.contracts import (
    IdentityLink,
    IdentityLinkStatus,
    utc_now,
)


#: PENDING links await approval this long before expiring.
PENDING_TTL = timedelta(hours=24)

#: LINKED identities stay valid this long before re-linking.
LINKED_TTL = timedelta(days=90)


class IdentityError(ValueError):
    """Identity linking refused the request."""


class IdentityNotFoundError(IdentityError, LookupError):
    """No such link for this merchant (foreign ids stay invisible)."""


def _hash_code(link_code: str) -> str:
    return hashlib.sha256(link_code.encode("utf-8")).hexdigest()


class IdentityLinkService:
    def __init__(self, link_repo: object) -> None:
        self._links = link_repo

    def create_link(
        self,
        merchant_id: str,
        customer_id: str,
        *,
        agent_id: str | None = None,
        protocol: str = "rest",
        scopes: list[str] | None = None,
        ttl: timedelta = PENDING_TTL,
        now: datetime | None = None,
    ) -> tuple[IdentityLink, str]:
        """Open a PENDING link. Returns (link, one-time code)."""
        moment = now or utc_now()
        link_code = secrets.token_urlsafe(24)
        link = IdentityLink(
            merchant_id=merchant_id,
            customer_id=customer_id,
            agent_id=agent_id,
            protocol=protocol,
            scopes=list(scopes or []),
            link_code_hash=_hash_code(link_code),
            created_at=moment,
            expires_at=moment + ttl,
        )
        self._links.save(link)
        return link, link_code

    def approve_link(
        self,
        link_id: str,
        merchant_id: str,
        *,
        link_code: str | None = None,
        merchant_approved: bool = False,
    ) -> IdentityLink:
        """Approve a PENDING link: either the customer proof (link code via
        the agent channel) or explicit merchant approval."""
        link = self._links.get(link_id, merchant_id)
        if link is None:
            raise IdentityNotFoundError(f"Unknown identity link: {link_id}")
        if link.status is not IdentityLinkStatus.PENDING:
            raise IdentityError(f"link is {link.status.value}")
        if utc_now() >= link.expires_at:
            self._links.save(
                link.model_copy(update={"status": IdentityLinkStatus.EXPIRED})
            )
            raise IdentityError("link code has expired")
        if merchant_approved:
            approved = True
        elif link_code is not None:
            approved = secrets.compare_digest(_hash_code(link_code), link.link_code_hash)
        else:
            approved = False
        if not approved:
            raise IdentityError("link approval requires the link code or merchant approval")
        linked = link.model_copy(
            update={
                "status": IdentityLinkStatus.LINKED,
                "expires_at": utc_now() + LINKED_TTL,
            }
        )
        self._links.save(linked)
        return linked

    def revoke(self, link_id: str, merchant_id: str) -> IdentityLink:
        link = self._links.get(link_id, merchant_id)
        if link is None:
            raise IdentityNotFoundError(f"Unknown identity link: {link_id}")
        revoked = link.model_copy(update={"status": IdentityLinkStatus.REVOKED})
        self._links.save(revoked)
        return revoked

    def get_link(self, link_id: str, merchant_id: str) -> IdentityLink:
        link = self._links.get(link_id, merchant_id)
        if link is None:
            raise IdentityNotFoundError(f"Unknown identity link: {link_id}")
        return link

    def is_linked(
        self, merchant_id: str, customer_id: str, *, agent_id: str | None = None
    ) -> bool:
        """True when a fresh LINKED identity exists (lazy expiry enforced)."""
        for link in self._links.linked_for_customer(
            merchant_id, customer_id, agent_id=agent_id
        ):
            if utc_now() < link.expires_at:
                return True
            self._links.save(
                link.model_copy(update={"status": IdentityLinkStatus.EXPIRED})
            )
        return False

    def expire_due(self, merchant_id: str) -> int:
        # Sweeps run through linked_for_customer per customer; without a
        # customers table there is no merchant-wide scan yet (Phase 6).
        return 0
