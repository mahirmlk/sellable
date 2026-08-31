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
import threading
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request

from sellable.config import settings


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
    # The built-in demo key is only valid outside production so a deployed
    # environment cannot be accessed with the well-known test key.
    if settings.environment != "production":
        hashes.add(_DEMO_KEY_HASH)
    return hashes


def _resolve_static_key(x_agent_key: str) -> AgentApiKey:
    key_hash = _sha256(x_agent_key)
    if key_hash not in _configured_hashes():
        raise HTTPException(status_code=403, detail="Invalid agent API key")
    return AgentApiKey(
        key_id=x_agent_key,
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

    if _sha256(bearer_key) not in _configured_hashes():
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

    return AgentApiKey(
        key_id=f"hmac:{_sha256(bearer_key)[:16]}",
        merchant_id=_DEMO_MERCHANT_ID,
        buyer_agent_id=agent_id,
        auth_method="hmac",
    )


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
