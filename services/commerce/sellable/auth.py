"""API key + HMAC authentication for buyer-agent gateway requests.

Two methods are supported (§55.6):

1. Static API key — ``X-Agent-Key: <key>`` (legacy/demo; the plaintext key is
   matched against the SHA-256 hashes configured via ``BUYER_AGENT_API_KEY_HASH``
   or the built-in demo key).
2. Signed request — an HMAC-SHA256 signature over a canonical string built from
   ``agent_id``, ``timestamp``, ``nonce``, ``method`` and ``path``, using the
   shared ``BUYER_AGENT_HMAC_SECRET``. This verifies secret possession, request
   freshness, and prevents replay via a server-side nonce cache.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request

from sellable.config import settings


logger = logging.getLogger("sellable.auth")


@dataclass(frozen=True)
class AgentApiKey:
    key_id: str
    merchant_id: str
    buyer_agent_id: str = "unknown"
    auth_method: str = "api_key"


# Built-in demo key so the reference flow works without additional configuration.
_DEMO_KEY = "sellable_demo_key_001"
_DEMO_KEY_HASH = hashlib.sha256(_DEMO_KEY.encode("utf-8")).hexdigest()
_DEMO_MERCHANT_ID = "mrc_demo_store"


class _ReplayGuard:
    """Thread-safe, time-bounded nonce cache to prevent replay attacks."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        self._ttl = ttl_seconds
        self._seen: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()

    def consume(self, agent_id: str, nonce: str) -> bool:
        """Return ``True`` the first time an ``(agent_id, nonce)`` pair is seen."""
        key = (agent_id, nonce)
        now = time.time()
        with self._lock:
            self._prune(now)
            if key in self._seen:
                return False
            self._seen[key] = now
            return True

    def _prune(self, now: float) -> None:
        cutoff = now - self._ttl
        stale = [key for key, seen_at in self._seen.items() if seen_at < cutoff]
        for key in stale:
            self._seen.pop(key, None)


_replay_guard = _ReplayGuard()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _configured_hashes() -> set[str]:
    hashes = set(settings.agent_api_key_hashes)
    # The built-in demo key is only valid in known dev environments (see
    # Settings.is_dev_environment) so a deployed environment — including one
    # with a typo'd SELLABLE_ENVIRONMENT — cannot be accessed with the
    # well-known test key.
    if settings.is_dev_environment:
        hashes.add(_DEMO_KEY_HASH)
    return hashes


_issued_key_repo: object | None = None
_issued_key_failed_at: float = 0.0


def _lookup_issued_key(key_hash: str):
    """Resolve a merchant-issued DB key by hash. None when not found/usable.

    DB-issued keys are the merchant-console path for onboarding external AI
    buyers; the env-configured hash list remains the platform/demo fallback.
    Repository failures degrade to the env path (logged) rather than
    breaking every static-key request.
    """
    global _issued_key_repo, _issued_key_failed_at
    if _issued_key_repo is None and time.time() - _issued_key_failed_at > 60:
        try:
            from sellable.repositories import AgentApiKeyRepository

            _issued_key_repo = AgentApiKeyRepository()
        except Exception as error:  # noqa: BLE001 — degrade to env keys
            _issued_key_failed_at = time.time()
            logger.warning("Agent key store unavailable; env keys only: %s", error)
    if _issued_key_repo is None:
        return None
    try:
        record = _issued_key_repo.get_active_by_hash(key_hash)
    except Exception as error:  # noqa: BLE001 — degrade to env keys
        _issued_key_repo = None
        _issued_key_failed_at = time.time()
        logger.warning("Agent key lookup failed; env keys only: %s", error)
        return None
    if record is not None:
        _issued_key_repo.touch_last_used(record.key_id)
    return record


def _resolve_static_key(x_agent_key: str) -> AgentApiKey:
    key_hash = _sha256(x_agent_key)
    # Merchant-issued keys first: they carry their own merchant + buyer scope.
    issued = _lookup_issued_key(key_hash)
    if issued is not None:
        return AgentApiKey(
            key_id=issued.key_id,
            merchant_id=issued.merchant_id,
            buyer_agent_id=issued.buyer_agent_id or "unknown",
            auth_method="api_key",
        )
    # Constant-time comparison against each configured hash — plain set
    # membership on hex digests would leak a (small) timing signal.
    matched = any(
        hmac.compare_digest(key_hash, candidate)
        for candidate in _configured_hashes()
    )
    if not matched:
        raise HTTPException(status_code=403, detail="Invalid agent API key")
    return AgentApiKey(
        # Never carry the plaintext key in the request-scoped object (it
        # would leak into any future logging of key_id); a hash prefix
        # identifies the key like the HMAC path does.
        key_id=f"static:{key_hash[:16]}",
        merchant_id=_DEMO_MERCHANT_ID,
        buyer_agent_id="buyer_demo_01",
        auth_method="api_key",
    )


def _resolve_signed_request(
    *,
    request: Request,
    bearer_key: str,
    agent_id: str | None,
    timestamp: str | None,
    nonce: str | None,
    signature: str | None,
) -> AgentApiKey:
    if settings.agent_hmac_secret is None:
        raise HTTPException(status_code=401, detail="HMAC verification is not configured")

    bearer_hash = _sha256(bearer_key)
    # Merchant-issued keys carry their own merchant + buyer scope.
    issued = _lookup_issued_key(bearer_hash)
    if issued is not None:
        issued_merchant = issued.merchant_id
        issued_buyer = issued.buyer_agent_id
    elif bearer_hash in _configured_hashes():
        issued_merchant = _DEMO_MERCHANT_ID
        issued_buyer = None
    else:
        raise HTTPException(status_code=403, detail="Invalid agent API key")

    if not agent_id:
        raise HTTPException(status_code=401, detail="Missing X-Agent-Id header")
    if not timestamp or not nonce or not signature:
        raise HTTPException(
            status_code=401, detail="Missing X-Timestamp, X-Nonce, or X-Signature header"
        )

    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid timestamp") from None

    if abs(time.time() - ts) > 300:
        raise HTTPException(status_code=401, detail="Request timestamp expired")

    canonical_parts = [
        timestamp,
        nonce,
        agent_id,
        request.method,
        request.url.path,
        request.url.query,
        getattr(request.state, "sellable_body_sha256", "") or "",
    ]
    canonical = ".".join(canonical_parts)
    expected = hmac.new(
        settings.agent_hmac_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid request signature")

    if not _replay_guard.consume(agent_id, nonce):
        raise HTTPException(status_code=401, detail="Replayed request nonce")
    # Persistent claim: the in-memory guard above stops same-process replays,
    # but it is wiped by every restart/redeploy and is per-replica. The DB
    # claim closes both holes; a DB outage degrades to memory-only (logged)
    # rather than rejecting all signed traffic.
    if not _claim_nonce_persistently(agent_id, nonce):
        raise HTTPException(status_code=401, detail="Replayed request nonce")

    return AgentApiKey(
        key_id=(
            issued.key_id
            if issued is not None
            else f"hmac:{bearer_hash[:16]}"
        ),
        merchant_id=issued_merchant,
        buyer_agent_id=agent_id if issued_buyer is None else (issued_buyer or agent_id),
        auth_method="hmac",
    )


_nonce_repo: object | None = None
_nonce_repo_failed_at: float = 0.0


def _claim_nonce_persistently(agent_id: str, nonce: str) -> bool:
    """Claim (agent_id, nonce) in the database. True unless seen before."""
    global _nonce_repo, _nonce_repo_failed_at
    if _nonce_repo is None and time.time() - _nonce_repo_failed_at > 60:
        try:
            from sellable.repositories import NonceRepository

            _nonce_repo = NonceRepository()
        except Exception as error:
            _nonce_repo_failed_at = time.time()
            logger.warning("Nonce store unavailable; replay guard is memory-only: %s", error)
    if _nonce_repo is None:
        return True
    try:
        return _nonce_repo.claim(agent_id, nonce)
    except Exception as error:
        _nonce_repo = None
        _nonce_repo_failed_at = time.time()
        logger.warning("Nonce claim failed; replay guard is memory-only: %s", error)
        return True


def get_agent_api_key(
    request: Request,
    x_agent_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_nonce: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
) -> AgentApiKey:
    """FastAPI dependency that authenticates the calling buyer agent."""
    if x_agent_key:
        return _resolve_static_key(x_agent_key)

    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if not bearer:
        raise HTTPException(status_code=401, detail="Missing agent credentials")

    return _resolve_signed_request(
        request=request,
        bearer_key=bearer,
        agent_id=x_agent_id,
        timestamp=x_timestamp,
        nonce=x_nonce,
        signature=x_signature,
    )


def get_agent_api_key_signed(
    request: Request,
    x_agent_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_nonce: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
) -> AgentApiKey:
    """FastAPI dependency for money-adjacent agent writes.

    A static bearer key alone has no freshness or replay binding, so outside
    known dev environments every mutating agent route requires the
    HMAC-signed-request path. Reads and quote-only routes keep the plain
    dependency.
    """
    resolved = get_agent_api_key(
        request,
        x_agent_key=x_agent_key,
        authorization=authorization,
        x_agent_id=x_agent_id,
        x_timestamp=x_timestamp,
        x_nonce=x_nonce,
        x_signature=x_signature,
    )
    if resolved.auth_method != "hmac" and not settings.is_dev_environment:
        raise HTTPException(
            status_code=401,
            detail="Mutating agent routes require an HMAC-signed request",
        )
    return resolved


def sign_request(
    *,
    agent_id: str,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    secret: str,
    body: bytes = b"",
    query: str = "",
) -> str:
    """Compute the HMAC-SHA256 signature a client must send (used by tests/DX).

    The canonical string binds timestamp, nonce, agent id, method, path, query,
    and a SHA-256 of the request body, so replaying a captured request with a
    modified body fails verification.
    """
    body_hash = hashlib.sha256(body).hexdigest() if body else ""
    canonical = ".".join([timestamp, nonce, agent_id, method, path, query, body_hash])
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
