"""Phase 7: sandbox workflow (§31) — isolated onboarding from registration
to production approval, with simulated money and no network."""

from __future__ import annotations

import pytest

from sellable.contracts import AgentProfile
from sellable.sandbox import SandboxError, SandboxManager, SandboxStage
from sellable.sandbox import SandboxManager as _Manager  # noqa: F401 (public surface)


@pytest.fixture
def manager():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from sellable.ledger.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return SandboxManager(engine)


def _profile() -> AgentProfile:
    return AgentProfile(
        agent_id="agent_sbx_1",
        protocol="ucp",
        capabilities=["catalog.search", "cart.write", "checkout.create"],
    )


def test_full_workflow_to_production(manager: SandboxManager) -> None:
    env = manager.create_environment()
    assert env.stage == SandboxStage.REGISTERED

    manager.register_agent(env.sandbox_id, "agent_sbx_1")
    manager.handshake(env.sandbox_id, _profile())
    assert env.stage == SandboxStage.HANDSHAKE
    assert "cart.write" in env.summary["capabilities"]

    env, token = manager.issue_credential(env.sandbox_id)
    assert env.stage == SandboxStage.CREDENTIALED
    assert token.startswith("sbx_")

    manager.connect(env.sandbox_id)
    assert env.stage == SandboxStage.CONNECTED

    manager.run_conformance(env.sandbox_id)
    assert env.stage == SandboxStage.CONFORMANCE
    assert env.summary["conformance_green"] is True

    manager.run_security(env.sandbox_id)
    assert env.stage == SandboxStage.SECURITY
    assert env.summary["security_green"] is True

    manager.run_scenarios(env.sandbox_id)
    assert env.stage == SandboxStage.SCENARIOS
    assert env.summary["scenarios_green"] is True

    manager.seed_trust(env.sandbox_id)
    assert env.stage == SandboxStage.TRUST_SEEDED

    manager.approve(env.sandbox_id, approved_by="ops_lead")
    assert env.stage == SandboxStage.APPROVED

    manager.grant_production(env.sandbox_id)
    assert env.stage == SandboxStage.PRODUCTION


def test_stage_order_enforced(manager: SandboxManager) -> None:
    env = manager.create_environment()
    # Approval requires the full green chain.
    with pytest.raises(SandboxError):
        manager.approve(env.sandbox_id, approved_by="ops_lead")
    # Security requires conformance first.
    with pytest.raises(SandboxError):
        manager.run_security(env.sandbox_id)
    # Unknown sandboxes stay invisible.
    with pytest.raises(SandboxError):
        manager.connect("sbx_missing")


def test_simulated_adapter_has_no_network() -> None:
    import inspect
    import re

    import sellable.payments.simulated as simulated

    imports = [
        line.strip()
        for line in inspect.getsource(simulated).splitlines()
        if re.match(r"^(import|from)\s+", line.strip())
    ]
    assert not any(
        re.search(r"\burllib\b|\bhttp\b|\bhttpx\b|\brequests\b|\bsocket\b", line)
        for line in imports
    ), imports
    adapter = simulated.SimulatedPaymentAdapter()
    adapter.validate_configuration()
    with pytest.raises(ValueError, match="core.mark_paid"):
        adapter.verify_webhook(b"{}", "sig")


def test_simulated_payment_flows(manager: SandboxManager) -> None:
    env = manager.create_environment()
    from datetime import timedelta

    from sellable.contracts import CartItem, CartMandate, IntentMandate, utc_now

    intent = IntentMandate(
        buyer_agent_id="sandbox:buyer",
        budget_ceiling_paise=500_000,
        allowed_categories=["accessories"],
        purpose="sandbox pay test",
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
    order = env.core.create_order(
        cart=mandate, intent=intent, trace_id="trc_" + "e" * 32,
        idempotency_key="idem_sbx_pay_001",
    )
    link = env.payment_adapter.create_payment_link(order)
    assert link.short_url.startswith("https://sandbox.pay/")
    consent = env.core.issue_consent(order.order_id)
    env.core.consume_consent(consent.consent_id, order_id=order.order_id)
    env.core.mark_payment_pending(order.order_id)
    paid = env.core.mark_paid(order.order_id, provider_ref="sim_pay_1")
    assert paid.status.value == "PAID"


def test_sandbox_isolated_from_prod(manager: SandboxManager) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from sellable.core import CommerceCore
    from sellable.ledger.database import Base
    from sellable.ledger.service import LedgerRepository

    prod_engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(prod_engine)
    prod = CommerceCore.from_seed(LedgerRepository(prod_engine), engine=prod_engine)

    env = manager.create_environment()
    manager.register_agent(env.sandbox_id, "agent_iso")
    # Sandbox commerce runs entirely inside the sandbox engine.
    result = manager._scenario_purchase(env, succeed=True)
    assert result["passed"] is True
    assert prod.order_repo.all(prod.merchant_scope, limit=10) == []
    assert len(env.core.order_repo.all(env.core.merchant_scope, limit=100)) == 1
