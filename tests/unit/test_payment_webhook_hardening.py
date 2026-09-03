"""Regression tests for the Items 4-7 payment/consent/webhook hardening.

Covers: single-live-link reconcile-then-reuse (H1), atomic consent consume
(H2), payment_link.cancelled parsing (H3), failure-path enum fix (H4),
duplicate-capture flagging (B4), unexpected-state 409s (B3), missing-amount
rejection (B5), persisted delivery claims + retry budgets across restarts
(A3/D4), scoped consent hydration (H5), expiry handling (H6/E2), and
idempotency-key enforcement (A10/A17).
"""

import hashlib
import hmac
import json
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import (
    CartItem,
    CartMandate,
    Consent,
    ConsentStatus,
    IntentMandate,
    OrderStatus,
    PaymentStatus,
    utc_now,
)
from sellable.core import CommerceCore, IdempotencyReuseError
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.orders import InvalidOrderTransitionError
from sellable.payments.razorpay import RazorpayAdapter, RazorpayRequestError
from sellable.payments.service import PaymentService, UnexpectedOrderStateError
from sellable.refunds import RefundService
from sellable.repositories import RefundRepository

ORDER_TOTAL = 69_900


def razorpay_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        razorpay_key_id="rzp_test_sellable",
        razorpay_key_secret="test_key_secret",
        razorpay_webhook_secret="test_webhook_secret",
    )


class FakeRazorpayPaymentLinks:
    def create(self, data: dict[str, object]) -> dict[str, object]:
        assert data["currency"] == "INR"
        return {
            "id": "plink_test_0001",
            "short_url": "https://rzp.io/i/testlink",
            "amount": data["amount"],
            "currency": "INR",
            "status": "created",
            "order_id": "order_razorpay_test_01",
        }


class FakeRazorpayUtility:
    def verify_webhook_signature(self, body: str, signature: str, secret: str) -> bool:
        expected = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            from razorpay.errors import SignatureVerificationError

            raise SignatureVerificationError("signature mismatch")
        return True


class FakeRazorpayRefunds:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.fail_next = False

    def refund(self, payment_id: str, data: dict[str, object]) -> dict[str, object]:
        from razorpay.errors import BadRequestError

        self.calls.append((payment_id, data))
        if self.fail_next:
            self.fail_next = False
            raise BadRequestError("refund failed in test mode")
        return {
            "id": f"rfnd_test_{len(self.calls):04d}",
            "payment_id": payment_id,
            "amount": data["amount"],
            "currency": "INR",
            "status": "processed",
        }


class FakeRazorpayLinkNamespace(FakeRazorpayPaymentLinks):
    def __init__(self) -> None:
        self.cancelled: list[str] = []

    def cancel(self, link_id: str) -> dict[str, object]:
        self.cancelled.append(link_id)
        return {"id": link_id, "status": "cancelled"}


class FakeRazorpayClient:
    def __init__(self) -> None:
        self.payment_link = FakeRazorpayLinkNamespace()
        self.payment = FakeRazorpayRefunds()
        self.utility = FakeRazorpayUtility()


@pytest.fixture
def core_and_engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    return core, engine


@pytest.fixture
def commerce_core(core_and_engine):
    core, _ = core_and_engine
    return core


def make_adapter() -> RazorpayAdapter:
    return RazorpayAdapter(razorpay_settings(), client=FakeRazorpayClient())


def make_intent(budget: int = 100_000) -> IntentMandate:
    return IntentMandate(
        buyer_agent_id="buyer_hardening",
        budget_ceiling_paise=budget,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="Hardening regression run",
        expires_at=utc_now() + timedelta(minutes=10),
    )


def make_cart(*, quantity: int = 1, total: int = ORDER_TOTAL) -> CartMandate:
    unit = total // quantity
    intent_ref = "im_hardening"
    return CartMandate(
        intent_ref=intent_ref,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=quantity,
                unit_price_paise=unit,
                offered_price_paise=unit,
            )
        ],
        subtotal_paise=total,
        discount_paise=0,
        total_paise=total,
        negotiation_round=0,
    )


def start_paid_flow(core: CommerceCore, trace: str, key: str):
    intent = make_intent()
    order = core.create_order(
        cart=make_cart(), intent=intent, trace_id=trace, idempotency_key=key
    )
    consent = core.issue_consent(order.order_id)
    payments = PaymentService(core, make_adapter())
    payments.start_payment(order_id=order.order_id, consent_id=consent.consent_id)
    return order, payments


def signed(payload: dict[str, object]) -> tuple[bytes, str]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(b"test_webhook_secret", body, hashlib.sha256).hexdigest()
    return body, signature


def link_paid(reference_id: str, *, payment_id: str, amount: int) -> dict[str, object]:
    return {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_test_0001",
                    "reference_id": reference_id,
                    "status": "paid",
                }
            },
            "payment": {"entity": {"id": payment_id, "amount": amount, "status": "captured"}},
        },
    }


def failed_payment(order_id: str, *, payment_id: str, amount: int) -> dict[str, object]:
    return {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "order_id": "order_razorpay_test_01",
                    "amount": amount,
                    "status": "failed",
                    "error_description": "Payment declined in test mode",
                }
            }
        },
    }


def ledger_actions(core: CommerceCore, trace_id: str) -> list[str]:
    return [r.action for r in core.ledger.for_trace(trace_id)]


# ---------------------------------------------------------------------------
# H3: payment_link.cancelled carries no payment entity
# ---------------------------------------------------------------------------


def test_link_cancelled_without_payment_entity_fails_order(
    commerce_core: CommerceCore,
) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_cancel", "idem_hardening_cancel_01")
    body, signature = signed(
        {
            "event": "payment_link.cancelled",
            "payload": {
                "payment_link": {
                    "entity": {
                        "id": "plink_test_0001",
                        "reference_id": order.order_id,
                        "status": "cancelled",
                    }
                }
            },
        }
    )

    result = payments.handle_webhook(body, signature)

    assert result.status is PaymentStatus.FAILED
    assert "cancelled" in (result.failure_reason or "")
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED
    actions = ledger_actions(commerce_core, order.trace_id)
    assert "webhook.reconciled" in actions


# ---------------------------------------------------------------------------
# Delivery claims: duplicates collapse, restarts included
# ---------------------------------------------------------------------------


def test_duplicate_delivery_writes_one_reconciled_row(
    commerce_core: CommerceCore,
) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_dupe", "idem_hardening_dupe_01")
    body, signature = signed(
        link_paid(order.order_id, payment_id="pay_dupe_01", amount=ORDER_TOTAL)
    )

    first = payments.handle_webhook(body, signature)
    second = payments.handle_webhook(body, signature)

    assert first.status is PaymentStatus.CAPTURED
    assert second.status is PaymentStatus.CAPTURED
    actions = ledger_actions(commerce_core, order.trace_id)
    assert actions.count("webhook.reconciled") == 1
    assert actions.count("order.paid") == 1


def test_redelivery_after_restart_writes_no_new_rows(
    core_and_engine,
) -> None:
    core, _ = core_and_engine
    order, payments = start_paid_flow(core, "trc_h_restart", "idem_hardening_restart_01")
    body, signature = signed(
        link_paid(order.order_id, payment_id="pay_restart_01", amount=ORDER_TOTAL)
    )
    payments.handle_webhook(body, signature)
    before = ledger_actions(core, order.trace_id)

    # Fresh service = restarted process: no in-memory attempt, delivery set,
    # or retry budget — only the database remains.
    fresh = PaymentService(core, make_adapter())
    replayed = fresh.handle_webhook(body, signature)

    assert replayed.status is PaymentStatus.CAPTURED
    assert ledger_actions(core, order.trace_id) == before
    assert core.get_order(order.order_id).status is OrderStatus.PAID


# ---------------------------------------------------------------------------
# B4: a second DISTINCT capture is flagged, never silently dropped
# ---------------------------------------------------------------------------


def test_second_distinct_capture_is_flagged(commerce_core: CommerceCore) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_dupcap", "idem_hardening_dupcap_01")
    first_body, first_sig = signed(
        link_paid(order.order_id, payment_id="pay_first_01", amount=ORDER_TOTAL)
    )
    payments.handle_webhook(first_body, first_sig)

    second_body, second_sig = signed(
        link_paid(order.order_id, payment_id="pay_second_01", amount=ORDER_TOTAL)
    )
    result = payments.handle_webhook(second_body, second_sig)

    assert result.status is PaymentStatus.CAPTURED
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAID
    actions = ledger_actions(commerce_core, order.trace_id)
    assert "webhook.duplicate_capture" in actions
    # One settlement only — the money trail names both provider payments.
    assert actions.count("webhook.reconciled") == 1
    dup = [
        r
        for r in commerce_core.ledger.for_trace(order.trace_id)
        if r.action == "webhook.duplicate_capture"
    ][0]
    assert dup.provider_ref == "pay_second_01"


# ---------------------------------------------------------------------------
# B3/B5: unexpected states and missing amounts never 500 or settle
# ---------------------------------------------------------------------------


def test_captured_for_failed_order_raises_instead_of_500(
    commerce_core: CommerceCore,
) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_unexp", "idem_hardening_unexp_01")
    fail_body, fail_sig = signed(
        failed_payment(order.order_id, payment_id="pay_unexp_01", amount=ORDER_TOTAL)
    )
    payments.handle_webhook(fail_body, fail_sig)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED

    late_body, late_sig = signed(
        link_paid(order.order_id, payment_id="pay_unexp_01", amount=ORDER_TOTAL)
    )
    with pytest.raises(UnexpectedOrderStateError):
        payments.handle_webhook(late_body, late_sig)

    actions = ledger_actions(commerce_core, order.trace_id)
    assert "webhook.unexpected_state" in actions
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED


def test_captured_without_amount_does_not_settle(
    commerce_core: CommerceCore,
) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_noamt", "idem_hardening_noamt_01")
    payload = link_paid(order.order_id, payment_id="pay_noamt_01", amount=ORDER_TOTAL)
    del payload["payload"]["payment"]["entity"]["amount"]
    body, signature = signed(payload)

    result = payments.handle_webhook(body, signature)

    assert result.status is PaymentStatus.PAYMENT_PENDING
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING
    assert "webhook.amount_mismatch" in ledger_actions(commerce_core, order.trace_id)


# ---------------------------------------------------------------------------
# H1: pre-existing live link is reused, never re-minted
# ---------------------------------------------------------------------------


def test_start_with_live_link_reuses_instead_of_minting(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent()
    order = commerce_core.create_order(
        cart=make_cart(), intent=intent, trace_id="trc_h_reuse", idempotency_key="idem_hardening_reuse_01"
    )
    first_consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(first_consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    commerce_core.attach_provider_refs(
        order.order_id,
        link_id="plink_preseed_01",
        provider_order_id="order_preseed_01",
        payment_url="https://rzp.io/i/preseed",
    )
    # A second consent is issued out-of-band (as a concurrent checkout would
    # hold one) — it must NOT be consumed when a live link already exists.
    spare = Consent(
        order_id=order.order_id,
        amount_paise=order.amount_paise,
        payee_id=order.merchant_id,
        purpose="single_transaction",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    commerce_core.consent_service.issue(spare)

    fresh = PaymentService(commerce_core, make_adapter())
    attempt = fresh.start_payment(order_id=order.order_id, consent_id=spare.consent_id)

    assert attempt.provider_order_id == "plink_preseed_01"
    assert attempt.payment_url == "https://rzp.io/i/preseed"
    assert attempt.status is PaymentStatus.PAYMENT_PENDING
    assert commerce_core.consent_service.get(spare.consent_id).status is ConsentStatus.ISSUED
    assert "payment.attempted" not in ledger_actions(commerce_core, order.trace_id)


# ---------------------------------------------------------------------------
# H2: transition validated before the consent burns
# ---------------------------------------------------------------------------


def test_consume_validates_transition_before_burning_consent(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent()
    order = commerce_core.create_order(
        cart=make_cart(), intent=intent, trace_id="trc_h_burn", idempotency_key="idem_hardening_burn_01"
    )
    first = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(first.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)
    spare = Consent(
        order_id=order.order_id,
        amount_paise=order.amount_paise,
        payee_id=order.merchant_id,
        purpose="single_transaction",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    commerce_core.consent_service.issue(spare)

    with pytest.raises(InvalidOrderTransitionError):
        commerce_core.consume_consent(spare.consent_id, order_id=order.order_id)

    # The spare consent is untouched — the order stays recoverable.
    assert commerce_core.consent_service.get(spare.consent_id).status is ConsentStatus.ISSUED


# ---------------------------------------------------------------------------
# H6/E2: expiry handling
# ---------------------------------------------------------------------------


def test_expired_consent_does_not_block_reissue(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent()
    order = commerce_core.create_order(
        cart=make_cart(), intent=intent, trace_id="trc_h_exp", idempotency_key="idem_hardening_exp_01"
    )
    stale = commerce_core.issue_consent(order.order_id, lifetime_minutes=0)

    fresh = commerce_core.issue_consent(order.order_id)

    assert fresh.consent_id != stale.consent_id
    assert fresh.status is ConsentStatus.ISSUED


def test_expired_consent_flip_is_persisted(commerce_core: CommerceCore) -> None:
    intent = make_intent()
    order = commerce_core.create_order(
        cart=make_cart(), intent=intent, trace_id="trc_h_exp2", idempotency_key="idem_hardening_exp_02"
    )
    stale = commerce_core.issue_consent(order.order_id, lifetime_minutes=0)

    with pytest.raises(Exception, match="expired"):
        commerce_core.consume_consent(stale.consent_id, order_id=order.order_id)

    assert commerce_core.consent_repo.get(stale.consent_id).status is ConsentStatus.EXPIRED


# ---------------------------------------------------------------------------
# H5: consent hydration is merchant-scoped
# ---------------------------------------------------------------------------


def test_consent_hydration_is_merchant_scoped(core_and_engine) -> None:
    core, engine = core_and_engine
    intent = make_intent()
    order = core.create_order(
        cart=make_cart(), intent=intent, trace_id="trc_h_scope", idempotency_key="idem_hardening_scope_01"
    )
    consent = core.issue_consent(order.order_id)

    other_policy = core.policy.model_copy(update={"merchant_id": "mrc_other"})
    other = CommerceCore(
        catalog=core.catalog,
        policy=other_policy,
        ledger=core.ledger,
        engine=engine,
        merchant_scope="mrc_other",
    )

    assert other.consent_service.active_for_order(order.order_id) is None
    with pytest.raises(ValueError, match="Order does not exist"):
        other.get_order(order.order_id)

    # Same-merchant rehydration still sees the consent.
    same = CommerceCore(
        catalog=core.catalog,
        policy=core.policy,
        ledger=core.ledger,
        engine=engine,
        merchant_scope=core.policy.merchant_id,
    )
    assert same.consent_service.active_for_order(order.order_id).consent_id == consent.consent_id


# ---------------------------------------------------------------------------
# A10/A17: idempotency-key enforcement
# ---------------------------------------------------------------------------


def test_idempotency_key_reuse_with_different_amount_raises(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent(budget=200_000)
    commerce_core.create_order(
        cart=make_cart(),
        intent=intent,
        trace_id="trc_h_idem_a",
        idempotency_key="idem_hardening_clash_01",
    )

    with pytest.raises(IdempotencyReuseError, match="different transaction"):
        commerce_core.create_order(
            cart=make_cart(quantity=2, total=2 * ORDER_TOTAL),
            intent=intent,
            trace_id="trc_h_idem_b",
            idempotency_key="idem_hardening_clash_01",
        )


def test_idempotency_replay_with_same_amount_returns_existing(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent()
    first = commerce_core.create_order(
        cart=make_cart(),
        intent=intent,
        trace_id="trc_h_replay_a",
        idempotency_key="idem_hardening_replay_01",
    )
    second = commerce_core.create_order(
        cart=make_cart(),
        intent=intent,
        trace_id="trc_h_replay_b",
        idempotency_key="idem_hardening_replay_01",
    )

    assert second.order_id == first.order_id


# ---------------------------------------------------------------------------
# A3: retry budget comes from the ledger, not process memory
# ---------------------------------------------------------------------------


def test_retry_budget_survives_service_restart(
    commerce_core: CommerceCore,
) -> None:
    order, payments = start_paid_flow(commerce_core, "trc_h_retry", "idem_hardening_retry_01")

    def fail_current(service: PaymentService, payment_id: str) -> None:
        body, signature = signed(
            failed_payment(order.order_id, payment_id=payment_id, amount=ORDER_TOTAL)
        )
        service.handle_webhook(body, signature)
        assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_FAILED

    fail_current(payments, "pay_retry_01")
    payments.retry_payment(order_id=order.order_id)
    assert commerce_core.get_order(order.order_id).status is OrderStatus.PAYMENT_PENDING

    # Fresh service = restarted process with zero in-memory budget.
    fresh = PaymentService(commerce_core, make_adapter())
    fail_current(fresh, "pay_retry_02")
    with pytest.raises(ValueError, match="Retry limit reached"):
        fresh.retry_payment(order_id=order.order_id)

    assert commerce_core.get_order(order.order_id).status is OrderStatus.ABORTED
    assert "retry.aborted" in ledger_actions(commerce_core, order.trace_id)


# ---------------------------------------------------------------------------
# Item 3: refunds move real (test-mode) money through the provider rail
# ---------------------------------------------------------------------------


def settle_paid(core: CommerceCore, trace: str, key: str):
    order, payments = start_paid_flow(core, trace, key)
    body, signature = signed(
        link_paid(order.order_id, payment_id=f"pay_{key}", amount=ORDER_TOTAL)
    )
    payments.handle_webhook(body, signature)
    assert core.get_order(order.order_id).status is OrderStatus.PAID
    return core.get_order(order.order_id)


def refund_service_for(core: CommerceCore, engine, client=None):
    client = client or FakeRazorpayClient()
    rail = RazorpayAdapter(razorpay_settings(), client=client)
    return RefundService(core, rail, RefundRepository(engine)), client


def test_full_refund_calls_provider_and_settles(core_and_engine) -> None:
    core, engine = core_and_engine
    order = settle_paid(core, "trc_h_rf1", "idem_hardening_rf_01")
    refunds, client = refund_service_for(core, engine)

    result = refunds.initiate_refund(order_id=order.order_id, reason="test full refund")

    assert len(client.payment.calls) == 1
    payment_id, data = client.payment.calls[0]
    assert payment_id == f"pay_idem_hardening_rf_01"
    assert data["amount"] == ORDER_TOTAL
    assert result["provider_refund_id"] == "rfnd_test_0001"
    assert result["refund_status"] == "processed"
    assert core.get_order(order.order_id).status is OrderStatus.REFUNDED
    actions = ledger_actions(core, order.trace_id)
    assert "refund.settled" in actions
    stored = RefundRepository(engine).for_idempotency_key(
        order.merchant_id, f"rfnd:{order.order_id}:{ORDER_TOTAL}"
    )
    assert stored is not None and stored.provider_refund_id == "rfnd_test_0001"


def test_refund_is_idempotent_per_key(core_and_engine) -> None:
    core, engine = core_and_engine
    order = settle_paid(core, "trc_h_rf2", "idem_hardening_rf_02")
    refunds, client = refund_service_for(core, engine)

    first = refunds.initiate_refund(
        order_id=order.order_id, reason="x", idempotency_key="idem_hardening_rfk_0001"
    )
    second = refunds.initiate_refund(
        order_id=order.order_id, reason="x", idempotency_key="idem_hardening_rfk_0001"
    )

    assert first["refund_id"] == second["refund_id"]
    assert len(client.payment.calls) == 1


def test_partial_refund_keeps_order_paid(core_and_engine) -> None:
    core, engine = core_and_engine
    order = settle_paid(core, "trc_h_rf3", "idem_hardening_rf_03")
    refunds, client = refund_service_for(core, engine)

    result = refunds.initiate_refund(
        order_id=order.order_id, reason="partial", amount_paise=9_900
    )

    assert result["amount_paise"] == 9_900
    assert core.get_order(order.order_id).status is OrderStatus.PAID
    assert "refund.partial_settled" in ledger_actions(core, order.trace_id)


def test_refund_rejects_unpaid_over_amount_and_missing_payment(
    core_and_engine,
) -> None:
    core, engine = core_and_engine
    intent = make_intent()
    order = core.create_order(
        cart=make_cart(),
        intent=intent,
        trace_id="trc_h_rf4",
        idempotency_key="idem_hardening_rf_04",
    )
    refunds, _ = refund_service_for(core, engine)
    with pytest.raises(ValueError, match="PAID or FULFILLED"):
        refunds.initiate_refund(order_id=order.order_id, reason="x")

    paid = settle_paid(core, "trc_h_rf5", "idem_hardening_rf_05")
    with pytest.raises(ValueError, match="between 1 and"):
        refunds.initiate_refund(
            order_id=paid.order_id, reason="x", amount_paise=ORDER_TOTAL + 1
        )

    # PAID with no recorded provider payment: nothing to refund against.
    ghost_consent = core.issue_consent(order.order_id)
    core.consume_consent(ghost_consent.consent_id, order_id=order.order_id)
    core.mark_payment_pending(order.order_id)
    core.mark_paid(order.order_id, provider_ref="")
    with pytest.raises(ValueError, match="No captured provider payment"):
        refunds.initiate_refund(order_id=order.order_id, reason="x")


def test_refund_provider_failure_records_failed(core_and_engine) -> None:
    core, engine = core_and_engine
    order = settle_paid(core, "trc_h_rf6", "idem_hardening_rf_06")
    refunds, client = refund_service_for(core, engine)
    client.payment.fail_next = True

    with pytest.raises(RazorpayRequestError):
        refunds.initiate_refund(order_id=order.order_id, reason="x")

    assert core.get_order(order.order_id).status is OrderStatus.PAID
    actions = ledger_actions(core, order.trace_id)
    assert "refund.failed" in actions
    assert "refund.settled" not in actions


# ---------------------------------------------------------------------------
# Item 10: fulfillment + abort-from-pending with link cancellation
# ---------------------------------------------------------------------------


def test_fulfill_transitions_paid_and_rejects_others(
    commerce_core: CommerceCore,
) -> None:
    intent = make_intent()
    awaiting = commerce_core.create_order(
        cart=make_cart(),
        intent=intent,
        trace_id="trc_h_ful1",
        idempotency_key="idem_hardening_ful_01",
    )
    with pytest.raises(InvalidOrderTransitionError):
        commerce_core.mark_fulfilled(awaiting.order_id)

    paid = settle_paid(commerce_core, "trc_h_ful2", "idem_hardening_ful_02")
    fulfilled = commerce_core.mark_fulfilled(paid.order_id)
    assert fulfilled.status is OrderStatus.FULFILLED
    assert "order.fulfilled" in ledger_actions(commerce_core, paid.trace_id)


def test_cancel_provider_link_before_abort(core_and_engine) -> None:
    core, engine = core_and_engine
    order, _ = start_paid_flow(core, "trc_h_cxl", "idem_hardening_cxl_01")
    client = FakeRazorpayClient()
    rail = RazorpayAdapter(razorpay_settings(), client=client)
    payments = PaymentService(core, rail)

    assert payments.cancel_provider_link(order.order_id, commerce=core) is True
    assert client.payment_link.cancelled == ["plink_test_0001"]
    assert "payment.link_cancelled" in ledger_actions(core, order.trace_id)

    core.mark_aborted(order.order_id, reason="rejected")
    assert core.get_order(order.order_id).status is OrderStatus.ABORTED

    # No recorded link: nothing to cancel.
    unlinkable = core.create_order(
        cart=make_cart(),
        intent=make_intent(),
        trace_id="trc_h_cxl2",
        idempotency_key="idem_hardening_cxl_02",
    )
    assert payments.cancel_provider_link(unlinkable.order_id, commerce=core) is False
