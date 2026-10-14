"""Live readiness evidence + protocol versioning + ACP scaffold tests.

Phase 6 (UPDATE.md §10, Milestone F): readiness reflects validated
credentials and observed webhook state (not mere config presence), live
blockers are explicit, protocol versions are pinned, and the ACP scaffold
stays disabled-by-default with honest non-claims.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from sellable import main as main_module
from sellable import merchant_auth
from sellable.config import Settings
from sellable.contracts import Checkout, CheckoutLine, CheckoutStatus, IntentMandate, utc_now
from sellable.ledger import database as ledger_database
from sellable.ledger.service import LedgerRepository
from sellable.merchant_auth import AuthenticatedUser, MerchantSession
from sellable.payments import provider_is_valid
from sellable.protocols import acp as acp_adapter
from sellable.protocols.acp import AcpAuthError, AcpError
from sellable.registry import MerchantRegistry


@pytest.fixture()
def isolated_env(monkeypatch, tmp_path):
    """Temp SQLite DB + patched engines + overridden auth dependencies."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    ledger_database.Base.metadata.create_all(engine)

    monkeypatch.setattr(ledger_database, "make_engine", lambda config=None: engine)
    import sellable.registry as registry_mod
    import sellable.repositories as repositories_mod

    monkeypatch.setattr(repositories_mod, "make_engine", lambda: engine)
    monkeypatch.setattr(registry_mod, "make_engine", lambda config=None: engine)

    test_registry = MerchantRegistry(ledger=LedgerRepository(engine), engine=engine)
    test_registry.ensure_demo_merchant()
    monkeypatch.setattr(main_module, "registry", test_registry)

    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))

    client = TestClient(main_module.app)
    yield client, engine, test_registry
    client.close()
    main_module.app.dependency_overrides.clear()
    engine.dispose()


DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}


def _override_as(app, merchant_id: str, role: str = "owner"):
    user = AuthenticatedUser(auth_user_id=f"usr_{uuid4().hex[:10]}")
    session = MerchantSession(
        merchant_id=merchant_id, auth_user_id=user.auth_user_id, role=role
    )
    app.dependency_overrides[merchant_auth.get_merchant_session] = lambda: session
    app.dependency_overrides[merchant_auth.get_authenticated_user] = lambda: user
    return session


def _clear(app):
    app.dependency_overrides.clear()


# --- Credential validation -------------------------------------------------


def test_provider_is_valid_variants():
    valid_rzp = Settings(
        environment="test",
        payment_provider="razorpay",
        razorpay_key_id="rzp_test_123",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="whsec",
    )
    assert provider_is_valid(valid_rzp) is True

    # Present but wrong-mode keys are NOT valid.
    live_rzp = Settings(
        environment="test",
        payment_provider="razorpay",
        razorpay_key_id="rzp_live_123",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="whsec",
    )
    assert provider_is_valid(live_rzp) is False

    # Missing keys are NOT valid.
    assert provider_is_valid(Settings(environment="test")) is False

    valid_stripe = Settings(
        environment="test",
        payment_provider="stripe",
        stripe_secret_key="sk_test_123",
        stripe_webhook_secret="whsec_123",
    )
    assert provider_is_valid(valid_stripe) is True

    live_stripe = Settings(
        environment="test",
        payment_provider="stripe",
        stripe_secret_key="sk_live_123",
        stripe_webhook_secret="whsec_123",
    )
    assert provider_is_valid(live_stripe) is False


# --- Readiness evidence + live blockers ------------------------------------


def test_readiness_reports_evidence_and_blockers(isolated_env, monkeypatch):
    client, engine, registry = isolated_env
    original = main_module.settings
    main_module.settings = Settings(
        environment="development",
        payment_provider="razorpay",
        razorpay_key_id="rzp_test_123",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="whsec",
    )
    _override_as(main_module.app, "mrc_demo_store")
    try:
        r = client.get("/console/onboarding/readiness", headers=DEMO_H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["checks"]["payment_health"] is True
        assert body["evidence"]["provider"] == "razorpay"
        assert body["evidence"]["payment_credentials_valid"] is True
        assert body["evidence"]["webhook_last_verified_at"] is None
        assert "payment_health" not in body["live_blockers"]
    finally:
        main_module.settings = original
        _clear(main_module.app)


def test_readiness_flags_invalid_credentials(isolated_env, monkeypatch):
    client, engine, registry = isolated_env
    original = main_module.settings
    # Keys present but wrong mode: payment_health must fail validation.
    main_module.settings = Settings(
        environment="development",
        payment_provider="razorpay",
        razorpay_key_id="rzp_live_123",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="whsec",
    )
    _override_as(main_module.app, "mrc_demo_store")
    try:
        r = client.get("/console/onboarding/readiness", headers=DEMO_H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["checks"]["payment_health"] is False
        assert body["evidence"]["payment_credentials_valid"] is False
        assert "payment_health" in body["live_blockers"]
    finally:
        main_module.settings = original
        _clear(main_module.app)


# --- UCP version pin --------------------------------------------------------


def test_ucp_discovery_pins_version_and_reference(isolated_env):
    client, engine, registry = isolated_env
    r = client.get("/.well-known/ucp")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["ucp_version"] == "ucp-1"
    assert doc["ucp_spec_reference"].startswith("https://ucp.dev/")


# --- ACP scaffold ------------------------------------------------------------


def _authorized_checkout():
    return Checkout(
        checkout_id="co_acp_test_0001",
        merchant_id="mrc_demo_store",
        cart_id="cart_acp_01",
        cart_version=2,
        lines=[CheckoutLine(sku="AUDIO-CASE-01", quantity=1, unit_price_paise=69900)],
        subtotal_paise=69900,
        tax_total_paise=12582,
        shipping_total_paise=4900,
        grand_total_paise=87382,
        status=CheckoutStatus.AUTHORIZED,
        price_hash="ph_acp_test",
        authorization_id="auth_acp_test",
        expires_at=utc_now() + timedelta(minutes=30),
    )


def test_acp_session_mapping_requires_authorized():
    session = acp_adapter.build_checkout_session(_authorized_checkout())
    assert session["session_id"] == "co_acp_test_0001"
    assert session["status"] == "authorized"
    assert session["totals"]["grand_total_paise"] == 87382
    assert session["price_hash"] == "ph_acp_test"
    assert session["items"] == [
        {"sku": "AUDIO-CASE-01", "quantity": 1, "unit_price_paise": 69900}
    ]

    draft = _authorized_checkout().model_copy(update={"status": CheckoutStatus.PRICED})
    with pytest.raises(AcpError):
        acp_adapter.build_checkout_session(draft)


def test_acp_signature_verification():
    secret = "acp_test_secret"
    body = b'{"checkout_id":"co_1"}'
    timestamp = str(int(time.time()))
    nonce = "n_acp_01"
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = ".".join([timestamp, nonce, "agent_acp", "POST", "/acp/checkout/sessions", body_hash])
    signature = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    assert (
        acp_adapter.verify_signed_request(
            body=body, timestamp=timestamp, nonce=nonce, signature=signature,
            secret=secret, agent_id="agent_acp", method="POST",
            path="/acp/checkout/sessions",
        )
        == "agent_acp"
    )
    with pytest.raises(AcpAuthError):
        acp_adapter.verify_signed_request(
            body=body, timestamp=timestamp, nonce=nonce, signature="bad",
            secret=secret, agent_id="agent_acp", method="POST",
            path="/acp/checkout/sessions",
        )
    with pytest.raises(AcpAuthError):
        acp_adapter.verify_signed_request(
            body=body, timestamp="1", nonce=nonce, signature=signature,
            secret=secret, agent_id="agent_acp", method="POST",
            path="/acp/checkout/sessions",
        )


def test_acp_status_and_disabled_route(isolated_env):
    client, engine, registry = isolated_env
    original = main_module.settings
    main_module.settings = Settings(environment="development")
    try:
        assert main_module.settings.acp_enabled is False
        status = client.get("/acp/status")
        assert status.status_code == 200, status.text
        assert status.json()["enabled"] is False
        assert "placement" in status.json()["note"].lower() or "partner" in status.json()["note"].lower()

        gated = client.post(
            "/acp/checkout/sessions", json={"checkout_id": "co_x"}, headers=DEMO_H
        )
        assert gated.status_code == 501, gated.text
        assert gated.json()["detail"]["code"] == "acp_disabled"
    finally:
        main_module.settings = original


def test_acp_route_serves_authorized_checkout(isolated_env):
    from sellable.main import get_commerce

    client, engine, registry = isolated_env
    original = main_module.settings
    main_module.settings = Settings(environment="development", acp_enabled=True)
    main_module.app.dependency_overrides[get_commerce] = lambda: registry.get("mrc_demo_store")
    try:
        # Drive the canonical flow to AUTHORIZED on the isolated demo core.
        cart_id = client.post("/commerce/cart", json={}, headers=DEMO_H).json()["cart_id"]
        add = client.post(
            "/commerce/cart/items",
            json={"cart_id": cart_id, "op": "add", "sku": "AUDIO-CASE-01",
                  "quantity": 1, "expected_version": 1},
            headers=DEMO_H,
        )
        assert add.status_code == 200, add.text
        checkout_id = client.post(
            "/commerce/checkout", json={"cart_id": cart_id}, headers=DEMO_H
        ).json()["checkout_id"]
        authorized = client.post(
            "/commerce/checkout/authorize",
            json={"checkout_id": checkout_id, "merchant_state": "KA",
                  "customer_state": "KA", "shipping_method": "standard",
                  "pincode": "560001"},
            headers=DEMO_H,
        )
        assert authorized.status_code == 200, authorized.text

        session = client.post(
            "/acp/checkout/sessions", json={"checkout_id": checkout_id}, headers=DEMO_H
        )
        assert session.status_code == 200, session.text
        body = session.json()
        assert body["status"] == "authorized"
        assert body["totals"]["grand_total_paise"] == authorized.json()["grand_total_paise"]

        # Unknown checkouts stay invisible (no cross-tenant oracle).
        missing = client.post(
            "/acp/checkout/sessions", json={"checkout_id": "co_missing"}, headers=DEMO_H
        )
        assert missing.status_code == 404
    finally:
        main_module.settings = original
