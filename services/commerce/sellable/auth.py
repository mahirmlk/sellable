"""API key + HMAC authentication for buyer-agent gateway requests.

Two methods are supported (§55.6):

1. Static API key — ``X-Agent-Key: <key>`` (legacy/demo; the plaintext key is
   matched against the SHA-256 hashes configured via ``BUYER_AGENT_API_KEY_HASH``
   or the built-in demo key).
2. Signed request — production uses the versioned v2 HMAC-SHA256 envelope,
   length-prefixing every field and binding the bearer credential, request,
   body, and authorization-context headers. Legacy dotted signing is accepted
   only in development/test.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from dataclasses import dataclass
from collections.abc import Sequence

from fastapi import Header, HTTPException, Request

from sellable.config import settings


logger = logging.getLogger("sellable.auth")


#: Single source of truth for HMAC nonce freshness (seconds). The in-memory
#: replay guard, the persistent nonce claim, and the timestamp acceptance
#: window must agree — otherwise a nonce can be valid in one layer while
#: already pruned in another.
NONCE_TTL_SECONDS = 300
SIGNATURE_VERSION_V2 = "v2"
_SIGNATURE_CONTEXT_HEADERS = (
    "x-delegation-id",
    "x-session-id",
    "x-protocol",
    "x-customer-id",
    "x-trace-id",
)


def _encode_signature_fields_v2(fields: Sequence[str]) -> bytes:
    """Encode fields without delimiter ambiguity for v2 agent signatures."""
    encoded = bytearray(b"SELLABLE-AGENT-REQUEST\x00v2\x00")
    for field in fields:
        value = field.encode("utf-8")
        if len(value) > 0xFFFFFFFF:
            raise ValueError("HMAC field exceeds the v2 size limit")
        encoded.extend(len(value).to_bytes(4, "big"))
        encoded.extend(value)
    return bytes(encoded)


def _signature_context(request: Request) -> tuple[str, ...]:
    """Read security-affecting headers once and reject duplicate instances."""
    values: list[str] = []
    for name in _SIGNATURE_CONTEXT_HEADERS:
        found = request.headers.getlist(name)
        if len(found) > 1:
            raise HTTPException(status_code=401, detail="Duplicate signed context header")
        values.append(found[0] if found else "")
    return tuple(values)


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

    def __init__(self, ttl_seconds: int = NONCE_TTL_SECONDS) -> None:
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
    # well-known test key. It is additionally disabled when the backend
    # points at a remote database, so a development backend can never use
    # the demo key against shared/production data.
    if settings.is_dev_environment and _database_is_local():
        hashes.add(_DEMO_KEY_HASH)
    return hashes


def _database_is_local() -> bool:
    lowered = (settings.database_url or "").lower()
    if lowered.startswith("sqlite"):
        return True
    return any(
        marker in lowered
        for marker in ("@localhost", "@127.0.0.1", "@::1", "localhost:", "127.0.0.1:")
    )


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
            logger.warning(
                "Agent key store unavailable; env keys only (%s)",
                type(error).__name__,
            )
    if _issued_key_repo is None:
        return None
    try:
        record = _issued_key_repo.get_active_by_hash(key_hash)
    except Exception as error:  # noqa: BLE001 — degrade to env keys
        _issued_key_repo = None
        _issued_key_failed_at = time.time()
        logger.warning("Agent key lookup failed; env keys only (%s)", type(error).__name__)
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
    signature_version: str | None,
) -> AgentApiKey:
    if settings.agent_hmac_secret is None:
        raise HTTPException(status_code=401, detail="HMAC verification is not configured")

    bearer_hash = _sha256(bearer_key)
    # Merchant-issued keys carry their own merchant + buyer scope.
    issued = _lookup_issued_key(bearer_hash)
    if issued is not None:
        issued_merchant = issued.merchant_id
        issued_buyer = issued.buyer_agent_id
    # Constant-time comparison against each configured hash — plain set
    # membership on hex digests would leak a (small) timing signal. Same
    # rule as the static-key path above.
    elif not any(
        hmac.compare_digest(bearer_hash, candidate)
        for candidate in _configured_hashes()
    ):
        raise HTTPException(status_code=403, detail="Invalid agent API key")
    else:
        issued_merchant = _DEMO_MERCHANT_ID
        issued_buyer = None

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

    if abs(time.time() - ts) > NONCE_TTL_SECONDS:
        raise HTTPException(status_code=401, detail="Request timestamp expired")

    body_hash = getattr(request.state, "sellable_body_sha256", "") or ""
    if signature_version == SIGNATURE_VERSION_V2:
        canonical = _encode_signature_fields_v2(
            (
                timestamp,
                nonce,
                agent_id,
                request.method.upper(),
                request.url.path,
                request.url.query,
                body_hash,
                bearer_hash,
                *_signature_context(request),
            )
        )
    elif signature_version in (None, "", "v1") and settings.is_dev_environment:
        # Compatibility for local clients only. Deployed environments never
        # fall back from a missing/legacy marker to ambiguous dotted signing.
        canonical = ".".join(
            [timestamp, nonce, agent_id, request.method, request.url.path, request.url.query, body_hash]
        ).encode("utf-8")
    else:
        raise HTTPException(
            status_code=401,
            detail="Production signed requests require X-Signature-Version: v2",
        )
    expected = hmac.new(
        settings.agent_hmac_secret.encode("utf-8"),
        canonical,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid request signature")

    # The persistent claim is the production replay boundary: process memory
    # cannot protect across restarts or replicas. Claim durably before the
    # local fast-path so production never accepts a signed write on a memory-
    # only guarantee when storage is unavailable.
    nonce_claim = _claim_nonce_persistently(agent_id, nonce)
    if nonce_claim is None:
        raise HTTPException(
            status_code=503,
            detail="Signed request replay protection is temporarily unavailable",
        )
    if not nonce_claim:
        raise HTTPException(status_code=401, detail="Replayed request nonce")
    if not _replay_guard.consume(agent_id, nonce):
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


def _claim_nonce_persistently(agent_id: str, nonce: str) -> bool | None:
    """Return True for a new nonce, False for replay, None when unavailable.

    Memory-only fallback is permitted in development; production callers can
    distinguish store outages from replay attempts and fail closed.
    """
    global _nonce_repo, _nonce_repo_failed_at
    if _nonce_repo is None and time.time() - _nonce_repo_failed_at > 60:
        try:
            from sellable.repositories import NonceRepository

            _nonce_repo = NonceRepository()
        except Exception as error:
            _nonce_repo_failed_at = time.time()
            logger.warning(
                "Nonce store unavailable (%s)", type(error).__name__
            )
    if _nonce_repo is None:
        return True if settings.is_dev_environment else None
    try:
        return _nonce_repo.claim(agent_id, nonce)
    except Exception as error:
        _nonce_repo = None
        _nonce_repo_failed_at = time.time()
        logger.warning("Nonce claim failed (%s)", type(error).__name__)
        return True if settings.is_dev_environment else None


def get_agent_api_key(
    request: Request,
    x_agent_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_nonce: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
    x_signature_version: str | None = Header(default=None),
) -> AgentApiKey:
    """FastAPI dependency that authenticates the calling buyer agent."""
    if x_agent_key:
        return _resolve_static_key(x_agent_key)

    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if not bearer:
        raise HTTPException(status_code=401, detail="Missing agent credentials")
    if len(request.headers.getlist("authorization")) > 1:
        raise HTTPException(status_code=401, detail="Duplicate Authorization header")

    return _resolve_signed_request(
        request=request,
        bearer_key=bearer,
        agent_id=x_agent_id,
        timestamp=x_timestamp,
        nonce=x_nonce,
        signature=x_signature,
        signature_version=x_signature_version,
    )


def get_agent_api_key_signed(
    request: Request,
    x_agent_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_nonce: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
    x_signature_version: str | None = Header(default=None),
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
        x_signature_version=x_signature_version,
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
    bearer_key: str | None = None,
    body: bytes = b"",
    query: str = "",
    signature_version: str = SIGNATURE_VERSION_V2,
    delegation_id: str = "",
    session_id: str = "",
    protocol: str = "",
    customer_id: str = "",
    trace_id: str = "",
) -> str:
    """Compute an agent request HMAC (used by tests and client examples).

    V2 length-prefixes every field and binds the bearer key hash plus
    authorization-context headers. V1 exists only for development/test
    compatibility and is rejected by deployed environments.
    """
    body_hash = hashlib.sha256(body).hexdigest() if body else ""
    if signature_version == SIGNATURE_VERSION_V2:
        if not bearer_key:
            raise ValueError("v2 signatures require the bearer_key being authenticated")
        canonical = _encode_signature_fields_v2(
            (
                timestamp,
                nonce,
                agent_id,
                method.upper(),
                path,
                query,
                body_hash,
                _sha256(bearer_key),
                delegation_id,
                session_id,
                protocol,
                customer_id,
                trace_id,
            )
        )
    elif signature_version == "v1":
        canonical = ".".join(
            [timestamp, nonce, agent_id, method, path, query, body_hash]
        ).encode("utf-8")
    else:
        raise ValueError("unsupported agent signature version")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()

