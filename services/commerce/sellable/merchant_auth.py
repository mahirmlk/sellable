"""Merchant authentication for the console API (§55.3–§55.5).

Two distinct surfaces are supported:

1. Production / demo with Supabase configured — the ``Authorization: Bearer``
   token is a Supabase access token. The project issues ES256 access tokens, so
   asymmetric tokens are verified locally against the project JWKS public keys
   (matching ``kid``); HS256 tokens are verified offline with the Supabase JWT
   secret when configured, and the online Auth API remains as a fallback. The
   ``sub`` claim is resolved to a merchant via the ``merchant_users`` table
   using the service-role key.

2. Development fallback — when Supabase is not configured, an ``X-Agent-Key``
   (the same demo key the console already sends) grants a dev session for the
   demo merchant. This keeps the local buildathon flow working without a cloud
   account while production remains locked down.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

from fastapi import Header, HTTPException

from sellable.auth import _DEMO_KEY_HASH, _sha256
from sellable.config import settings

_DEMO_MERCHANT_ID = "mrc_demo_store"


@dataclass(frozen=True)
class MerchantSession:
    merchant_id: str
    auth_user_id: str | None
    role: str


def _b64decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _verify_online(token: str) -> dict[str, object]:
    """Verify token by asking Supabase Auth directly (no JWT secret needed)."""
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=401, detail="Supabase authentication is not configured")
    url = f"{settings.supabase_url}/auth/v1/user"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            user = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        # Supabase answered: the token (or the project config) is the problem.
        detail = "Invalid or expired Supabase session"
        if error.code in (401, 403):
            detail = (
                "Invalid or expired Supabase session. "
                "If your browser session is valid, check that the backend's "
                "SUPABASE_URL / SUPABASE_ANON_KEY match the frontend's Supabase project."
            )
        raise HTTPException(status_code=401, detail=detail) from error
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise HTTPException(
            status_code=502,
            detail="Supabase auth service is unreachable from the backend",
        ) from error
    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid Supabase session")
    role = user.get("role", "authenticated")
    if role != "authenticated":
        raise HTTPException(status_code=401, detail="Token is not an authenticated user session")
    # Map Auth user shape to JWT-like payload expected downstream
    return {"sub": user["id"], "role": role, "exp": time.time() + 3600, "email": user.get("email")}


def _verify_hs256(token: str) -> dict[str, object]:
    """Offline HS256 verification against ``SUPABASE_JWT_SECRET`` (legacy)."""
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64decode(header_b64))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid token") from None
    if header.get("alg") != "HS256":
        raise HTTPException(status_code=401, detail="Unsupported token algorithm")
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected = hmac.new(
        settings.supabase_jwt_secret.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    try:
        signature = _b64decode(signature_b64)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token") from None
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid token signature")
    try:
        payload = json.loads(_b64decode(payload_b64))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token payload") from None
    expires_at = payload.get("exp")
    if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
        raise HTTPException(status_code=401, detail="Token missing or past its expiry")
    if payload.get("role") != "authenticated":
        raise HTTPException(status_code=401, detail="Token is not an authenticated user session")
    return payload


def verify_supabase_token(token: str) -> dict[str, object]:
    """Verify a Supabase access token and return its payload.

    The production project issues **ES256** access tokens, so asymmetric
    tokens are verified against the project JWKS public keys (matching ``kid``)
    — never against ``SUPABASE_JWT_SECRET``. HS256 tokens are verified offline
    when ``SUPABASE_JWT_SECRET`` is configured; the online Auth API is used as
    a fallback when local verification is impossible or the JWKS is unreachable.
    """
    from sellable import supabase_jwt

    try:
        header = supabase_jwt.decode_header(token)
    except HTTPException:
        raise

    alg = (header.get("alg") or "").upper()
    if alg in supabase_jwt.ASYMMETRIC_ALGS:
        try:
            return supabase_jwt.verify_access_token(token)
        except HTTPException as exc:
            # Infrastructure failure fetching the JWKS -> fall back to online
            # verification; token-rejection (401) always propagates.
            if exc.status_code == 502 and settings.supabase_url and settings.supabase_anon_key:
                return _verify_online(token)
            raise

    if alg == "HS256" and settings.supabase_jwt_secret:
        return _verify_hs256(token)

    if settings.supabase_url and settings.supabase_anon_key:
        return _verify_online(token)
    raise HTTPException(status_code=401, detail="Unsupported token algorithm")


def _resolve_merchant(auth_user_id: str) -> tuple[str, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(status_code=403, detail="Supabase is not fully configured")
    url = (
        f"{settings.supabase_rest_url}/merchant_users"
        f"?auth_user_id=eq.{urllib.parse.quote(auth_user_id)}&select=merchant_id,role"
    )
    request = urllib.request.Request(
        url,
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        raise HTTPException(status_code=502, detail="Could not resolve merchant account") from error
    if not rows:
        raise HTTPException(status_code=403, detail="No merchant account is linked to this user")
    return str(rows[0].get("merchant_id", "")), str(rows[0].get("role", "operator"))


def _dev_session(x_agent_key: str | None) -> MerchantSession:
    if settings.environment == "production":
        raise HTTPException(status_code=401, detail="Merchant authentication is not configured")
    if x_agent_key and _sha256(x_agent_key) in {_DEMO_KEY_HASH}:
        return MerchantSession(merchant_id=_DEMO_MERCHANT_ID, auth_user_id=None, role="owner")
    raise HTTPException(
        status_code=401,
        detail="Merchant authentication is not configured. Send the demo X-Agent-Key header in development.",
    )


def get_merchant_session(
    authorization: str | None = Header(default=None),
    x_agent_key: str | None = Header(default=None),
) -> MerchantSession:
    """FastAPI dependency resolving the authenticated merchant for a console request."""
    if not settings.supabase_is_configured:
        return _dev_session(x_agent_key)

    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if not bearer:
        raise HTTPException(status_code=401, detail="Missing merchant bearer token")

    payload = verify_supabase_token(bearer)
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Token has no subject")
    merchant_id, role = _resolve_merchant(sub)
    if merchant_id != _DEMO_MERCHANT_ID:
        # The buildathon is scoped to a single demo merchant.
        raise HTTPException(status_code=403, detail="Merchant is not authorized for this store")
    return MerchantSession(merchant_id=merchant_id, auth_user_id=sub, role=role)