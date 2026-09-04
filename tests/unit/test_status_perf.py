"""Regression tests for the /agents/status performance fix.

Covers: JWKS single-flight fetch, JWKS cache reuse, local ES256
verification without network, remote-auth-only-as-fallback, non-blocking
LLM probe in status builds, shared single-flight status snapshots with
expiry and no failure poisoning.
"""

import base64
import threading
import time

import pytest
from fastapi import HTTPException

import sellable.merchant_auth as merchant_auth
import sellable.status as status_module
from sellable.config import Settings
from sellable.status import build_status, get_cached_status_snapshot


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


@pytest.fixture
def jwks_module():
    import sellable.supabase_jwt as jwt_module

    saved_cache = dict(jwt_module._jwks_cache)
    saved_inflight = dict(jwt_module._jwks_inflight)
    jwt_module._jwks_cache.clear()
    jwt_module._jwks_inflight.clear()
    try:
        yield jwt_module
    finally:
        jwt_module._jwks_cache.clear()
        jwt_module._jwks_cache.update(saved_cache)
        jwt_module._jwks_inflight.clear()
        jwt_module._jwks_inflight.update(saved_inflight)


def _clear_status_cache():
    status_module._status_snapshots.clear()


@pytest.fixture
def prod_settings(monkeypatch: pytest.MonkeyPatch):
    settings = Settings(
        environment="production",
        supabase_url="https://xyztest.supabase.co",
        supabase_anon_key="anon-test",
    )
    monkeypatch.setattr("sellable.supabase_jwt.settings", settings)
    monkeypatch.setattr("sellable.merchant_auth.settings", settings)
    monkeypatch.setattr("sellable.status.settings", settings)
    return settings


def test_concurrent_jwks_lookup_fetches_once(jwks_module, prod_settings) -> None:
    calls = {"count": 0}

    def slow_fetch():
        calls["count"] += 1
        time.sleep(0.3)
        return {"kid-1": {"kid": "kid-1"}}

    monkeypatch_fetch = jwks_module._fetch_jwks
    jwks_module._fetch_jwks = slow_fetch
    try:
        results = []
        errors = []

        def worker():
            try:
                results.append(jwks_module._get_jwks())
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        assert not errors
        assert len(results) == 10
        assert calls["count"] == 1
        assert all(result == {"kid-1": {"kid": "kid-1"}} for result in results)
    finally:
        jwks_module._fetch_jwks = monkeypatch_fetch


def test_cached_jwks_avoids_network(jwks_module, prod_settings) -> None:
    calls = {"count": 0}

    def counting_fetch():
        calls["count"] += 1
        return {"kid-1": {"kid": "kid-1"}}

    original = jwks_module._fetch_jwks
    jwks_module._fetch_jwks = counting_fetch
    try:
        assert jwks_module._get_jwks() == {"kid-1": {"kid": "kid-1"}}
        assert jwks_module._get_jwks() == {"kid-1": {"kid": "kid-1"}}
        assert calls["count"] == 1
    finally:
        jwks_module._fetch_jwks = original


def _es256_token_and_jwks():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    import jwt as pyjwt

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    numbers = public_key.public_numbers()
    x = _b64url(numbers.x.to_bytes(32, "big"))
    y = _b64url(numbers.y.to_bytes(32, "big"))
    jwk = {"kty": "EC", "crv": "P-256", "x": x, "y": y, "kid": "test-kid-1"}
    now = int(time.time())
    payload = {
        "iss": "https://xyztest.supabase.co/auth/v1",
        "aud": "authenticated",
        "sub": "12345678-1234-1234-1234-123456789012",
        "role": "authenticated",
        "exp": now + 3600,
        "iat": now,
    }
    token = pyjwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "test-kid-1"})
    return token, {"test-kid-1": jwk}


def test_valid_es256_verifies_locally_without_network(jwks_module, prod_settings) -> None:
    token, keys = _es256_token_and_jwks()
    calls = {"online": 0, "fetch": 0}

    def fail_online(_token):
        calls["online"] += 1
        raise AssertionError("remote auth must not run for a valid local token")

    def counting_fetch():
        calls["fetch"] += 1
        return keys

    original_fetch = jwks_module._fetch_jwks
    jwks_module._fetch_jwks = counting_fetch
    original_online = merchant_auth._verify_online
    merchant_auth._verify_online = fail_online
    try:
        payload = merchant_auth.verify_supabase_token(token)
        assert payload["role"] == "authenticated"
        # Second verification reuses the cache: still exactly one fetch.
        merchant_auth.verify_supabase_token(token)
        assert calls == {"online": 0, "fetch": 1}
    finally:
        jwks_module._fetch_jwks = original_fetch
        merchant_auth._verify_online = original_online


def test_remote_auth_runs_only_when_local_verification_fails(
    jwks_module, prod_settings
) -> None:
    def failing_fetch():
        raise HTTPException(status_code=502, detail="JWKS down")

    sentinel = {"sub": "abc", "role": "authenticated"}
    calls = {"online": 0}

    def fake_online(_token):
        calls["online"] += 1
        return sentinel

    original_fetch = jwks_module._fetch_jwks
    jwks_module._fetch_jwks = failing_fetch
    original_online = merchant_auth._verify_online
    merchant_auth._verify_online = fake_online
    try:
        token = "eyJhbGciOiJFUzI1NiIsImtpZCI6ImtpZC0xIn0.eyJzdWIiOiJhYmMifQ.c2ln"
        assert merchant_auth.verify_supabase_token(token) is sentinel
        assert calls["online"] == 1
    finally:
        jwks_module._fetch_jwks = original_fetch
        merchant_auth._verify_online = original_online


def test_status_build_does_not_wait_on_llm_probe(monkeypatch) -> None:
    monkeypatch.setattr(
        status_module,
        "settings",
        Settings(environment="production", llm_provider="openai", openai_api_key="sk-test"),
    )

    class HangingAdapter:
        def probe(self, *, timeout: int = 10) -> None:
            time.sleep(30)

    start = time.perf_counter()
    payload = build_status(
        commerce=None,
        ledger=None,
        seller_agent=None,
        buyer_agent=None,
        gateway=None,
        llm_adapter=HangingAdapter(),
    )
    elapsed = time.perf_counter() - start
    assert elapsed < 5
    assert payload["llm"]["state"] == "CONNECTED"
    assert payload["llm"]["mode"] == "live"


def test_concurrent_status_callers_share_one_build() -> None:
    _clear_status_cache()
    builds = {"count": 0}

    def slow_builder():
        builds["count"] += 1
        time.sleep(0.3)
        return {"ok": True}

    try:
        results = []
        threads = [
            threading.Thread(
                target=lambda: results.append(
                    get_cached_status_snapshot("mrc_x", slow_builder)
                )
            )
            for _ in range(10)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        assert builds["count"] == 1
        assert all(payload == {"ok": True} for payload, _ in results)
        # Second wave hits the warm cache: still exactly one build total.
        assert get_cached_status_snapshot("mrc_x", slow_builder)[1] is True
        assert builds["count"] == 1
    finally:
        _clear_status_cache()


def test_status_cache_expires() -> None:
    _clear_status_cache()
    builds = {"count": 0}

    def builder():
        builds["count"] += 1
        return {"n": builds["count"]}

    try:
        first, cached = get_cached_status_snapshot("mrc_y", builder, ttl_seconds=0.05)
        assert cached is False
        time.sleep(0.08)
        second, cached = get_cached_status_snapshot("mrc_y", builder, ttl_seconds=0.05)
        assert cached is False
        assert second == {"n": 2}
        assert builds["count"] == 2
    finally:
        _clear_status_cache()


def test_status_failure_does_not_poison_cache() -> None:
    _clear_status_cache()
    attempts = {"count": 0}

    def flaky():
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("transient DB outage")
        return {"ok": True}

    try:
        with pytest.raises(RuntimeError):
            get_cached_status_snapshot("mrc_z", flaky)
        payload, cached = get_cached_status_snapshot("mrc_z", flaky)
        assert payload == {"ok": True}
        assert cached is False
        assert attempts["count"] == 2
    finally:
        _clear_status_cache()
