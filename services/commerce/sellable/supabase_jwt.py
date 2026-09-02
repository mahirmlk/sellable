"""Asymmetric Supabase access-token verification via the project JWKS.

The production Supabase project signs access tokens with **ES256** (EC P-256).
HS256 verification with ``SUPABASE_JWT_SECRET`` cannot verify those tokens, so
this module fetches the project's public keys from
``/auth/v1/.well-known/jwks.json``, matches the token's ``kid``, and verifies
the JWT signature and claims locally.

The JWKS is cached with a short TTL and refreshed when an unknown ``kid``
appears (key rotation). No secrets, access tokens, private keys, or full JWTs
are ever logged.
"""

from __future__ import annotations

import base64
import json
import threading
import time
import urllib.request
from typing import Any

from fastapi import HTTPException

from sellable.config import settings

_JWKS_TTL_SECONDS = 300.0
ASYMMETRIC_ALGS = frozenset({"ES256", "ES384", "ES512", "RS256", "RS384", "RS512"})

_jwks_cache: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}
_jwks_lock = threading.Lock()


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def decode_header(token: str) -> dict[str, Any]:
    """Decode the JWT header only; raises 401 on a malformed token."""
    try:
        header_b64, _payload_b64, _signature_b64 = token.split(".")
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
    except Exception as exc:  # noqa: BLE001 - surfaced as a 502 upstream
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
    with _jwks_lock:
        cached = _jwks_cache.get(settings.supabase_url)
        if not force_refresh and cached and (time.time() - cached[0]) < _JWKS_TTL_SECONDS:
            return cached[1]
    keys = _fetch_jwks()
    with _jwks_lock:
        _jwks_cache[settings.supabase_url] = (time.time(), keys)
    return keys


def _public_key_from_jwk(jwk: dict[str, Any]):
    """Build a ``cryptography`` public key object from a JWK."""
    from cryptography.hazmat.primitives.asymmetric import ec, rsa

    kty = jwk.get("kty")
    if kty == "EC":
        curves = {
            "P-256": ec.SECP256R1,
            "P-384": ec.SECP384R1,
            "P-521": ec.SECP521R1,
        }
        curve_cls = curves.get(jwk.get("crv"))
        if curve_cls is None:
            raise HTTPException(status_code=401, detail="Unsupported JWT curve")
        x = _b64url_decode(jwk["x"])
        y = _b64url_decode(jwk["y"])
        return ec.EllipticCurvePublicKey.from_encoded_point(curve_cls(), b"\x04" + x + y)
    if kty == "RSA":
        n = int.from_bytes(_b64url_decode(jwk["n"]), "big")
        e = int.from_bytes(_b64url_decode(jwk["e"]), "big")
        return rsa.RSAPublicNumbers(e, n).public_key()
    raise HTTPException(status_code=401, detail="Unsupported JWT signing key type")


def verify_access_token(token: str) -> dict[str, Any]:
    """Verify an asymmetric Supabase access token and return its payload.

    Validates the signature against the JWKS key matching the token's ``kid``,
    then enforces ``exp``, ``iss``, ``sub`` and ``role == authenticated``.

    PyJWT is used only for signature verification (no claim requirements) so
    that missing/unexpected claims surface as clear, separate errors rather
    than a misleading "Invalid token signature".
    """
    import jwt as _jwt

    header = decode_header(token)
    alg = (header.get("alg") or "").upper()
    if alg not in ASYMMETRIC_ALGS:
        raise HTTPException(status_code=401, detail="Unsupported token algorithm")

    kid = header.get("kid")
    keys = _get_jwks()
    jwk = keys.get(kid) if kid else (next(iter(keys.values()), None))
    if jwk is None:
        keys = _get_jwks(force_refresh=True)
        jwk = keys.get(kid) if kid else (next(iter(keys.values()), None))
    if jwk is None:
        raise HTTPException(status_code=401, detail="Token signing key not found in JWKS")

    public_key = _public_key_from_jwk(jwk)
    from cryptography.hazmat.primitives import serialization

    pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    # Verify signature and expiry ONLY — no audience/issuer/subject requirements
    # so PyJWT doesn't mask the real failure with a misleading error message.
    try:
        payload = _jwt.decode(token, key=pem, algorithms=[alg])
    except _jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except _jwt.InvalidSignatureError as exc:
        raise HTTPException(status_code=401, detail="Invalid token signature") from exc
    except _jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=401, detail=f"Invalid token: {type(exc).__name__}"
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    base_url = settings.supabase_url.rstrip("/") if settings.supabase_url else ""
    accepted_issuers = {base_url, f"{base_url}/auth/v1"} if base_url else set()

    if accepted_issuers and payload.get("iss") not in accepted_issuers:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        raise HTTPException(status_code=401, detail="Token has no subject")
    if payload.get("role") != "authenticated":
        raise HTTPException(status_code=401, detail="Token is not an authenticated user session")
    return payload


__all__ = ["ASYMMETRIC_ALGS", "decode_header", "verify_access_token"]