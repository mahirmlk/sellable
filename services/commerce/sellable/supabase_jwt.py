"""Asymmetric Supabase access-token verification via the project JWKS.

The production Supabase project signs access tokens with **ES256** (EC P-256).
This module fetches the project's public keys from ``/auth/v1/.well-known/jwks.json``,
matches the token's ``kid``, and verifies the JWT signature and claims locally using PyJWT.

The JWKS is cached with a 300s TTL and automatically refreshed on unknown ``kid``
for key rotation. No secrets, access tokens, private keys, or full JWTs are ever logged.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
import urllib.request
from typing import Any

import jwt
from fastapi import HTTPException

from sellable.config import settings

logger = logging.getLogger("sellable.supabase_jwt")

_JWKS_TTL_SECONDS = 300.0
ASYMMETRIC_ALGS = frozenset({"ES256", "ES384", "ES512", "RS256", "RS384", "RS512"})

_jwks_cache: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}
_jwks_lock = threading.Lock()

# Single-flight state: at most one JWKS network fetch per project URL is ever
# in progress; concurrent cache-miss callers wait on the owner's event
# instead of each firing their own fetch (post-deploy stampede guard).
_jwks_inflight: dict[str, dict[str, Any]] = {}


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def decode_header(token: str) -> dict[str, Any]:
    """Decode the JWT header only without verifying signature or logging payload.

    Raises 401 on malformed tokens.
    """
    try:
        header_b64, _, _ = token.split(".")
        header = json.loads(_b64url_decode(header_b64))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid token") from None
    if not isinstance(header, dict):
        raise HTTPException(status_code=401, detail="Invalid token")
    return header


def _fetch_jwks() -> dict[str, dict[str, Any]]:
    """Fetch the project JWKS and return a ``{kid: jwk}`` map."""
    if not settings.supabase_url:
        raise HTTPException(status_code=502, detail="Supabase is not configured")
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    request = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            document = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not fetch Supabase JWKS") from exc

    keys: dict[str, dict[str, Any]] = {}
    for key in document.get("keys", []):
        kid = key.get("kid")
        if kid:
            keys[str(kid)] = key
    if not keys:
        raise HTTPException(status_code=502, detail="Supabase JWKS contains no usable keys")
    return keys


def _get_jwks(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Return cached JWKS, fetching once across concurrent callers.

    Invariant: for a missing/expired entry, exactly one thread performs the
    network fetch while the rest wait on its completion event (bounded wait —
    a stuck owner never parks waiters forever; they retry as new owners).
    """
    url = settings.supabase_url
    for _ in range(2):
        with _jwks_lock:
            cached = _jwks_cache.get(url)
            if not force_refresh and cached and (time.time() - cached[0]) < _JWKS_TTL_SECONDS:
                return cached[1]
            flight = _jwks_inflight.get(url)
            if flight is None:
                flight = {"event": threading.Event(), "keys": None, "error": None}
                _jwks_inflight[url] = flight
                owner = True
            else:
                owner = False
        if owner:
            try:
                keys = _fetch_jwks()
            except Exception as exc:
                with _jwks_lock:
                    flight["error"] = exc
                    del _jwks_inflight[url]
                    flight["event"].set()
                raise
            with _jwks_lock:
                _jwks_cache[url] = (time.time(), keys)
                flight["keys"] = keys
                del _jwks_inflight[url]
                flight["event"].set()
            return keys
        # Waiter: bounded wait, then either share the result or retry once as
        # a potential new owner (owner failure must not wedge us here).
        if not flight["event"].wait(timeout=15):
            continue
        if flight["error"] is None and flight["keys"] is not None:
            return flight["keys"]
        force_refresh = False
    # Two failed rounds: surface a 502 so the caller falls back to the online
    # Auth API path instead of hanging the request.
    raise HTTPException(status_code=502, detail="Could not fetch Supabase JWKS")


def warm_jwks_cache() -> None:
    """Prefetch the JWKS in a daemon thread (startup warm, never blocking).

    After a deploy/restart the first cluster of dashboard requests would
    otherwise compete for the same cold fetch (mitigated by single-flight,
    eliminated here). Failures are logged at debug — a cold cache simply
    means the first request fetches normally.
    """
    if not settings.supabase_url:
        return

    def _warm() -> None:
        try:
            with _jwks_lock:
                cached = _jwks_cache.get(settings.supabase_url)
                if cached and (time.time() - cached[0]) < _JWKS_TTL_SECONDS:
                    return
            _get_jwks()
        except Exception as exc:  # noqa: BLE001 — warm must never raise
            logger.debug("JWKS warm prefetch failed (first request will fetch): %s", exc)

    thread = threading.Thread(target=_warm, name="jwks-warm", daemon=True)
    thread.start()


def verify_access_token(token: str) -> dict[str, Any]:
    """Verify an asymmetric Supabase access token using the project JWKS.

    Steps:
    1. Inspect JWT header (alg, kid).
    2. Retrieve the signing key matching kid from remote JWKS (with caching & rotation).
    3. Verify cryptographic signature and expiration (`exp`).
    4. Validate claims:
       - `iss`: matches Supabase URL (`https://<project-ref>.supabase.co/auth/v1`, `https://<project-ref>.supabase.co`, or `"supabase"`)
       - `aud`: matches `"authenticated"`
       - `sub`: non-empty subject UUID
       - `role`: `"authenticated"`
    """
    header = decode_header(token)
    alg = (header.get("alg") or "").upper()
    if alg not in ASYMMETRIC_ALGS:
        raise HTTPException(status_code=401, detail=f"Unsupported token algorithm: {alg}")

    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        # Supabase always sets kid on asymmetric tokens; a missing kid means we
        # cannot pin the token to a specific public key, so refuse it.
        raise HTTPException(status_code=401, detail="Token header is missing kid")
    logger.debug("Verifying JWT header: alg=%s, kid=%s", alg, kid)

    keys = _get_jwks()
    jwk = keys.get(kid)
    if jwk is None:
        # Unknown kid → key may have been rotated; refresh the cache once.
        keys = _get_jwks(force_refresh=True)
        jwk = keys.get(kid)
    if jwk is None:
        raise HTTPException(status_code=401, detail="Token signing key not found in JWKS")

    try:
        pyjwk = jwt.PyJWK.from_dict(jwk)
        signing_key = pyjwk.key
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid JWK format: {exc}") from exc

    try:
        payload = jwt.decode(
            token,
            key=signing_key,
            algorithms=[alg],
            # PyJWT validates the aud claim when an expected audience is given;
            # without this, a token carrying aud="authenticated" raises
            # InvalidAudienceError and the JWKS path never succeeds.
            audience="authenticated",
            options={"verify_exp": True, "verify_signature": True},
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidSignatureError as exc:
        raise HTTPException(status_code=401, detail="Invalid token signature") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=401, detail=f"Invalid token: {type(exc).__name__}"
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # 1. Verify Issuer — exact match only. A substring check here would accept
    # attacker-controlled issuers such as ``https://<project>.supabase.co.evil.com``.
    base_url = settings.supabase_url.rstrip("/") if settings.supabase_url else ""
    expected_issuer = f"{base_url}/auth/v1" if base_url else None
    token_iss = (payload.get("iss") or "").rstrip("/")
    if expected_issuer and token_iss != expected_issuer:
        raise HTTPException(status_code=401, detail="Invalid token issuer")

    # 2. Verify Audience (defense in depth; PyJWT already validated aud above)
    token_aud = payload.get("aud")
    if isinstance(token_aud, str) and token_aud != "authenticated":
        raise HTTPException(status_code=401, detail="Invalid token audience")
    elif isinstance(token_aud, list) and "authenticated" not in token_aud:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    elif token_aud is None:
        raise HTTPException(status_code=401, detail="Token has no audience claim")

    # 3. Verify Subject
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(status_code=401, detail="Token has no subject")

    # 4. Verify Role
    role = payload.get("role")
    if role != "authenticated":
        raise HTTPException(status_code=401, detail="Token is not an authenticated user session")

    return payload


__all__ = ["ASYMMETRIC_ALGS", "decode_header", "verify_access_token", "warm_jwks_cache"]