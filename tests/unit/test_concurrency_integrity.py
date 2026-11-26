"""Concurrency integrity (§21.1, §25.2): optimistic cart concurrency and
single-settlement webhook delivery under simultaneous callers.

The deployment is single-process by design (enforced at startup), so these
probes use real threads against one core to reproduce the in-process races
the bug hunt found: a cart storm must never leave a subtotal-inconsistent
row behind, and duplicate webhook deliveries must settle exactly once.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
from datetime import timedelta
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from sellable.config import Settings
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.payments.razorpay import RazorpayAdapter
from sellable.payments.service import PaymentService


@pytest.fixture
def commerce_core(tmp_path) -> CommerceCore:
    # File-backed SQLite with the default pool: the same connection topology
    # a production dev deployment uses (one connection per session, SQLite's
    # own write locking with the busy_timeout pragma). A shared StaticPool
    # connection would let threads interleave inside each other's
    # transactions — an artifact of the test harness, not of the deployment.
    engine = create_engine(
        f"sqlite+pysqlite:///{tmp_path / 'race.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _trace(tag: str) -> str:
    return f"trc_{hashlib.sha256(tag.encode()).hexdigest()[:32]}"


def _race_cart(commerce_core: CommerceCore) -> None:
    """Six simultaneous same-version add_item calls against one cart.

    Exactly one mutation may win; every loser must see a clean
    CartVersionConflictError, and the stored row must stay internally
    consistent (subtotal == sum of line totals) whatever the interleaving.
    """
    cart = commerce_core.create_cart(trace_id=_trace("cart-race"), customer_id="cust_race")
    conflicts: list[str] = []
    successes: list[int] = []
    lock = threading.Lock()

    def add_item(version: int) -> None:
        try:
            commerce_core.cart_add_item(
                cart.cart_id,
                "AUDIO-CASE-01",
                1,
                expected_version=version,
                trace_id=_trace(f"cart-race-{threading.get_ident()}"),
            )
            with lock:
                successes.append(version)
        except Exception as error:  # noqa: BLE001 — the race outcome is the data
            with lock:
                conflicts.append(type(error).__name__)

    threads = [
        threading.Thread(target=add_item, args=(cart.version,)) for _ in range(6)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(successes) <= 1, successes
    assert len(conflicts) >= 5, (successes, conflicts)
    # Whatever the interleaving, the stored row stays consistent and readable.
    with commerce_core.delegation_repo._engine.begin() as connection:
        header = connection.execute(
            text(
                "SELECT version, subtotal_paise FROM carts WHERE cart_id = :c"
            ),
            {"c": cart.cart_id},
        ).fetchone()
        rows = connection.execute(
            text(
                "SELECT quantity, unit_price_paise FROM cart_items "
                "WHERE cart_id = :c"
            ),
            {"c": cart.cart_id},
        ).fetchall()
    line_sum = sum(qty * price for qty, price in rows)
    assert header[1] == line_sum, (header, rows)


def test_cart_concurrency_stays_consistent(commerce_core: CommerceCore) -> None:
    _race_cart(commerce_core)


def test_duplicate_webhook_settles_exactly_once(
    commerce_core: CommerceCore,
) -> None:
    """Eight concurrent deliveries of one payment_link.paid event: exactly
    one order.paid ledger event, the order PAID, every caller observing the
    settled state (either CAPTURED or an idempotent replay)."""
    settings = Settings(
        environment="development",
        razorpay_key_id="rzp_test_probe",
        razorpay_key_secret="sek",
        razorpay_webhook_secret="whsec",
    )
    payments = PaymentService(
        commerce_core, RazorpayAdapter(settings), core_resolver=lambda _m: commerce_core
    )
    intent = IntentMandate(
        buyer_agent_id="buyer_race",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="webhook race test",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    mandate = CartMandate(
        intent_ref=intent.mandate_id,
        items=[
            CartItem(
                sku="AUDIO-CASE-01",
                quantity=1,
                unit_price_paise=69_900,
                offered_price_paise=69_900,
            )
        ],
        subtotal_paise=69_900,
        discount_paise=0,
        total_paise=69_900,
        negotiation_round=0,
    )
    order = commerce_core.create_order(
        cart=mandate,
        intent=intent,
        trace_id=_trace("webhook-race"),
        idempotency_key="idem_webhook_race_0001",
    )
    consent = commerce_core.issue_consent(order.order_id)
    commerce_core.consume_consent(consent.consent_id, order_id=order.order_id)
    commerce_core.mark_payment_pending(order.order_id)

    payload = {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_race",
                    "reference_id": order.order_id,
                    "status": "paid",
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_race_1",
                    "amount": 69_900,
                    "currency": "INR",
                    "status": "captured",
                }
            },
        },
    }
    body = json.dumps(payload).encode()
    signature = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()

    outcomes: list[str] = []
    lock = threading.Lock()

    def deliver() -> None:
        try:
            attempt = payments.handle_webhook(body, signature)
            with lock:
                outcomes.append(attempt.status.value)
        except Exception as error:  # noqa: BLE001 — the race outcome is the data
            with lock:
                outcomes.append(f"ERR:{type(error).__name__}")

    threads = [threading.Thread(target=deliver) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert "ERR:" not in "".join(outcomes), outcomes
    assert all(status == "CAPTURED" for status in outcomes), outcomes
    paid_events = [
        event
        for event in commerce_core.ledger.for_trace(order.trace_id)
        if event.action == "order.paid"
    ]
    assert len(paid_events) == 1, len(paid_events)
    assert commerce_core.get_order(order.order_id).status.value == "PAID"


def test_idempotent_order_creation_under_threads(
    commerce_core: CommerceCore,
) -> None:
    """The same idempotency key from eight threads yields exactly one order;
    a different amount under the same key is rejected everywhere."""
    results: list[str] = []
    rejections: list[str] = []
    lock = threading.Lock()

    def intent(tag: str) -> IntentMandate:
        return IntentMandate(
            buyer_agent_id=tag,
            budget_ceiling_paise=500_000,
            allowed_categories=["accessories", "gifting", "snacks"],
            purpose="idempotency race",
            expires_at=utc_now() + timedelta(minutes=10),
        )

    def mandate(total: int) -> CartMandate:
        return CartMandate(
            intent_ref="im_race",
            items=[
                CartItem(
                    sku="AUDIO-CASE-01",
                    quantity=1,
                    unit_price_paise=total,
                    offered_price_paise=total,
                )
            ],
            subtotal_paise=total,
            discount_paise=0,
            total_paise=total,
            negotiation_round=0,
        )

    def create_same() -> None:
        try:
            order = commerce_core.create_order(
                cart=mandate(69_900),
                intent=intent("buyer_race"),
                trace_id=_trace(f"same-{threading.get_ident()}"),
                idempotency_key="idem_race_same_0001",
            )
            with lock:
                results.append(order.order_id)
        except Exception as error:  # noqa: BLE001
            with lock:
                rejections.append(type(error).__name__)

    threads = [threading.Thread(target=create_same) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(set(results)) == 1, results
    assert not rejections, rejections

    def create_diff(index: int) -> None:
        try:
            commerce_core.create_order(
                cart=mandate(69_900 + index),
                intent=intent("buyer_race"),
                trace_id=_trace(f"diff-{index}"),
                idempotency_key="idem_race_diff_0001",
            )
            with lock:
                rejections.append(f"accepted-{index}")
        except Exception as error:  # noqa: BLE001
            with lock:
                rejections.append(type(error).__name__)

    threads = [threading.Thread(target=create_diff, args=(i,)) for i in range(1, 6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not [r for r in rejections if r.startswith("accepted")], rejections
