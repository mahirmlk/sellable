"""Tests for the resumable buyer-mission continuation (post-approval flow).

Covers the acceptance invariants: approval unblocks the SAME order, consent
is reused (never duplicated while valid) and re-issued when expired,
payment goes through the EXISTING PaymentService exactly once, only the
signed webhook settles the order, and the buyer verifies read-only.
"""

import hashlib
import hmac
import json
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine

from sellable.agents.buyer import BuyerAction, BuyerAgent
from sellable.agents.seller import SellerAgent
from sellable.buyer_missions import (
    BuyerMissionService,
    UnknownBuyerMissionError,
)
from sellable.contracts import (
    BuyerMission,
    BuyerMissionState,
    ConsentStatus,
    OrderStatus,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.gateway import AgentGateway
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments.razorpay import RazorpayAdapter
from sellable.payments.service import PaymentService

CATEGORIES = ["accessories", "gifting", "snacks"]
WEBHOOK_SECRET = "test_webhook_secret"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class FakeRazorpayPaymentLinks:
    def __init__(self) -> None:
        self.created = 0

    def create(self, data: dict[str, object]) -> dict[str, object]:
        self.created += 1
        return {
            "id": f"plink_test_{self.created:04d}",
            "short_url": f"https://rzp.io/i/testlink{self.created}",
            "amount": data["amount"],
            "currency": "INR",
            "status": "created",
            "order_id": f"order_razorpay_test_{self.created:04d}",
        }


class FakeRazorpayUtility:
    def verify_webhook_signature(self, body: str, signature: str, secret: str) -> bool:
        expected = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            import razorpay.errors

            raise razorpay.errors.SignatureVerificationError("signature mismatch")
        return True


class FakeRazorpayClient:
    def __init__(self) -> None:
        self.payment_link = FakeRazorpayPaymentLinks()
        self.utility = FakeRazorpayUtility()


@pytest.fixture
def core_and_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
    return core, engine


@pytest.fixture
def mission_service(core_and_engine) -> BuyerMissionService:
    _, engine = core_and_engine
    return BuyerMissionService(engine=engine)


@pytest.fixture
def payments(core_and_engine) -> PaymentService:
    core, _ = core_and_engine
    settings = type(core).__mro__[0]  # unused; adapter built explicitly below
    from sellable.config import Settings

    adapter = RazorpayAdapter(
        Settings(
            environment="test",
            database_url="sqlite+pysqlite:///:memory:",
            razorpay_key_id="rzp_test_sellable",
            razorpay_key_secret="test_key_secret",
            razorpay_webhook_secret=WEBHOOK_SECRET,
        ),
        client=FakeRazorpayClient(),
    )
    return PaymentService(core, adapter)


@pytest.fixture
def buyer(core_and_engine) -> BuyerAgent:
    core, _ = core_and_engine
    return BuyerAgent(AgentGateway(core, SellerAgent(core)))


def hitl_mission(**overrides) -> BuyerMission:
    fields: dict[str, object] = {
        "buyer_agent_id": "buyer_missions_test",
        "message": "I need a workday gift box",
        "budget_ceiling_paise": 300_000,
        "allowed_categories": CATEGORIES,
        "purpose": "Mission continuation test",
        "expires_at": utc_now() + timedelta(minutes=10),
        "requested_sku": "GIFT-BOX-01",  # 249_900 > 200_000 HITL threshold
        "quantity": 1,
    }
    fields.update(overrides)
    return BuyerMission(**fields)  # type: ignore[arg-type]


def new_trace() -> str:
    return f"trc_{uuid4().hex}"


def signed_webhook(payload: dict[str, object]) -> tuple[bytes, str]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return body, signature


def captured_event(order, provider_link_id: str) -> dict[str, object]:
    return {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_test_capture_01",
                    "order_id": provider_link_id,
                    "status": "captured",
                    "amount": order.amount_paise,
                }
            }
        },
    }


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def test_hitl_run_persists_mission_pointing_at_same_order(
    core_and_engine, buyer, mission_service
) -> None:
    core, _ = core_and_engine
    trace = new_trace()
    result = buyer.run(hitl_mission(), trace_id=trace)

    assert result.action is BuyerAction.NEEDS_HUMAN_APPROVAL
    assert result.order_id is not None
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    assert mission_id is not None

    order = core.get_order(result.order_id)
    assert order.requires_approval is True

    # Repeated run under the same trace updates the SAME mission row.
    again = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    assert again == mission_id

    snapshot = mission_service.snapshot(
        core=core, mission_id=mission_id, merchant_id=core.merchant_scope
    )
    assert snapshot.state is BuyerMissionState.NEEDS_HUMAN_APPROVAL
    assert snapshot.required_action == "merchant_approval"
    assert snapshot.order_id == result.order_id
    assert snapshot.trace_id == trace


def test_non_order_run_is_not_persisted(core_and_engine, buyer, mission_service) -> None:
    core, _ = core_and_engine
    result = buyer.run(
        hitl_mission(budget_ceiling_paise=1_000, requested_sku=None), trace_id=new_trace()
    )
    assert result.action is BuyerAction.DENIED
    assert (
        mission_service.record_run(
            merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
        )
        is None
    )


# ---------------------------------------------------------------------------
# Continuation guards
# ---------------------------------------------------------------------------


def test_continue_blocked_before_approval(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )

    snapshot = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    assert snapshot.state is BuyerMissionState.NEEDS_HUMAN_APPROVAL
    assert snapshot.required_action == "merchant_approval"
    assert snapshot.consent_id is None
    # No payment activity may exist pre-approval.
    assert core.ledger.count_actions(result.trace_id, "payment.attempted") == 0


def test_unknown_or_foreign_mission_is_invisible(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    with pytest.raises(UnknownBuyerMissionError):
        mission_service.continue_mission(
            core=core,
            payments=payments,
            mission_id=mission_id,
            merchant_id="mrc_someone_else",
        )


# ---------------------------------------------------------------------------
# Approval → consent → payment continuation
# ---------------------------------------------------------------------------


def test_continue_after_approval_starts_payment_exactly_once(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    order_id = result.order_id

    core.approve_order(order_id)
    consent = core.issue_consent(order_id)
    mission_service.note_approval(
        merchant_id=core.merchant_scope, order_id=order_id, consent_id=consent.consent_id
    )

    first = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    assert first.state is BuyerMissionState.PAYMENT_PENDING
    assert first.required_action == "await_webhook"
    assert first.payment_url is not None
    assert first.consent_id == consent.consent_id  # SAME consent, reused
    order = core.get_order(order_id)
    assert order.status is OrderStatus.PAYMENT_PENDING
    assert order.provider_link_id == "plink_test_0001"

    # Repeated continuation (double click / refresh) must not duplicate.
    second = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )
    assert second.state is BuyerMissionState.PAYMENT_PENDING
    assert second.payment_url == first.payment_url

    attempts = core.ledger.for_trace(result.trace_id)
    assert sum(1 for e in attempts if e.action == "payment.attempted") == 1
    assert sum(1 for e in attempts if e.action == "consent.issued") == 1
    assert sum(1 for e in attempts if e.action == "consent.used") == 1


def test_continue_reuses_valid_consent_without_reissue(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    order_id = result.order_id

    # Directly-approved path (no HITL): consent issued up front by the agent.
    core.approve_order(order_id)
    consent = core.issue_consent(order_id)

    mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    events = core.ledger.for_trace(result.trace_id)
    assert sum(1 for e in events if e.action == "consent.issued") == 1
    assert core.consent_service.get(consent.consent_id).status is ConsentStatus.USED


def test_continue_reissues_expired_consent(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    order_id = result.order_id

    core.approve_order(order_id)
    stale = core.issue_consent(order_id)
    expired = stale.model_copy(update={"status": ConsentStatus.EXPIRED})
    core.consent_service._consents[stale.consent_id] = expired

    snapshot = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    assert snapshot.state is BuyerMissionState.PAYMENT_PENDING
    assert snapshot.consent_id != stale.consent_id
    events = core.ledger.for_trace(result.trace_id)
    issued = [e for e in events if e.action == "consent.issued"]
    assert len(issued) == 2  # the expired one + the fresh valid one
    assert core.get_order(order_id).status is OrderStatus.PAYMENT_PENDING


def test_rejected_mission_never_pays(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    core.mark_aborted(result.order_id, reason="Order rejected by merchant via console.")

    snapshot = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    assert snapshot.state is BuyerMissionState.ABORTED
    assert core.ledger.count_actions(result.trace_id, "payment.attempted") == 0


# ---------------------------------------------------------------------------
# Webhook settlement → buyer verification
# ---------------------------------------------------------------------------


def test_webhook_settles_then_snapshot_verifies_once(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    order_id = result.order_id

    core.approve_order(order_id)
    consent = core.issue_consent(order_id)
    payments.start_payment(order_id=order_id, consent_id=consent.consent_id)

    # Not paid yet: the mission must NOT claim success.
    pending = mission_service.snapshot(
        core=core, mission_id=mission_id, merchant_id=core.merchant_scope, buyer_agent=buyer
    )
    assert pending.state is BuyerMissionState.PAYMENT_PENDING

    order = core.get_order(order_id)
    body, signature = signed_webhook(captured_event(order, order.provider_order_id))
    payments.handle_webhook(body, signature)

    verified = mission_service.snapshot(
        core=core, mission_id=mission_id, merchant_id=core.merchant_scope, buyer_agent=buyer
    )
    assert verified.state is BuyerMissionState.VERIFIED
    assert core.get_order(order_id).status is OrderStatus.PAID
    assert core.ledger.count_actions(result.trace_id, "buyer.payment_verified") == 1

    # Repeat reads stay idempotent — no duplicate verification events.
    mission_service.snapshot(
        core=core, mission_id=mission_id, merchant_id=core.merchant_scope, buyer_agent=buyer
    )
    assert core.ledger.count_actions(result.trace_id, "buyer.payment_verified") == 1


def test_continue_after_settlement_verifies_without_new_payment(
    core_and_engine, buyer, mission_service, payments
) -> None:
    core, _ = core_and_engine
    result = buyer.run(hitl_mission(), trace_id=new_trace())
    mission_id = mission_service.record_run(
        merchant_id=core.merchant_scope, mission=hitl_mission(), result=result
    )
    order_id = result.order_id

    core.approve_order(order_id)
    consent = core.issue_consent(order_id)
    attempt = payments.start_payment(order_id=order_id, consent_id=consent.consent_id)

    order = core.get_order(order_id)
    body, signature = signed_webhook(captured_event(order, order.provider_order_id))
    payments.handle_webhook(body, signature)

    snapshot = mission_service.continue_mission(
        core=core,
        payments=payments,
        mission_id=mission_id,
        merchant_id=core.merchant_scope,
        buyer_agent=buyer,
    )

    assert snapshot.state is BuyerMissionState.VERIFIED
    assert snapshot.payment_url == attempt.payment_url
    assert core.ledger.count_actions(result.trace_id, "payment.attempted") == 1
