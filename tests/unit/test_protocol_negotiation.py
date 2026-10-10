"""Phase 5: capability discovery/negotiation (§15) and sessions (§15.3)."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import AgentProfile, utc_now
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.protocols.capabilities import (
    build_merchant_profile,
    negotiate,
)
from sellable.protocols.sessions import (
    ProtocolSessionService,
    SessionError,
    SessionExpiredError,
    SessionNotFoundError,
)
from sellable.repositories import ProtocolSessionRepository


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _service(core: CommerceCore) -> ProtocolSessionService:
    return ProtocolSessionService(
        ProtocolSessionRepository(engine=core.session_repo._engine)
    )


def _agent_profile(**overrides) -> AgentProfile:
    base = {
        "agent_id": "agent_ext_1",
        "protocol": "ucp",
        "capabilities": ["catalog.search", "cart.write", "checkout.create", "flying.cars"],
    }
    base.update(overrides)
    return AgentProfile(**base)


# --- Negotiation -------------------------------------------------------------------


def test_merchant_profile_lists_canonical_capabilities(
    commerce_core: CommerceCore,
) -> None:
    profile = build_merchant_profile(commerce_core.merchant_scope)
    ids = {c.capability_id for c in profile.capabilities}
    for required in (
        "catalog.search",
        "cart.write",
        "quotes.negotiate",
        "promotions.evaluate",
        "checkout.create",
        "checkout.authorize",
        "orders.create",
        "identity.link",
    ):
        assert required in ids
    assert set(profile.protocols) == {"rest", "mcp", "a2a", "ucp"}
    assert all(c.status.value == "ACTIVE" for c in profile.capabilities)


def test_negotiation_intersects_without_assumption(
    commerce_core: CommerceCore,
) -> None:
    merchant = build_merchant_profile(commerce_core.merchant_scope)
    active = negotiate(merchant, _agent_profile())
    assert active == ["cart.write", "catalog.search", "checkout.create"]
    assert "flying.cars" not in active
    assert negotiate(merchant, _agent_profile(capabilities=["flying.cars"])) == []


# --- Sessions --------------------------------------------------------------------------


def test_session_lifecycle(commerce_core: CommerceCore) -> None:
    core = commerce_core
    service = _service(core)
    merchant = build_merchant_profile(core.merchant_scope)
    session = service.negotiate(core.merchant_scope, _agent_profile(), merchant)
    assert session.protocol == "ucp"
    assert session.status.value == "ACTIVE"
    assert "cart.write" in session.active_capabilities

    fetched = service.get(session.session_id, core.merchant_scope)
    assert fetched.session_id == session.session_id
    assert service.require_capability(
        session.session_id, core.merchant_scope, "cart.write"
    ).session_id == session.session_id
    with pytest.raises(SessionError, match="not negotiated"):
        service.require_capability(
            session.session_id, core.merchant_scope, "orders.create"
        )
    with pytest.raises(SessionNotFoundError):
        service.get(session.session_id, "mrc_other")

    attached = service.attach_delegation(
        session.session_id, core.merchant_scope, "dlg_1"
    )
    assert attached.delegation_id == "dlg_1"
    revoked = service.revoke(session.session_id, core.merchant_scope)
    assert revoked.status.value == "REVOKED"
    with pytest.raises(SessionError):
        service.get(session.session_id, core.merchant_scope)


def test_session_expiry_is_lazy(commerce_core: CommerceCore) -> None:
    from datetime import timedelta as _td

    core = commerce_core
    service = _service(core)
    merchant = build_merchant_profile(core.merchant_scope)
    session = service.negotiate(
        core.merchant_scope,
        _agent_profile(),
        merchant,
        ttl=_td(seconds=-1),
    )
    with pytest.raises(SessionExpiredError):
        service.get(session.session_id, core.merchant_scope)
    stored = core.session_repo.get(session.session_id, core.merchant_scope)
    assert stored is not None
    assert stored.status.value == "EXPIRED"


def test_expire_due_sweep(commerce_core: CommerceCore) -> None:
    from datetime import timedelta as _td

    core = commerce_core
    service = _service(core)
    merchant = build_merchant_profile(core.merchant_scope)
    service.negotiate(core.merchant_scope, _agent_profile(), merchant, ttl=_td(seconds=-1))
    live = service.negotiate(core.merchant_scope, _agent_profile(), merchant)
    assert service.expire_due(core.merchant_scope) == 1
    assert service.get(live.session_id, core.merchant_scope).status.value == "ACTIVE"
