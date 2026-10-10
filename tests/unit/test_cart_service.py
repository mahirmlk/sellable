"""Phase 2a: persistent, versioned carts (target §18.2, §21.1, §39.2).

Covers the CartService domain rules, the compare-and-swap repository,
and the CommerceCore delegates (ledger + outbox fan-out).
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.cart import (
    CartNotFoundError,
    CartService,
    CartStateError,
    CartVersionConflictError,
)
from sellable.contracts import CartStatus, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.repositories import CartRepository, OutboxRepository


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


def _service(core: CommerceCore) -> CartService:
    return core.cart_service


# --- Creation and reads ------------------------------------------------------


def test_create_and_get_cart(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(
        commerce_core.merchant_scope,
        customer_id="cust_1",
        agent_session_id="sess_1",
    )
    assert cart.status == CartStatus.ACTIVE
    assert cart.version == 1
    assert cart.items == []
    assert cart.grand_total_paise == 0
    assert cart.expires_at > utc_now()

    loaded = service.get_cart(cart.cart_id, commerce_core.merchant_scope)
    assert loaded.cart_id == cart.cart_id
    assert loaded.customer_id == "cust_1"

    with pytest.raises(CartNotFoundError):
        service.get_cart(cart.cart_id, "mrc_other")
    with pytest.raises(CartNotFoundError):
        service.get_cart("cart_missing", commerce_core.merchant_scope)


# --- Mutations: server-side pricing -------------------------------------------


def test_add_item_snapshots_catalog_price(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    updated = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 2, expected_version=1
    )
    assert updated.version == 2
    assert len(updated.items) == 1
    assert updated.items[0].sku == "AUDIO-CASE-01"
    assert updated.items[0].unit_price_paise == 69_900
    assert updated.subtotal_paise == 139_800
    assert updated.grand_total_paise == 139_800


def test_add_item_accumulates_quantity(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
    )
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 2, expected_version=2
    )
    assert cart.items[0].quantity == 3
    assert cart.version == 3


def test_unknown_sku_rejected_at_cart_boundary(
    commerce_core: CommerceCore,
) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    with pytest.raises(CartStateError, match="Unknown SKU"):
        service.add_item(
            cart.cart_id,
            commerce_core.merchant_scope,
            "NOPE-00",
            1,
            expected_version=1,
        )


def test_insufficient_stock_rejected(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    with pytest.raises(CartStateError, match="insufficient stock"):
        service.add_item(
            cart.cart_id,
            commerce_core.merchant_scope,
            "AUDIO-CASE-01",
            46,  # seed stock is 45; under the per-line cap of 100
            expected_version=1,
        )


def test_set_quantity_and_remove(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 2, expected_version=1
    )
    cart = service.set_quantity(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=2
    )
    assert cart.items[0].quantity == 1
    assert cart.grand_total_paise == 69_900
    cart = service.set_quantity(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 0, expected_version=3
    )
    assert cart.items == []
    assert cart.grand_total_paise == 0
    with pytest.raises(CartStateError):
        service.remove_item(
            cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", expected_version=4
        )


# --- Optimistic concurrency ----------------------------------------------------


def test_stale_version_conflicts(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
    )
    with pytest.raises(CartVersionConflictError):
        service.add_item(
            cart.cart_id,
            commerce_core.merchant_scope,
            "GIFT-BOX-01",
            1,
            expected_version=1,  # stale: cart is now at version 2
        )
    # The failed write changed nothing; the current version still works.
    cart = service.get_cart(cart.cart_id, commerce_core.merchant_scope)
    assert cart.version == 2
    updated = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "GIFT-BOX-01", 1, expected_version=2
    )
    assert updated.version == 3
    assert len(updated.items) == 2


# --- Status machine (§39.2) ------------------------------------------------------


def test_checkout_locks_and_releases(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    with pytest.raises(CartStateError, match="empty cart"):
        service.start_checkout(cart.cart_id, commerce_core.merchant_scope, expected_version=1)
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
    )
    cart = service.start_checkout(
        cart.cart_id, commerce_core.merchant_scope, expected_version=2
    )
    assert cart.status == CartStatus.CHECKOUT_STARTED
    with pytest.raises(CartStateError, match="not mutable"):
        service.add_item(
            cart.cart_id, commerce_core.merchant_scope, "GIFT-BOX-01", 1, expected_version=3
        )
    cart = service.release_checkout(
        cart.cart_id, commerce_core.merchant_scope, expected_version=3
    )
    assert cart.status == CartStatus.ACTIVE
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "GIFT-BOX-01", 1, expected_version=4
    )
    assert len(cart.items) == 2


def test_convert_and_terminal_states(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
    )
    with pytest.raises(CartStateError):
        service.mark_converted(cart.cart_id, commerce_core.merchant_scope, expected_version=2)
    cart = service.start_checkout(
        cart.cart_id, commerce_core.merchant_scope, expected_version=2
    )
    cart = service.mark_converted(
        cart.cart_id, commerce_core.merchant_scope, expected_version=3
    )
    assert cart.status == CartStatus.CONVERTED
    with pytest.raises(CartStateError):
        service.add_item(
            cart.cart_id, commerce_core.merchant_scope, "GIFT-BOX-01", 1, expected_version=4
        )


def test_expiry_and_sweep(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(
        commerce_core.merchant_scope, ttl=timedelta(seconds=-1)
    )
    with pytest.raises(CartStateError, match="expired"):
        service.add_item(
            cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
        )
    swept = service.expire_due(commerce_core.merchant_scope)
    assert swept == 1
    reloaded = service.get_cart(cart.cart_id, commerce_core.merchant_scope)
    assert reloaded.status == CartStatus.EXPIRED


def test_refresh_prices_detects_stale_snapshot(
    commerce_core: CommerceCore,
) -> None:
    service = _service(commerce_core)
    cart = service.create_cart(commerce_core.merchant_scope)
    cart = service.add_item(
        cart.cart_id, commerce_core.merchant_scope, "AUDIO-CASE-01", 1, expected_version=1
    )
    same, changed = service.refresh_prices(
        cart.cart_id, commerce_core.merchant_scope, expected_version=2
    )
    assert changed is False
    assert same.version == 2  # no-op refresh does not bump the version


# --- Core delegates: ledger + outbox --------------------------------------------


def test_core_cart_delegates_ledger_and_outbox(
    commerce_core: CommerceCore,
) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id, customer_id="cust_9")
    assert cart.customer_id == "cust_9"
    cart = commerce_core.cart_add_item(
        cart.cart_id, "AUDIO-CASE-01", 1, expected_version=1, trace_id=trace_id
    )
    assert cart.grand_total_paise == 69_900
    cart = commerce_core.cart_start_checkout(
        cart.cart_id, expected_version=2, trace_id=trace_id
    )
    assert cart.status == CartStatus.CHECKOUT_STARTED

    actions = [e.action for e in commerce_core.ledger.for_trace(trace_id)]
    assert actions == ["cart.created", "cart.updated", "cart.checkout_started"]

    outbox = OutboxRepository(engine=commerce_core.cart_repo._engine)
    events = outbox.claim_unpublished(limit=10)
    assert [e.event_type for e in events] == ["cart.updated"] * 3
    assert all(e.trace_id == trace_id for e in events)
    assert events[-1].data["status"] == "CHECKOUT_STARTED"


def test_core_cart_guards_propagate(commerce_core: CommerceCore) -> None:
    trace_id = _trace()
    cart = commerce_core.create_cart(trace_id=trace_id)
    with pytest.raises(CartStateError, match="Unknown SKU"):
        commerce_core.cart_add_item(
            cart.cart_id, "NOPE-00", 1, expected_version=1, trace_id=trace_id
        )
    with pytest.raises(CartVersionConflictError):
        commerce_core.cart_add_item(
            cart.cart_id, "AUDIO-CASE-01", 1, expected_version=99, trace_id=trace_id
        )
    # Failed mutations ledger nothing and publish nothing.
    outbox = OutboxRepository(engine=commerce_core.cart_repo._engine)
    assert [e.event_type for e in outbox.claim_unpublished(limit=10)] == [
        "cart.updated"
    ]


def test_cart_repository_cross_merchant_isolation(
    commerce_core: CommerceCore,
) -> None:
    repo = CartRepository(engine=commerce_core.cart_repo._engine)
    cart = commerce_core.create_cart(trace_id=_trace())
    assert repo.get(cart.cart_id, "mrc_other") is None
    actives = repo.list_active("mrc_other")
    assert actives == []
