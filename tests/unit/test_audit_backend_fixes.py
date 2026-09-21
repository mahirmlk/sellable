"""Regression tests for the audit backend fixes.

P2-002: ledger reads are tenant-scoped (cross-tenant colliding trace ids).
P3-01: POST /orders/{id}/refund validates edges like RefundCreateRequest (422).
P3-04: checkout session cart/decision snapshots are size-capped (413).
P3-05: offer parsing clamps to >= 1 paise; model_copy updates re-validate.
P3-06: /health trims origin/environment detail in production.
P3-11: nonce TTLs share one constant; bearer-membership uses compare_digest.
P2-001: startup refuses multi-worker config (guard-only; invariants are
process-memory until DB-backed).
"""

from __future__ import annotations

import inspect
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import sellable.auth as agent_auth
import sellable.main as main_module
import sellable.merchant_auth as merchant_auth
from agents.seller.intent import parse_offer_paise
from sellable.auth import NONCE_TTL_SECONDS, _ReplayGuard, sign_request
from sellable.config import Settings
from sellable.contracts import IntentMandate, LedgerActor, LedgerEvent, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.main import (
    _assert_single_worker,
    _active_sku_from_trace,
    _copy_request_validated,
    _negotiation_aware_request,
    app,
    get_checkout_repo,
)
from sellable.agents.seller import SellerAgent, SellerRequest
from sellable.repositories import CheckoutSessionRepository, NonceRepository

DEMO_H = {"X-Agent-Key": "sellable_demo_key_001"}
FOREIGN_MERCHANT = "mrc_audit_other"


@pytest.fixture
def ledger_engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def two_tenant_cores(ledger_engine):
    """Two merchant cores sharing one ledger (colliding-trace fixture)."""
    ledger = LedgerRepository(ledger_engine)
    core_a = CommerceCore.from_seed(ledger, engine=ledger_engine)
    policy_b = core_a.policy.model_copy(update={"merchant_id": FOREIGN_MERCHANT})
    core_b = CommerceCore(
        catalog=core_a.catalog,
        policy=policy_b,
        ledger=ledger,
        engine=ledger_engine,
        merchant_scope=FOREIGN_MERCHANT,
    )
    return core_a, core_b, ledger


def _record(ledger: LedgerRepository, *, trace_id: str, merchant_id: str,
            action: str, sku: str = "SKU-X") -> None:
    ledger.append(
        LedgerEvent(
            trace_id=trace_id,
            merchant_id=merchant_id,
            actor=LedgerActor.SELLER_AGENT,
            action=action,
            inputs={"sku": sku},
            reasoning_summary="audit fixture",
        )
    )


def _intent() -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_audit_01",
        budget_ceiling_paise=100_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Audit colliding traces",
        expires_at=utc_now() + timedelta(minutes=10),
    )


# ---------------------------------------------------------------------------
# P2-002: tenant-scoped ledger reads
# ---------------------------------------------------------------------------


def test_active_sku_ignores_colliding_foreign_trace(two_tenant_cores) -> None:
    core_a, core_b, ledger = two_tenant_cores
    trace_id = f"trc_{uuid4().hex}"
    # Own event first, foreign collision last: an unscoped reversed() scan
    # would resolve the foreign SKU.
    _record(ledger, trace_id=trace_id, merchant_id=FOREIGN_MERCHANT,
            action="catalog.get", sku="SKU-MINE")
    _record(ledger, trace_id=trace_id, merchant_id=core_a.merchant_scope,
            action="catalog.get", sku="SKU-FOREIGN")
    assert _active_sku_from_trace(core_b, trace_id) == "SKU-MINE"


def test_negotiation_rounds_ignore_colliding_foreign_trace(two_tenant_cores) -> None:
    core_a, core_b, ledger = two_tenant_cores
    trace_id = f"trc_{uuid4().hex}"
    for _ in range(6):  # more than max_negotiation_rounds (5)
        _record(ledger, trace_id=trace_id, merchant_id=core_a.merchant_scope,
                action="negotiation.countered", sku="AUDIO-CASE-01")
    agent = SellerAgent(core_b)
    request = SellerRequest(
        message="would you take it for 100?",
        intent=_intent(),
        requested_sku="AUDIO-CASE-01",
        buyer_offer_paise=100,
    )
    state = {"request": request, "trace_id": trace_id, "tool_calls": []}
    state.update(agent._search_catalog(state))
    out = agent._create_quote(state)
    assert out["candidate_cart"] is not None
    # Foreign counters must not inflate this merchant's round counter.
    assert out["candidate_cart"].negotiation_round == 1


# ---------------------------------------------------------------------------
# P3-01: refund edge validation (422 like the agent path)
# ---------------------------------------------------------------------------


@pytest.fixture
def checkout_client(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    repo = CheckoutSessionRepository(engine)
    monkeypatch.setattr(merchant_auth, "settings", Settings(environment="development"))
    app.dependency_overrides[get_checkout_repo] = lambda: repo
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_refund_short_idempotency_key_is_422(checkout_client: TestClient) -> None:
    response = checkout_client.post(
        "/orders/ord_nope/refund",
        params={"idempotency_key": "short"},
        headers=DEMO_H,
    )
    assert response.status_code == 422


def test_refund_zero_amount_is_422(checkout_client: TestClient) -> None:
    response = checkout_client.post(
        "/orders/ord_nope/refund",
        params={"amount_paise": 0},
        headers=DEMO_H,
    )
    assert response.status_code == 422


def test_refund_empty_and_long_reason_are_422(checkout_client: TestClient) -> None:
    assert checkout_client.post(
        "/orders/ord_nope/refund", params={"reason": ""}, headers=DEMO_H
    ).status_code == 422
    assert checkout_client.post(
        "/orders/ord_nope/refund", params={"reason": "x" * 501}, headers=DEMO_H
    ).status_code == 422


def test_refund_valid_params_reach_service_not_validation(checkout_client: TestClient) -> None:
    # Unknown order: validation passes, the service raises → 400 (not 422).
    response = checkout_client.post(
        "/orders/ord_no_such_order/refund",
        params={"idempotency_key": "idem_audit_valid_0001"},
        headers=DEMO_H,
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# P3-04: checkout snapshot blob caps
# ---------------------------------------------------------------------------


def test_checkout_oversized_cart_is_413(checkout_client: TestClient) -> None:
    response = checkout_client.post(
        "/console/checkout/session",
        json={"buyer_ref": "human_chat", "cart": {"blob": "x" * 40_000}},
        headers=DEMO_H,
    )
    assert response.status_code == 413


def test_checkout_oversized_decision_is_413(checkout_client: TestClient) -> None:
    response = checkout_client.post(
        "/console/checkout/session",
        json={"buyer_ref": "human_chat", "decision": {"blob": "y" * 40_000}},
        headers=DEMO_H,
    )
    assert response.status_code == 413


def test_checkout_small_snapshots_still_save(checkout_client: TestClient) -> None:
    response = checkout_client.post(
        "/console/checkout/session",
        json={
            "buyer_ref": "human_chat",
            "cart": {"items": [{"sku": "X"}], "total_paise": 100},
            "decision": {"verdict": "ALLOW"},
        },
        headers=DEMO_H,
    )
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# P3-05: fail-closed offer amounts
# ---------------------------------------------------------------------------


def test_parse_offer_paise_clamps_to_at_least_one() -> None:
    assert parse_offer_paise("can you do it for ₹0?") == 1
    assert parse_offer_paise("I'll pay 0 rupees") == 1
    # Normal amounts are untouched.
    assert parse_offer_paise("can you do ₹1,300?") == 130_000


def test_negotiation_request_update_revalidates(two_tenant_cores) -> None:
    _, core_b, ledger = two_tenant_cores
    trace_id = f"trc_{uuid4().hex}"
    _record(ledger, trace_id=trace_id, merchant_id=FOREIGN_MERCHANT,
            action="quote.created", sku="AUDIO-CASE-01")
    body = SellerRequest(message="can you do it for ₹0?", intent=_intent())
    routed = _negotiation_aware_request(core_b, body, trace_id)
    assert routed.requested_sku == "AUDIO-CASE-01"
    assert routed.buyer_offer_paise == 1
    # The routed request always satisfies the contract.
    SellerRequest.model_validate(routed.model_dump())


def test_copy_request_validated_fails_closed_to_original() -> None:
    body = SellerRequest(message="hello", intent=_intent())
    # buyer_offer_paise=0 violates gt=0: the original request survives.
    assert _copy_request_validated(body, {"buyer_offer_paise": 0}) is body


# ---------------------------------------------------------------------------
# P3-06: production /health trim
# ---------------------------------------------------------------------------


def test_health_production_hides_origins_and_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        main_module, "settings", Settings(environment="production")
    )
    with TestClient(app) as client:
        body = client.get("/health").json()
    assert body == {"status": "ok", "database": "connected"}
    assert "cors_origins" not in body
    assert "environment" not in body
    assert "razorpay_configured" not in body


def test_health_dev_keeps_full_payload() -> None:
    with TestClient(app) as client:
        body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["environment"] == "development"
    assert isinstance(body["cors_origins"], list)


# ---------------------------------------------------------------------------
# P3-11: aligned nonce TTLs + constant-time bearer comparison
# ---------------------------------------------------------------------------


def test_nonce_ttls_share_one_constant() -> None:
    assert NONCE_TTL_SECONDS == 300
    guard_default = inspect.signature(_ReplayGuard.__init__).parameters[
        "ttl_seconds"
    ].default
    claim_default = inspect.signature(NonceRepository.claim).parameters[
        "ttl_seconds"
    ].default
    assert guard_default == NONCE_TTL_SECONDS
    assert claim_default == NONCE_TTL_SECONDS


def test_signed_request_bearer_membership_uses_compare_digest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import hmac as hmac_stdlib

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    secret = "prod-hmac-secret-audit"
    key = "prod-agent-key-audit"
    monkeypatch.setattr(
        agent_auth,
        "settings",
        Settings(
            environment="production",
            agent_hmac_secret=secret,
            agent_api_key_hashes=(agent_auth._sha256(key),),
        ),
    )
    monkeypatch.setattr(agent_auth, "_nonce_repo", NonceRepository(engine))

    real_compare = hmac_stdlib.compare_digest
    calls: list[tuple[str, str]] = []

    def spy(first: str, second: str) -> bool:
        calls.append((first, second))
        return real_compare(first, second)

    monkeypatch.setattr(agent_auth.hmac, "compare_digest", spy)

    from types import SimpleNamespace

    timestamp = str(int(time.time()))
    nonce = f"n_{uuid4().hex}"
    signature = sign_request(
        agent_id="buyer_audit_01",
        method="POST",
        path="/agent/orders.create",
        timestamp=timestamp,
        nonce=nonce,
        secret=secret,
        body=b"",
    )
    request = SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/agent/orders.create", query=""),
        state=SimpleNamespace(sellable_body_sha256=""),
    )
    resolved = agent_auth.get_agent_api_key_signed(
        request,
        x_agent_key=None,
        authorization=f"Bearer {key}",
        x_agent_id="buyer_audit_01",
        x_timestamp=timestamp,
        x_nonce=nonce,
        x_signature=signature,
    )
    assert resolved.auth_method == "hmac"
    # Membership check + signature check: two constant-time comparisons.
    # (Before the fix the `in` membership check skipped compare_digest.)
    assert len(calls) >= 2


# ---------------------------------------------------------------------------
# P2-001: single-worker startup guard
# ---------------------------------------------------------------------------


def test_startup_allows_single_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)
    assert _assert_single_worker() is None
    monkeypatch.setenv("WEB_CONCURRENCY", "1")
    assert _assert_single_worker() is None


def test_startup_refuses_multi_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    with pytest.raises(RuntimeError, match="Multi-worker startup refused"):
        _assert_single_worker()
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.setenv("UVICORN_WORKERS", "2")
    with pytest.raises(RuntimeError, match="Multi-worker startup refused"):
        _assert_single_worker()


def test_startup_refuses_garbage_worker_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_CONCURRENCY", "many")
    with pytest.raises(RuntimeError, match="not an integer"):
        _assert_single_worker()
