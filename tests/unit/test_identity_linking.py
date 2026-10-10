"""Phase 5: customer identity linking (§12) and its use in support auth."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from sellable.contracts import IdentityLinkStatus
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.protocols.identity import IdentityError, IdentityLinkService
from sellable.repositories import IdentityLinkRepository


@pytest.fixture
def commerce_core() -> CommerceCore:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return CommerceCore.from_seed(LedgerRepository(engine), engine=engine)


def _service(core: CommerceCore) -> IdentityLinkService:
    return IdentityLinkService(
        IdentityLinkRepository(engine=core.identity_repo._engine)
    )


# --- Link lifecycle ----------------------------------------------------------------------


def test_create_approve_me_cycle(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    merchant = commerce_core.merchant_scope
    link, code = service.create_link(
        merchant, "cust_link", agent_id="agent_ext_1", protocol="ucp"
    )
    assert link.status == IdentityLinkStatus.PENDING
    assert code
    assert service.is_linked(merchant, "cust_link") is False

    approved = service.approve_link(link.link_id, merchant, link_code=code)
    assert approved.status == IdentityLinkStatus.LINKED
    assert service.is_linked(merchant, "cust_link") is True
    assert service.is_linked(merchant, "cust_link", agent_id="agent_other") is False

    with pytest.raises(IdentityError, match="LINKED|link is"):
        service.approve_link(link.link_id, merchant, link_code=code)


def test_wrong_code_rejected(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    merchant = commerce_core.merchant_scope
    link, _ = service.create_link(merchant, "cust_link")
    with pytest.raises(IdentityError, match="link code or merchant approval"):
        service.approve_link(link.link_id, merchant, link_code="wrong-code")
    merchant_ok = service.approve_link(
        link.link_id, merchant, merchant_approved=True
    )
    assert merchant_ok.status == IdentityLinkStatus.LINKED


def test_expired_and_revoked_links(commerce_core: CommerceCore) -> None:
    service = _service(commerce_core)
    merchant = commerce_core.merchant_scope
    link, code = service.create_link(
        merchant, "cust_link", ttl=timedelta(seconds=-1)
    )
    with pytest.raises(IdentityError, match="expired"):
        service.approve_link(link.link_id, merchant, link_code=code)

    link2, code2 = service.create_link(merchant, "cust_link2")
    service.approve_link(link2.link_id, merchant, link_code=code2)
    assert service.is_linked(merchant, "cust_link2") is True
    service.revoke(link2.link_id, merchant)
    assert service.is_linked(merchant, "cust_link2") is False

    with pytest.raises(IdentityError):
        service.approve_link("idlink_missing", merchant, link_code="x")


def test_linked_identity_authenticates_support(commerce_core: CommerceCore) -> None:
    from agents.customer_service.agent import CustomerServiceAgent

    core = commerce_core
    service = IdentityLinkService(core.identity_repo)
    link, code = service.create_link(core.merchant_scope, "cust_linked")
    service.approve_link(link.link_id, core.merchant_scope, link_code=code)
    agent = CustomerServiceAgent(core)
    auth = agent.tools.customer_authenticate(
        customer_id="cust_linked", trace_id="trc_" + "d" * 32
    )
    assert auth.tier.value == "AUTHENTICATED"
    assert auth.method == "identity_link"
