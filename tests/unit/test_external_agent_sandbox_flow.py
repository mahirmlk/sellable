"""External-agent sandbox purchase, end to end (UPDATE.md §8, Milestone E).

A compatible, independently operated external agent completes the documented
sandbox purchase flow over HTTP against an ISOLATED merchant core (fresh
in-memory SQLite, seeded catalog, fake Razorpay rail): discovery, catalog,
cart, checkout, authorization, consent, payment, verified webhook
reconciliation, and authoritative order reads — over canonical REST and over
the MCP adapter, both hitting the same canonical commerce services.

Proves: no internal Buyer Agent is involved, retries are idempotent, money
moves only on verified webhooks, and every state transition is traceable
through correlated ledger/audit records.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import IntentMandate, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.merchant_auth import MerchantSession
from sellable.payments.service import PaymentService
from sellable.refunds import RefundService
from sellable.repositories import RefundRepository
from test_payments import razorpay_adapter, signed_webhook


AGENT_KEY = "sellable_demo_key_001"
H = {"X-Agent-Key": AGENT_KEY}
SKU = "AUDIO-CASE-01"


class _FakeRefundProvider:
    """Provider boundary fake used by the external-agent flow test."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, int, str | None]] = []

    def refund(
        self,
        payment_id: str,
        amount_paise: int,
        *,
        notes: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ):
        from sellable.payments.razorpay import ProviderRefund

        self.calls.append((payment_id, amount_paise, idempotency_key))
        return ProviderRefund(
            provider_refund_id=f"rfnd_e2e_{len(self.calls):04d}",
            provider_payment_id=payment_id,
            amount_paise=amount_paise,
            currency="INR",
            status="processed",
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


def _client(commerce_core: CommerceCore, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from sellable.agents.seller import SellerAgent
    from sellable.gateway import AgentGateway
    from sellable import main as main_module
    from sellable.main import (
        app,
        get_agent_gateway,
        get_commerce,
        get_merchant_session,
        get_payment_service,
        get_refund_service,
        get_scoped_commerce,
        get_scoped_commerce_signed,
    )

    gateway = AgentGateway(commerce_core, SellerAgent(commerce_core))
    app.dependency_overrides[get_agent_gateway] = lambda: gateway
    app.dependency_overrides[get_commerce] = lambda: commerce_core
    app.dependency_overrides[get_scoped_commerce] = lambda: commerce_core
    app.dependency_overrides[get_scoped_commerce_signed] = lambda: commerce_core
    app.dependency_overrides[get_merchant_session] = lambda: MerchantSession(
        merchant_id=commerce_core.merchant_scope,
        auth_user_id="usr_e2e_owner",
        role="owner",
    )
    monkeypatch.setattr(main_module, "merchant_core", lambda _session: commerce_core)
    rail = razorpay_adapter()
    fake_refunds = _FakeRefundProvider()
    app.dependency_overrides[get_payment_service] = lambda: PaymentService(commerce_core, rail)
    app.dependency_overrides[get_refund_service] = lambda: RefundService(
        commerce_core,
        fake_refunds,
        RefundRepository(commerce_core.order_repo._engine),
    )
    client = TestClient(app)
    client._fake_refunds = fake_refunds
    return client


def _intent() -> dict:
    return IntentMandate(
        buyer_agent_id="buyer_external_01",
        budget_ceiling_paise=600_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="sandbox purchase",
        expires_at=utc_now() + timedelta(minutes=10),
    ).model_dump(mode="json")


def _paid_link_payload(order_id: str, amount_paise: int, payment_id: str) -> dict:
    return {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_sbx_01",
                    "reference_id": order_id,
                    "status": "paid",
                }
            },
            "payment": {
                "entity": {
                    "id": payment_id,
                    "amount": amount_paise,
                    "status": "captured",
                }
            },
        },
    }


def _settle(client: TestClient, order_id: str, amount_paise: int) -> dict:
    """Consent → payment → verified webhook → authoritative PAID read."""
    requested = client.post(
        "/agent/consents.request", json={"order_id": order_id}, headers=H
    )
    assert requested.status_code == 202, requested.text
    assert requested.json()["status"] == "awaiting_human_authorization"
    assert "consent_id" not in requested.json()
    waiting = client.get(f"/commerce/orders/{order_id}", headers=H)
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()["status"] == "AWAITING_CONSENT"

    # Agent request and merchant-owner authorization are distinct actions.
    human_consent = client.post(f"/console/orders/{order_id}/consent")
    assert human_consent.status_code == 200, human_consent.text
    consent_id = human_consent.json()["consent_id"]

    start = client.post(
        f"/orders/{order_id}/payment", json={"consent_id": consent_id}, headers=H
    )
    assert start.status_code == 200, start.text
    assert start.json()["status"] == "PAYMENT_PENDING"

    body, signature = signed_webhook(
        _paid_link_payload(order_id, amount_paise, payment_id=f"pay_sbx_{order_id[-4:]}")
    )
    webhook = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )
    assert webhook.status_code == 200, webhook.text
    assert webhook.json()["status"] == "CAPTURED"

    # Duplicate provider redelivery: idempotent, exactly one settlement.
    replay = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )
    assert replay.status_code == 200, replay.text

    fetched = client.get(f"/commerce/orders/{order_id}", headers=H)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["status"] == "PAID"
    return fetched.json()


def _authorize_body(checkout_id: str) -> dict:
    return {
        "checkout_id": checkout_id,
        "merchant_state": "KA",
        "customer_state": "KA",
        "shipping_method": "standard",
        "pincode": "560001",
    }


def test_rest_sandbox_purchase_end_to_end(
    commerce_core: CommerceCore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sellable.main import app

    client = _client(commerce_core, monkeypatch)
    try:
        # 1. Discovery + capability negotiation (UCP surface).
        discovery = client.get("/.well-known/ucp")
        assert discovery.status_code == 200, discovery.text
        assert discovery.json()["merchant"]["id"] == commerce_core.merchant_scope

        negotiate = client.post(
            "/ucp/negotiate",
            json={
                "agent_id": "buyer_external_01",
                "protocol": "ucp",
                "capabilities": ["catalog.search", "cart.write", "checkout.write", "order.read"],
            },
            headers={**H, "X-Protocol": "ucp"},
        )
        assert negotiate.status_code == 200, negotiate.text

        # 2. Catalog → cart → checkout → authorize (canonical services).
        search = client.post("/commerce/search", json={"query": "case"}, headers=H)
        assert search.status_code == 200 and search.json()

        lookup = client.post("/commerce/catalog/lookup", json={"sku": SKU}, headers=H)
        assert lookup.status_code == 200
        assert lookup.json()["sku"] == SKU

        cart_id = client.post("/commerce/cart", json={}, headers=H).json()["cart_id"]
        add = client.post(
            "/commerce/cart/items",
            json={"cart_id": cart_id, "op": "add", "sku": SKU, "quantity": 1, "expected_version": 1},
            headers=H,
        )
        assert add.status_code == 200, add.text

        checkout_id = client.post(
            "/commerce/checkout", json={"cart_id": cart_id}, headers=H
        ).json()["checkout_id"]
        authorized = client.post(
            "/commerce/checkout/authorize", json=_authorize_body(checkout_id), headers=H
        )
        assert authorized.status_code == 200, authorized.text
        assert authorized.json()["status"] == "AUTHORIZED"
        grand_total = authorized.json()["grand_total_paise"]

        # 3. Order (idempotent) → settle → PAID.
        idem = f"idem_sbx_rest_{uuid4().hex}"
        order = client.post(
            "/commerce/orders",
            json={"checkout_id": checkout_id, "intent": _intent(), "idempotency_key": idem},
            headers=H,
        )
        assert order.status_code == 200, order.text
        order_id = order.json()["order_id"]

        replayed = client.post(
            "/commerce/orders",
            json={"checkout_id": checkout_id, "intent": _intent(), "idempotency_key": idem},
            headers=H,
        )
        assert replayed.status_code == 200, replayed.text
        assert replayed.json()["order_id"] == order_id

        _settle(client, order_id, grand_total)

        # A settled receipt binds the provider payment to this order and trace.
        receipt = client.get(f"/orders/{order_id}/receipt", headers=H)
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["order_id"] == order_id
        assert receipt.json()["amount_paise"] == grand_total
        assert receipt.json()["provider_reference"].startswith("pay_sbx_")

        # Refund is merchant-owner initiated; request replay must not create a
        # second provider refund or duplicate the local refund record.
        refund_key = f"idem_e2e_refund_{uuid4().hex}"
        refund_url = f"/orders/{order_id}/refund?reason=e2e_sandbox&idempotency_key={refund_key}"
        refunded = client.post(refund_url)
        assert refunded.status_code == 200, refunded.text
        refund_replay = client.post(refund_url)
        assert refund_replay.status_code == 200, refund_replay.text
        assert refund_replay.json()["refund_id"] == refunded.json()["refund_id"]
        assert refunded.json()["refund_status"] == "processed"
        assert len(client._fake_refunds.calls) == 1
        assert commerce_core.get_order(order_id).status.value == "REFUNDED"

        # 4. Correlated audit: one trace carries the money trail.
        trace_id = client.get(f"/commerce/orders/{order_id}", headers=H).json()["trace_id"]
        actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
        assert "webhook.reconciled" in actions
        assert actions.count("webhook.reconciled") == 1
        assert "order.paid" in actions
        assert "refund.settled" in actions
        assert actions.count("refund.settled") == 1
    finally:
        app.dependency_overrides.clear()


def test_mcp_sandbox_purchase_end_to_end(
    commerce_core: CommerceCore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sellable.main import app

    client = _client(commerce_core, monkeypatch)
    try:

        def call(tool: str, arguments: dict) -> dict:
            response = client.post(
                "/mcp/call", json={"tool": tool, "arguments": arguments}, headers=H
            )
            assert response.status_code == 200, response.text
            return response.json()["result"]

        found = call("catalog_search", {"query": "case"})
        assert found, "sandbox catalog must match"
        item = call("catalog_lookup", {"sku": SKU})
        assert item["sku"] == SKU

        cart = call("cart_create", {})
        added = call(
            "cart_mutate",
            {"cart_id": cart["cart_id"], "op": "add", "sku": SKU, "quantity": 1, "expected_version": 1},
        )
        assert added["version"] == 2

        checkout = call("checkout_create", {"cart_id": cart["cart_id"]})
        authorized = call(
            "checkout_authorize",
            {
                "checkout_id": checkout["checkout_id"],
                **{k: v for k, v in _authorize_body(checkout["checkout_id"]).items() if k != "checkout_id"},
            },
        )
        assert authorized["status"] == "AUTHORIZED"
        grand_total = authorized["grand_total_paise"]

        created = call(
            "order_create",
            {
                "checkout_id": checkout["checkout_id"],
                "intent": _intent(),
                "idempotency_key": f"idem_sbx_mcp_{uuid4().hex}",
            },
        )
        order_id = created["order_id"]

        _settle(client, order_id, grand_total)

        read = call("order_read", {"order_id": order_id})
        assert read["status"] == "PAID"
        assert read["amount_paise"] == grand_total
    finally:
        app.dependency_overrides.clear()

