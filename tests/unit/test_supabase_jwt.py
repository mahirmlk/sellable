"""Tests for asymmetric Supabase access-token verification via the JWKS."""

from __future__ import annotations

import base64
import hashlib
import json
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from sellable import supabase_jwt

ISSUER = "https://test.supabase.co"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _make_es256_jwk(public_key, kid: str) -> dict:
    numbers = public_key.public_numbers()
    x = numbers.x.to_bytes(32, "big")
    y = numbers.y.to_bytes(32, "big")
    return {
        "kty": "EC",
        "crv": "P-256",
        "kid": kid,
        "use": "sig",
        "alg": "ES256",
        "x": _b64url(x),
        "y": _b64url(y),
    }


def _sign_es256(private_key, header: dict, payload: dict) -> str:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives import hashes

    signing_input = (
        _b64url(json.dumps(header).encode()) + "." + _b64url(json.dumps(payload).encode())
    )
    der = private_key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw_signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return signing_input + "." + _b64url(raw_signature)


@pytest.fixture
def es256_keypair():
    from cryptography.hazmat.primitives.asymmetric import ec

    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


@pytest.fixture
def jwks(es256_keypair):
    _private, public = es256_keypair
    return {"kid-1": _make_es256_jwk(public, "kid-1")}


@pytest.fixture
def patched_jwks(monkeypatch: pytest.MonkeyPatch, jwks: dict):
    monkeypatch.setattr(
        supabase_jwt, "settings", SimpleNamespace(supabase_url=ISSUER)
    )
    monkeypatch.setattr(supabase_jwt, "_get_jwks", lambda force_refresh=False: jwks)
    return jwks


def _payload(**overrides) -> dict:
    data = {
        "iss": f"{ISSUER}/auth/v1",
        "sub": "user-123",
        "role": "authenticated",
        "aud": "authenticated",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    data.update(overrides)
    return data


def test_valid_es256_token_verifies(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "kid-1"}, _payload()
    )
    result = supabase_jwt.verify_access_token(token)
    assert result["sub"] == "user-123"
    assert result["role"] == "authenticated"


def test_tampered_signature_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "kid-1"}, _payload()
    )
    header, payload, _sig = token.split(".")
    forged = f"{header}.{payload}.{'A' * 86}"
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(forged)
    assert exc.value.status_code == 401


def test_unknown_kid_forces_refresh(monkeypatch: pytest.MonkeyPatch, es256_keypair) -> None:
    private, public = es256_keypair
    original_jwks = {"kid-1": _make_es256_jwk(public, "kid-1")}
    rotated_jwks = {"kid-2": _make_es256_jwk(public, "kid-2")}
    state = {"keys": original_jwks}

    def fake_get_jwks(force_refresh: bool = False) -> dict:
        if force_refresh:
            state["keys"] = rotated_jwks
        return state["keys"]

    monkeypatch.setattr(supabase_jwt, "settings", SimpleNamespace(supabase_url=ISSUER))
    monkeypatch.setattr(supabase_jwt, "_get_jwks", fake_get_jwks)

    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "kid-2"}, _payload()
    )
    result = supabase_jwt.verify_access_token(token)
    assert result["sub"] == "user-123"


def test_expired_token_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        _payload(exp=int(time.time()) - 60),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_wrong_issuer_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        _payload(iss="https://evil.example.com"),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_issuer_substring_attack_is_rejected(es256_keypair, patched_jwks) -> None:
    """An issuer that merely *contains* the project URL must not pass."""
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        _payload(iss=f"{ISSUER}.evil.com/auth/v1"),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_missing_audience_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    payload = _payload()
    payload.pop("aud")
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        payload,
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_wrong_audience_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        _payload(aud="evil-audience"),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_missing_kid_is_rejected(es256_keypair, patched_jwks) -> None:
    """A token without kid cannot be pinned to a JWKS key and must be refused."""
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT"},
        _payload(),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_unknown_kid_is_rejected_when_rotation_does_not_help(
    monkeypatch: pytest.MonkeyPatch, es256_keypair
) -> None:
    """If the refreshed JWKS still lacks the kid, the token is refused."""
    private, public = es256_keypair
    jwks = {"kid-1": _make_es256_jwk(public, "kid-1")}
    monkeypatch.setattr(supabase_jwt, "settings", SimpleNamespace(supabase_url=ISSUER))
    monkeypatch.setattr(supabase_jwt, "_get_jwks", lambda force_refresh=False: jwks)

    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "kid-rogue"}, _payload()
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_non_authenticated_role_is_rejected(es256_keypair, patched_jwks) -> None:
    private, _public = es256_keypair
    token = _sign_es256(
        private,
        {"alg": "ES256", "typ": "JWT", "kid": "kid-1"},
        _payload(role="anon"),
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_alg_none_is_rejected(patched_jwks) -> None:
    token = (
        _b64url(b'{"alg":"none","typ":"JWT"}')
        + "."
        + _b64url(json.dumps(_payload()).encode())
        + "."
    )
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token(token)
    assert exc.value.status_code == 401


def test_malformed_token_is_rejected(patched_jwks) -> None:
    with pytest.raises(HTTPException) as exc:
        supabase_jwt.verify_access_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_merchant_auth_verifies_asymmetric_token(
    es256_keypair, monkeypatch: pytest.MonkeyPatch, jwks: dict
) -> None:
    """Verify the full merchant-auth entrypoint routes ES256 to the JWKS."""
    import sellable.merchant_auth as merchant_auth

    monkeypatch.setattr(
        merchant_auth, "settings", SimpleNamespace(
            supabase_url=ISSUER,
            supabase_anon_key="anon",
            supabase_service_role_key="svc",
            supabase_jwt_secret=None,
        )
    )
    monkeypatch.setattr(
        supabase_jwt, "settings", SimpleNamespace(supabase_url=ISSUER)
    )
    monkeypatch.setattr(supabase_jwt, "_get_jwks", lambda force_refresh=False: jwks)

    private, _public = es256_keypair
    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "kid-1"}, _payload()
    )
    result = merchant_auth.verify_supabase_token(token)
    assert result["sub"] == "user-123"
    assert result["role"] == "authenticated"


def test_merchant_auth_falls_back_to_online_on_local_failure(
    es256_keypair, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When local JWKS verification fails, merchant_auth falls back to /auth/v1/user."""
    import sellable.merchant_auth as merchant_auth

    monkeypatch.setattr(
        merchant_auth, "settings", SimpleNamespace(
            supabase_url=ISSUER,
            supabase_anon_key="anon",
            supabase_service_role_key="svc",
            supabase_jwt_secret=None,
        )
    )
    # Force local verification to fail by returning no matching JWKS
    monkeypatch.setattr(supabase_jwt, "_get_jwks", lambda force_refresh=False: {})

    online_called = {"called": False}

    def fake_online(token):
        online_called["called"] = True
        return {"sub": "online-user", "role": "authenticated", "exp": 9999999999}

    monkeypatch.setattr(merchant_auth, "_verify_online", fake_online)

    # Any ES256 token — local verification will fail (no JWKS key), but online should succeed
    private, _public = es256_keypair
    token = _sign_es256(
        private, {"alg": "ES256", "typ": "JWT", "kid": "missing-kid"}, _payload()
    )
    result = merchant_auth.verify_supabase_token(token)
    assert result["sub"] == "online-user"
    assert online_called["called"]