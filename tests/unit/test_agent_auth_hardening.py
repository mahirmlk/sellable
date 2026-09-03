"""Regression tests for the security-subset hardening.

Covers: HMAC-required agent writes outside dev (H9), persistent nonce
replay protection across restarts/replicas (H10), constant-time static-key
comparison without plaintext key_id, owner-only RBAC, HS256 iss/aud
binding, and the dev-environment allowlist.
"""

import hashlib
import hmac as hmac_module
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import sellable.auth as agent_auth
from sellable.auth import _sha256, sign_request
from sellable.config import Settings
from sellable.ledger.database import AgentNonceRecord, Base
from sellable.merchant_auth import MerchantSession, _verify_hs256
from sellable.repositories import NonceRepository

PROD_KEY = "prod-agent-key-001"
PROD_SECRET = "prod-hmac-secret-001"


def prod_settings() -> Settings:
    return Settings(
        environment="production",
        agent_hmac_secret=PROD_SECRET,
        agent_api_key_hashes=(_sha256(PROD_KEY),),
    )


@pytest.fixture
def nonce_engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


def signed_call(nonce_repo, *, nonce: str, key: str = PROD_KEY):
    timestamp = str(int(time.time()))
    signature = sign_request(
        agent_id="buyer_sec_01",
        method="POST",
        path="/agent/orders.create",
        timestamp=timestamp,
        nonce=nonce,
        secret=PROD_SECRET,
        body=b"",
    )
    request = SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/agent/orders.create", query=""),
        state=SimpleNamespace(sellable_body_sha256=""),
    )
    return agent_auth.get_agent_api_key_signed(
        request,
        x_agent_key=None,
        authorization=f"Bearer {key}",
        x_agent_id="buyer_sec_01",
        x_timestamp=timestamp,
        x_nonce=nonce,
        x_signature=signature,
    )


# ---------------------------------------------------------------------------
# H9: static keys cannot write outside dev/test
# ---------------------------------------------------------------------------


def test_static_key_write_rejected_in_production(monkeypatch) -> None:
    monkeypatch.setattr(agent_auth, "settings", prod_settings())
    # A *valid* static key still cannot write without an HMAC signature.
    with pytest.raises(HTTPException) as exc:
        agent_auth.get_agent_api_key_signed(None, x_agent_key=PROD_KEY)
    assert exc.value.status_code == 401
    # The well-known demo key is not even a known key in production.
    with pytest.raises(HTTPException) as exc:
        agent_auth.get_agent_api_key_signed(None, x_agent_key="sellable_demo_key_001")
    assert exc.value.status_code == 403


def test_static_key_write_allowed_in_dev() -> None:
    resolved = agent_auth.get_agent_api_key_signed(None, x_agent_key="sellable_demo_key_001")
    assert resolved.auth_method == "api_key"
    # The plaintext key must not travel in the request-scoped object.
    assert "sellable_demo_key_001" not in resolved.key_id


def test_signed_write_accepted_in_production(monkeypatch, nonce_engine) -> None:
    monkeypatch.setattr(agent_auth, "settings", prod_settings())
    monkeypatch.setattr(agent_auth, "_nonce_repo", NonceRepository(nonce_engine))
    resolved = signed_call(None, nonce=f"n_{uuid4().hex}")
    assert resolved.auth_method == "hmac"
    assert resolved.buyer_agent_id == "buyer_sec_01"


# ---------------------------------------------------------------------------
# H10: nonce replay rejected across restarts (persistent claim)
# ---------------------------------------------------------------------------


def test_nonce_replay_rejected_after_memory_wipe(monkeypatch, nonce_engine) -> None:
    monkeypatch.setattr(agent_auth, "settings", prod_settings())
    monkeypatch.setattr(agent_auth, "_nonce_repo", NonceRepository(nonce_engine))
    nonce = f"n_{uuid4().hex}"
    signed_call(None, nonce=nonce)

    # Same-process replay is caught by memory...
    with pytest.raises(HTTPException):
        signed_call(None, nonce=nonce)

    # ...and a wiped memory guard (restart/replica) is still caught by the DB.
    agent_auth._replay_guard._seen.clear()
    with pytest.raises(HTTPException) as exc:
        signed_call(None, nonce=nonce)
    assert exc.value.status_code == 401


def test_nonce_repository_claim_and_prune(nonce_engine) -> None:
    repo = NonceRepository(nonce_engine)
    assert repo.claim("buyer_a", "nonce_1") is True
    assert repo.claim("buyer_a", "nonce_1") is False
    # Same nonce for a different agent is a different claim.
    assert repo.claim("buyer_b", "nonce_1") is True


# ---------------------------------------------------------------------------
# RBAC: owner-only policy and refunds
# ---------------------------------------------------------------------------


def test_require_owner() -> None:
    from sellable.main import require_owner

    require_owner(
        MerchantSession(merchant_id="m1", auth_user_id="u1", role="owner")
    )
    with pytest.raises(HTTPException) as exc:
        require_owner(
            MerchantSession(merchant_id="m1", auth_user_id="u2", role="operator")
        )
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# HS256: issuer/audience binding
# ---------------------------------------------------------------------------


def _hs256_token(secret: str, payload: dict) -> str:
    def b64(data: bytes) -> str:
        import base64

        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256"}).encode())
    body = b64(json.dumps(payload).encode())
    sig = hmac_module.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{b64(sig)}"


def test_hs256_rejects_wrong_issuer_and_audience(monkeypatch) -> None:
    monkeypatch.setattr(
        "sellable.merchant_auth.settings",
        Settings(
            environment="test",
            supabase_url="https://xyz.supabase.co",
            supabase_jwt_secret="legacy-secret",
        ),
    )
    exp = int(time.time()) + 3600
    bad = _hs256_token(
        "legacy-secret",
        {"role": "authenticated", "exp": exp, "iss": "https://evil.example", "aud": "authenticated"},
    )
    with pytest.raises(HTTPException):
        _verify_hs256(bad)

    good = _hs256_token(
        "legacy-secret",
        {
            "role": "authenticated",
            "exp": exp,
            "iss": "https://xyz.supabase.co/auth/v1",
            "aud": "authenticated",
        },
    )
    assert _verify_hs256(good)["role"] == "authenticated"


# ---------------------------------------------------------------------------
# Dev-environment allowlist (fail-closed on typos like "staging"/"prod")
# ---------------------------------------------------------------------------


def test_dev_environment_allowlist() -> None:
    assert Settings(environment="development").is_dev_environment is True
    assert Settings(environment="test").is_dev_environment is True
    assert Settings(environment="production").is_dev_environment is False
    assert Settings(environment="staging").is_dev_environment is False
    assert Settings(environment="prod").is_dev_environment is False
    assert Settings(environment="Production").is_dev_environment is False
