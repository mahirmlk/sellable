"""Phase 8: second payment rail (Stripe test mode), carrier adapters,
billing meter, and the fail-closed admin surface."""

from __future__ import annotations

import hashlib
import hmac
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.connectors.shipping import (
    GenericHttpCarrier,
    ManualCarrier,
    carrier_for,
)
from sellable.contracts import FulfillmentStatus
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments import PaymentProvider, build_provider
from sellable.payments.simulated import SimulatedPaymentAdapter
from sellable.payments.stripe import (
    InvalidStripeSignatureError,
    StripeAdapter,
    StripeConfigurationError,
)


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _stripe_config(**overrides):
    base = {
        "stripe_secret_key": "sk_test_123",
        "stripe_webhook_secret": "whsec_123",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _fake_transport(calls: list):
    def transport(method: str, url: str, form: dict, headers: dict) -> dict:
        calls.append({"method": method, "url": url, "form": form})
        if url.endswith("/payment_intents"):
            return {
                "id": "pi_test_1",
                "amount": int(form["amount"]),
                "currency": "inr",
                "status": "requires_payment_method",
            }
        if url.endswith("/prices"):
            return {"id": "price_test_1"}
        if url.endswith("/payment_links"):
            return {"id": "plink_test_1", "url": "https://pay.stripe.com/test_1", "active": True}
        if url.endswith("/refunds"):
            return {
                "id": "re_test_1",
                "amount": int(form["amount"]),
                "currency": "inr",
                "status": "succeeded",
            }
        if "/payment_links/" in url:
            return {"id": "plink_test_1", "active": False}
        raise AssertionError(f"unexpected call {method} {url}")

    return transport


# --- Provider protocol ---------------------------------------------------------------------


def test_all_adapters_satisfy_the_protocol() -> None:
    from sellable.payments.razorpay import RazorpayAdapter

    assert isinstance(RazorpayAdapter(SimpleNamespace()), PaymentProvider)
    assert isinstance(StripeAdapter(_stripe_config()), PaymentProvider)
    assert isinstance(SimulatedPaymentAdapter(), PaymentProvider)


def test_factory_selection() -> None:
    config = SimpleNamespace(payment_provider="stripe")
    assert isinstance(build_provider(config), StripeAdapter)
    assert build_provider(SimpleNamespace()).provider_name == "razorpay"
    assert build_provider(SimpleNamespace(payment_provider="simulated")).provider_name == (
        "simulated"
    )


# --- Stripe --------------------------------------------------------------------------------------


def test_stripe_order_link_refund_cancel() -> None:
    from sellable.contracts import Order, OrderStatus

    calls: list = []
    adapter = StripeAdapter(_stripe_config(), transport=_fake_transport(calls))
    order = Order(
        trace_id=f"trc_{uuid4().hex}",
        quote_id="quo_1",
        buyer_agent_id="buyer_1",
        merchant_id="mrc_test",
        amount_paise=69_900,
        idempotency_key="idem_stripe_0000000001",
    )
    provider_order = adapter.create_order(order)
    assert provider_order.provider_order_id == "pi_test_1"
    assert provider_order.amount_paise == 69_900
    link = adapter.create_payment_link(order)
    assert link.short_url.startswith("https://pay.stripe.com/")
    refund = adapter.refund("pi_test_1", 1_000)
    assert refund.provider_refund_id == "re_test_1"
    adapter.cancel_payment_link("plink_test_1")
    assert calls[-1]["url"].endswith("/payment_links/plink_test_1")
    _ = OrderStatus


def test_stripe_signature_and_config() -> None:
    adapter = StripeAdapter(_stripe_config())
    body = b'{"id":"evt_test","type":"payment_intent.succeeded"}'
    timestamp = int(time.time())

    def sign(secret: str) -> str:
        digest = hmac.new(
            secret.encode(), f"{timestamp}.{body.decode()}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"t={timestamp},v1={digest}"

    adapter.verify_webhook(body, sign("whsec_123"))  # no raise
    with pytest.raises(InvalidStripeSignatureError):
        adapter.verify_webhook(body, sign("whsec_wrong"))
    with pytest.raises(InvalidStripeSignatureError):
        adapter.verify_webhook(body, None)
    with pytest.raises(StripeConfigurationError):
        StripeAdapter(_stripe_config(stripe_secret_key=None)).validate_configuration()
    with pytest.raises(StripeConfigurationError, match="Live"):
        StripeAdapter(_stripe_config(stripe_secret_key="sk_live_x")).validate_configuration()


def test_stripe_webhook_route() -> None:
    import sellable.main as main_module
    from fastapi.testclient import TestClient
    from sellable.config import Settings

    main_module.app.dependency_overrides.clear()
    monkey_settings = Settings(
        environment="development",
        stripe_secret_key="sk_test_123",
        stripe_webhook_secret="whsec_123",
    )
    original = main_module.settings
    main_module.settings = monkey_settings
    client = TestClient(main_module.app)
    try:
        body = b'{"id":"evt_test","type":"charge.refunded"}'
        timestamp = int(time.time())
        digest = hmac.new(
            b"whsec_123", f"{timestamp}.{body.decode()}".encode(), hashlib.sha256
        ).hexdigest()
        ignored = client.post(
            "/webhooks/stripe",
            content=body,
            headers={
                "Stripe-Signature": f"t={timestamp},v1={digest}",
                "Content-Type": "application/json",
            },
        )
        assert ignored.status_code == 200
        assert ignored.json()["status"] == "ignored"

        bad = client.post(
            "/webhooks/stripe",
            content=body,
            headers={"Stripe-Signature": "t=1,v1=bad"},
        )
        assert bad.status_code == 401
    finally:
        main_module.settings = original
        main_module.app.dependency_overrides.clear()
        client.close()


# --- Carriers ----------------------------------------------------------------------------------------


def test_manual_carrier_label() -> None:
    label = ManualCarrier().create_shipment(
        order_id="ord_1", merchant_id="mrc_1", method="standard",
        destination_pincode="560001",
    )
    assert label.tracking_reference.startswith("trk_")
    assert label.carrier == "manual"
    with pytest.raises(Exception, match="no live tracking"):
        ManualCarrier().fetch_tracking("trk_x")
    assert carrier_for("manual").name == "manual"
    with pytest.raises(ValueError):
        carrier_for("teleport")


def test_http_carrier_with_fake_fetcher() -> None:
    carrier = GenericHttpCarrier(
        base_url="https://carrier.example.com",
        api_secret="s3cret",
        carrier_name="acme",
        fetcher=lambda *, method, path, payload: {
            "tracking_reference": "ACME123",
        }
        if path == "/shipments"
        else {"status": "in_transit", "location": "Hub"},
    )
    label = carrier.create_shipment(
        order_id="ord_1", merchant_id="mrc_1", method="express",
        destination_pincode="400001",
    )
    assert label.tracking_reference == "ACME123"
    status, location = carrier.fetch_tracking("ACME123")
    assert status == FulfillmentStatus.IN_TRANSIT
    assert location == "Hub"


def test_fulfillment_label_issuance(commerce_core: CommerceCore) -> None:
    from datetime import timedelta

    from sellable.contracts import (
        CartItem,
        CartMandate,
        IntentMandate,
        ShippingMethod,
        utc_now,
    )

    core = commerce_core
    intent = IntentMandate(
        buyer_agent_id="buyer_label",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="label test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01", quantity=1,
                unit_price_paise=69_900, offered_price_paise=69_900,
            )
        ],
        subtotal_paise=69_900, discount_paise=0, total_paise=69_900,
        negotiation_round=0,
    )
    order = core.create_order(
        cart=mandate, intent=intent, trace_id=f"trc_{uuid4().hex}",
        idempotency_key=f"idem_label_{uuid4().hex}",
    )
    consent = core.issue_consent(order.order_id)
    core.consume_consent(consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="pay_label_1")
    fulfillment = core.create_fulfillment(
        order.order_id, ShippingMethod.STANDARD,
        trace_id=f"trc_{uuid4().hex}", issue_label=True, pincode="560001",
    )
    assert fulfillment.tracking_reference.startswith("trk_")
    assert fulfillment.carrier == "manual"


# --- Billing + admin --------------------------------------------------------------------------------------


def test_billing_summary(commerce_core: CommerceCore) -> None:
    from sellable.platform_billing import resolve_plan, summarize_usage
    from sellable.repositories import ObservabilityRepository

    core = commerce_core
    summary = summarize_usage(
        order_repo=core.order_repo,
        observability_repo=ObservabilityRepository(engine=core.outbox_repo._engine),
        ledger=core.ledger,
        merchant_id=core.merchant_scope,
        plan=resolve_plan(core.merchant_scope),
    )
    assert summary["plan"] == "FREE"
    assert summary["usage"]["orders"] == 0
    assert summary["over_quota"] is False
    assert summary["quotas"]["orders_per_month"] == 100
    assert resolve_plan("mrc_x", override="growth") == "GROWTH"
    assert resolve_plan("mrc_x", override="nope") == "FREE"


def test_admin_surface_fail_closed() -> None:
    import sellable.main as main_module
    from fastapi.testclient import TestClient

    main_module.app.dependency_overrides.clear()
    client = TestClient(main_module.app)
    try:
        for path in ("/admin/overview", "/admin/merchants", "/admin/incidents"):
            response = client.get(path)
            assert response.status_code == 404, path
    finally:
        client.close()
        main_module.app.dependency_overrides.clear()


def test_admin_with_key() -> None:
    import sellable.main as main_module
    from fastapi.testclient import TestClient
    from sellable.config import Settings

    original = main_module.settings
    main_module.settings = Settings(environment="development", admin_api_key="adm-123")
    client = TestClient(main_module.app)
    try:
        headers = {"X-Admin-Key": "adm-123"}
        overview = client.get("/admin/overview", headers=headers)
        assert overview.status_code == 200, overview.text
        assert "merchants" in overview.json()
        merchants = client.get("/admin/merchants", headers=headers)
        assert merchants.status_code == 200
        incidents = client.get("/admin/incidents", headers=headers)
        assert incidents.status_code == 200, incidents.text
        assert set(incidents.json()) == {"fraud", "risk_blocks", "dead_letters"}
        wrong = client.get("/admin/overview", headers={"X-Admin-Key": "nope"})
        assert wrong.status_code == 404
    finally:
        main_module.settings = original
        client.close()
        main_module.app.dependency_overrides.clear()
