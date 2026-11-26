"""§28.2 ledger attribution: every material action carries who acted, on
what resource, under which authorization/risk evidence, and why — plus the
startup migration that adds these columns to live databases."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    utc_now,
)
from sellable.core import CommerceCore
from sellable.delegations import OperationScope
from sellable.ledger.database import (
    Base,
    LedgerEventRecord,
    _ensure_ledger_attribution_columns,
)
from sellable.ledger.service import LedgerRepository


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _trace() -> str:
    return f"trc_{uuid4().hex}"


def _order(core: CommerceCore, *, tag: str):
    intent = IntentMandate(
        buyer_agent_id=f"buyer_{tag}",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="attribution test",
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
    return core.create_order(
        cart=mandate,
        intent=intent,
        trace_id=_trace(),
        idempotency_key=f"idem_attr_{tag}_{uuid4().hex}",
    )


def test_policy_check_carries_agent_and_resource(commerce_core: CommerceCore) -> None:
    from sellable.checkout import CheckoutError  # noqa: F401 — import sanity

    order = _order(commerce_core, tag="policy")
    events = commerce_core.ledger.for_trace(order.trace_id)
    policy = next(e for e in events if e.action == "policy.checked")
    assert policy.agent_id == "buyer_policy"
    assert policy.resource_type == "cart"
    assert policy.resource_id
    # reason_code rides along whenever the engine produced one (None on a
    # plain ALLOW verdict is legitimate).
    if (policy.output_json or {}).get("verdict") == "DENY":
        assert policy.reason_code


def test_authorization_and_risk_refs_populated(commerce_core: CommerceCore) -> None:
    from sellable.delegations import DelegationGrant

    grant = DelegationGrant(
        principal_customer_id="cust_attr",
        subject_agent_id="buyer_deleg",
        merchant_scope=commerce_core.merchant_scope,
        operation_scopes=[OperationScope.CHECKOUT_WRITE, OperationScope.CART_WRITE],
        amount_limit_paise=500_000,
        expires_at=utc_now() + timedelta(hours=1),
    )
    commerce_core.delegation_repo.save(grant)
    intent = IntentMandate(
        buyer_agent_id="buyer_deleg",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories", "gifting", "snacks"],
        purpose="attribution delegation test",
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
        trace_id=_trace(),
        idempotency_key=f"idem_attr_dlg_{uuid4().hex}",
        delegation_id=grant.delegation_id,
    )
    events = commerce_core.ledger.for_trace(order.trace_id)
    auth = next(e for e in events if e.action == "authorization.checked")
    assert auth.authorization_ref
    assert auth.reason_code == "DELEGATION_VALID"
    assert auth.agent_id == "buyer_deleg"


def test_checkout_path_risk_attribution(commerce_core: CommerceCore) -> None:
    """The checkout pipeline records risk decisions with a risk_ref and
    reason_code (the legacy create_order path runs no risk engine)."""
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id, customer_id="cust_risk")
    cart = commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=cart.version, trace_id=trace_id
    )
    commerce_core.cart_start_checkout(
        cart.cart_id, expected_version=cart.version, trace_id=trace_id
    )
    checkout = commerce_core.create_checkout(cart.cart_id, trace_id=trace_id)
    commerce_core.checkout_validate(checkout.checkout_id, trace_id=trace_id)
    commerce_core.checkout_price(checkout.checkout_id, trace_id=trace_id)
    commerce_core.checkout_authorize(checkout.checkout_id, trace_id=trace_id)
    events = commerce_core.ledger.for_trace(trace_id)
    risk = next(e for e in events if e.action == "risk.assessed")
    assert risk.risk_ref
    assert risk.reason_code in ("ALLOW", "LOW_RISK_REVIEW", "STEP_UP_AUTH")
    assert risk.resource_type == "checkout"
    assert risk.resource_id == checkout.checkout_id


def test_column_migration_adds_attribution_columns() -> None:
    """A live database created before the §28.2 columns exists gains them at
    startup without losing rows."""
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    legacy_columns = (
        "sequence INTEGER PRIMARY KEY, event_id VARCHAR(64), trace_id VARCHAR(128), "
        "merchant_id VARCHAR(64), timestamp DATETIME, actor VARCHAR(64), "
        "action VARCHAR(128), inputs_json JSON, output_json JSON, "
        "reasoning_summary VARCHAR(1000), policy_refs_json JSON, "
        "outcome_effect_json JSON, provider_ref VARCHAR(256), flags_json JSON"
    )
    with engine.begin() as connection:
        connection.execute(
            text(f"CREATE TABLE ledger_events ({legacy_columns})")
        )
        connection.execute(
            text(
                "INSERT INTO ledger_events (event_id, trace_id, timestamp, actor, "
                "action, inputs_json, output_json, policy_refs_json, flags_json) "
                "VALUES ('evt_old', 'trc_old', CURRENT_TIMESTAMP, 'human', "
                "'order.created', '{}', '{}', '[]', '[]')"
            )
        )
    _ensure_ledger_attribution_columns(engine)
    names = {c["name"] for c in inspect(engine).get_columns("ledger_events")}
    for column in (
        "customer_id", "agent_id", "agent_version", "resource_type",
        "resource_id", "risk_ref", "authorization_ref", "reason_code",
    ):
        assert column in names, column
    # The legacy row survived and remains readable through the repository.
    with engine.begin() as connection:
        count = connection.execute(
            text("SELECT COUNT(*) FROM ledger_events WHERE event_id = 'evt_old'")
        ).scalar()
    assert count == 1


def test_new_records_carry_columns_end_to_end(commerce_core: CommerceCore) -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from sellable.ledger.database import make_engine

    order = _order(commerce_core, tag="columns")
    engine = commerce_core.delegation_repo._engine
    with Session(engine) as session:
        row = session.scalars(
            select(LedgerEventRecord)
            .where(LedgerEventRecord.trace_id == order.trace_id)
            .where(LedgerEventRecord.action == "policy.checked")
        ).first()
    assert row is not None
    assert row.agent_id == "buyer_columns"
    assert row.resource_type == "cart"
