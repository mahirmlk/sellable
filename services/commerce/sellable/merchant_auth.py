"""Merchant authentication for the console API (§55.3–§55.5).

Two distinct concerns, strictly separated:

1. **Authentication** — ``get_authenticated_user`` verifies the Supabase
   access token (JWKS / Auth API) and returns the verified user id. It makes
   no statement about what the user may access.

2. **Merchant authorization** — ``get_merchant_session`` resolves the verified
   user to their merchant via the real ``merchant_users`` and ``merchants``
   tables. A user with no mapping gets an explicit onboarding-required error,
   never silent access to demo data.

3. **Development fallback** — when Supabase is not configured at all, the
   demo ``X-Agent-Key`` grants a dev session for the demo merchant so the
   local buildathon flow works without a cloud account. This is impossible in
   production (the environment flag gates it).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

from fastapi import Header, HTTPException

from sellable.auth import _DEMO_KEY_HASH, _sha256
from sellable.config import settings

_DEMO_MERCHANT_ID = "mrc_demo_store"

ONBOARDING_REQUIRED_CODE = "onboarding_required"


@dataclass(frozen=True)
class MerchantSession:
    merchant_id: str
    auth_user_id: str | None
    role: str
    merchant_name: str | None = None


@dataclass(frozen=True)
class AuthenticatedUser:
    auth_user_id: str
    email: str | None = None


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
        # Bounded: this is a recovery fallback, never the hot path — a slow
        # Auth API must fail fast and truthfully, not park the request.
        with urllib.request.urlopen(request, timeout=5) as response:
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
    # Audience/issuer binding, mirroring the ES256 path. Only enforced when
    # the project URL is configured — a secret-only legacy setup cannot know
    # the expected issuer, which is logged so the gap stays visible.
    if settings.supabase_url:
        expected_iss = f"{settings.supabase_url}/auth/v1"
        if payload.get("iss") != expected_iss:
            raise HTTPException(status_code=401, detail="Token issuer mismatch")
        if payload.get("aud") != "authenticated":
            raise HTTPException(status_code=401, detail="Token audience mismatch")
    else:
        logger.warning("HS256 verified without iss/aud binding (SUPABASE_URL unset)")
    return payload


def verify_supabase_token(token: str) -> dict[str, object]:
    """Verify a Supabase access token and return its payload.

    Asymmetric tokens (ES256, RS256, etc.) are verified against the project JWKS.
    HS256 tokens are verified offline only when SUPABASE_JWT_SECRET is configured.
    Online verification via /auth/v1/user remains as a resilient fallback.
    """
    from sellable import supabase_jwt

    try:
        header = supabase_jwt.decode_header(token)
    except HTTPException:
        raise

    alg = (header.get("alg") or "").upper()

    # --- Path 1: asymmetric (ES256 / RS256) → remote JWKS, with online fallback ---
    if alg in supabase_jwt.ASYMMETRIC_ALGS:
        try:
            payload = supabase_jwt.verify_access_token(token)
            logger.info("Token verified via project JWKS (alg=%s)", alg)
            return payload
        except HTTPException as exc:
            # Local verification failed (JWKS unreachable, rotation, etc.).
            # The online Auth API is the official Supabase verification path
            # and remains a resilient fallback — but never silently.
            logger.warning("JWKS verification failed (%s); falling back to online Auth API", exc.detail)

        if settings.supabase_url and settings.supabase_anon_key:
            payload = _verify_online(token)
            logger.info("Token verified via online Auth API (alg=%s)", alg)
            return payload
        raise HTTPException(status_code=401, detail="Local JWT verification failed")

    # --- Path 2: HS256 with configured secret ---
    if alg == "HS256" and settings.supabase_jwt_secret:
        payload = _verify_hs256(token)
        logger.info("Token verified via SUPABASE_JWT_SECRET (HS256)")
        return payload

    # --- Path 3: online verification (fallback when anon key is configured) ---
    if settings.supabase_url and settings.supabase_anon_key:
        payload = _verify_online(token)
        logger.info("Token verified via online Auth API (alg=%s)", alg)
        return payload

    raise HTTPException(status_code=401, detail=f"Unsupported token algorithm: {alg}")


logger = logging.getLogger("sellable.merchant_auth")


def _merchant_record(merchant_id: str) -> tuple[str | None, str | None]:
    """Return (merchant_name, None) if the merchant record exists."""
    from sellable.repositories import MerchantRepository

    record = MerchantRepository().get(merchant_id)
    if record is None:
        return None, None
    return record.name, None


def _resolve_merchant(auth_user_id: str) -> tuple[str, str, str | None]:
    """Look up the merchant account associated with the verified Supabase user.

    Queries the ``merchant_users`` table (direct DB first, PostgREST fallback).
    Returns ``(merchant_id, role, merchant_name)``. Raises an explicit
    onboarding-required error when no real mapping exists — never auto-links.
    """
    from sqlalchemy.orm import Session

    from sellable.ledger.database import MerchantUserRecord, make_engine

    # Step 1: Direct SQL query on merchant_users table
    try:
        engine = make_engine()
        with Session(engine) as session:
            record = session.query(MerchantUserRecord).filter_by(auth_user_id=auth_user_id).first()
            if record:
                name, _ = _merchant_record(record.merchant_id)
                return record.merchant_id, record.role, name
    except Exception as db_err:
        logger.warning("Direct database check for merchant_users failed: %s", db_err)

    # Step 2: Fallback to PostgREST HTTP query with service-role key
    if settings.supabase_url and settings.supabase_service_role_key:
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
            with urllib.request.urlopen(request, timeout=10) as response:
                rows = json.loads(response.read().decode("utf-8"))
                if rows:
                    merchant_id = str(rows[0].get("merchant_id", ""))
                    name, _ = _merchant_record(merchant_id)
                    return merchant_id, str(rows[0].get("role", "operator")), name
        except Exception as http_err:
            logger.warning("PostgREST merchant resolution failed: %s", http_err)

    raise HTTPException(
        status_code=403,
        detail={
            "code": ONBOARDING_REQUIRED_CODE,
            "message": "No merchant account is linked to this user. Please complete merchant onboarding.",
        },
    )


def _dev_session(x_agent_key: str | None) -> MerchantSession:
    if not settings.is_dev_environment:
        raise HTTPException(status_code=401, detail="Merchant authentication is not configured")
    if x_agent_key and _sha256(x_agent_key) in {_DEMO_KEY_HASH}:
        return MerchantSession(merchant_id=_DEMO_MERCHANT_ID, auth_user_id=None, role="owner")
    raise HTTPException(
        status_code=401,
        detail="Merchant authentication is not configured. Send the demo X-Agent-Key header in development.",
    )


def _extract_bearer(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def get_authenticated_user(
    authorization: str | None = Header(default=None),
    x_agent_key: str | None = Header(default=None),
) -> AuthenticatedUser:
    """FastAPI dependency: verify the caller's identity (no authorization claim).

    Used by onboarding: a verified Supabase user may create their own merchant.
    """
    if not settings.supabase_is_configured:
        # Dev-only: the demo key identifies the local developer.
        if x_agent_key and _sha256(x_agent_key) in {_DEMO_KEY_HASH} and settings.is_dev_environment:
            return AuthenticatedUser(auth_user_id="dev_local_user")
        raise HTTPException(status_code=401, detail="Authentication is not configured")

    bearer = _extract_bearer(authorization)
    if not bearer:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    payload = verify_supabase_token(bearer)
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Token has no subject")
    email = payload.get("email") if isinstance(payload.get("email"), str) else None
    return AuthenticatedUser(auth_user_id=sub, email=email)


def get_merchant_session(
    authorization: str | None = Header(default=None),
    x_agent_key: str | None = Header(default=None),
) -> MerchantSession:
    """FastAPI dependency resolving the authenticated + authorized merchant."""
    if not settings.supabase_is_configured:
        return _dev_session(x_agent_key)

    bearer = _extract_bearer(authorization)
    if not bearer:
        raise HTTPException(status_code=401, detail="Missing merchant bearer token")

    payload = verify_supabase_token(bearer)
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Token has no subject")
    merchant_id, role, merchant_name = _resolve_merchant(sub)
    return MerchantSession(
        merchant_id=merchant_id,
        auth_user_id=sub,
        role=role,
        merchant_name=merchant_name,
    )


__all__ = [
    "AuthenticatedUser",
    "MerchantSession",
    "ONBOARDING_REQUIRED_CODE",
    "get_authenticated_user",
    "get_merchant_session",
    "verify_supabase_token",
]
