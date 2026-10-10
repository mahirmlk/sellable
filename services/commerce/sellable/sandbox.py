"""Agent sandbox (target §31): safe onboarding for agents, integrations,
and model versions. Synthetic merchants, catalogs, promotions, customers,
and simulated payments — no production money, data, credentials, or
network. The workflow is stage-gated: register → handshake → credential
→ connect → conformance → security → scenarios → trust → approval →
production marker.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool


logger = logging.getLogger("sellable.sandbox")


class SandboxStage(StrEnum):
    REGISTERED = "REGISTERED"
    HANDSHAKE = "HANDSHAKE"
    CREDENTIALED = "CREDENTIALED"
    CONNECTED = "CONNECTED"
    CONFORMANCE = "CONFORMANCE"
    SECURITY = "SECURITY"
    SCENARIOS = "SCENARIOS"
    TRUST_SEEDED = "TRUST_SEEDED"
    APPROVED = "APPROVED"
    PRODUCTION = "PRODUCTION"


_STAGE_ORDER = tuple(SandboxStage)


class SandboxError(ValueError):
    """The sandbox workflow refused the transition."""


@dataclass
class SandboxEnvironment:
    """Isolated synthetic world: own database, core, and adapters."""

    sandbox_id: str
    agent_id: str
    engine: object
    core: object
    payment_adapter: object
    session_service: object
    identity_service: object
    merchant_id: str = ""
    stage: SandboxStage = SandboxStage.REGISTERED
    summary: dict = field(default_factory=dict)


class SandboxManager:
    """Stage-gated onboarding. Environment state is in-memory (isolated
    engines); stage rows persist in the platform database for ops."""

    def __init__(self, prod_engine) -> None:
        from sellable.repositories import SandboxRepository

        self._sandbox_repo = SandboxRepository(prod_engine)
        self._eval_engine = prod_engine
        self._envs: dict[str, SandboxEnvironment] = {}

    # ------------------------------------------------------------------
    # Environment
    # ------------------------------------------------------------------

    def create_environment(
        self, *, agent_id: str = "", merchant_name: str = "Sandbox Merchant"
    ) -> SandboxEnvironment:
        from sellable.core import CommerceCore
        from sellable.ledger.database import Base
        from sellable.ledger.service import LedgerRepository
        from sellable.payments.simulated import SimulatedPaymentAdapter
        from sellable.protocols.identity import IdentityLinkService
        from sellable.protocols.sessions import ProtocolSessionService
        from sellable.repositories import IdentityLinkRepository, ProtocolSessionRepository

        _ = merchant_name
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        core = CommerceCore.from_seed(LedgerRepository(engine), engine=engine)
        env = SandboxEnvironment(
            sandbox_id=f"sbx_{uuid4().hex}",
            agent_id=agent_id,
            engine=engine,
            core=core,
            payment_adapter=SimulatedPaymentAdapter(),
            session_service=ProtocolSessionService(
                ProtocolSessionRepository(engine=engine)
            ),
            identity_service=IdentityLinkService(
                IdentityLinkRepository(engine=engine)
            ),
            merchant_id=core.merchant_scope,
        )
        self._envs[env.sandbox_id] = env
        self._persist(env)
        return env

    def _env(self, sandbox_id: str) -> SandboxEnvironment:
        try:
            return self._envs[sandbox_id]
        except KeyError:
            raise SandboxError(f"Unknown sandbox: {sandbox_id}") from None

    def _persist(self, env: SandboxEnvironment) -> None:
        self._sandbox_repo.save(
            {
                "sandbox_id": env.sandbox_id,
                "agent_id": env.agent_id,
                "merchant_id": env.merchant_id,
                "stage": env.stage.value,
                "status": "ACTIVE",
                "summary": dict(env.summary),
            }
        )

    def _advance(
        self, env: SandboxEnvironment, stage: SandboxStage, *, expect: SandboxStage
    ) -> SandboxEnvironment:
        if env.stage is not expect:
            raise SandboxError(
                f"sandbox is {env.stage.value}, requires {expect.value} for {stage.value}"
            )
        env.stage = stage
        self._persist(env)
        return env

    # ------------------------------------------------------------------
    # Workflow (§31.2)
    # ------------------------------------------------------------------

    def register_agent(
        self, sandbox_id: str, agent_id: str, *, agent_type: str = "CUSTOMER_AGENT"
    ) -> SandboxEnvironment:
        from sellable.agent_identity import AgentIdentity, AgentType

        env = self._env(sandbox_id)
        env.core.agent_repo.register(
            AgentIdentity(
                agent_id=agent_id,
                agent_type=AgentType(agent_type),
                owner_id=f"sandbox:{sandbox_id}",
                issuer="sandbox",
            )
        )
        env.agent_id = agent_id
        self._persist(env)
        return env

    def handshake(self, sandbox_id: str, agent_profile) -> SandboxEnvironment:
        from sellable.protocols.capabilities import build_merchant_profile

        env = self._env(sandbox_id)
        session = env.session_service.negotiate(
            env.merchant_id,
            agent_profile,
            build_merchant_profile(env.merchant_id),
        )
        env.summary["session_id"] = session.session_id
        env.summary["capabilities"] = list(session.active_capabilities)
        self._advance(env, SandboxStage.HANDSHAKE, expect=SandboxStage.REGISTERED)
        return env

    def issue_credential(self, sandbox_id: str) -> tuple[SandboxEnvironment, str]:
        """Issue an isolated sandbox API key (plaintext shown once)."""
        import hashlib as _hashlib
        import secrets as _secrets

        from sellable.contracts import new_id
        from sellable.repositories import AgentApiKeyRepository

        env = self._env(sandbox_id)
        token = f"sbx_{_secrets.token_urlsafe(32)}"
        AgentApiKeyRepository(engine=env.engine).create(
            key_id=new_id("sbxkey"),
            merchant_id=env.merchant_id,
            key_hash=_hashlib.sha256(token.encode()).hexdigest(),
            key_prefix=token[:12],
            label=f"sandbox credential for {env.agent_id}",
            buyer_agent_id=env.agent_id,
        )
        self._advance(env, SandboxStage.CREDENTIALED, expect=SandboxStage.HANDSHAKE)
        return env, token

    def connect(self, sandbox_id: str) -> SandboxEnvironment:
        env = self._env(sandbox_id)
        env.summary["merchant_id"] = env.merchant_id
        self._advance(env, SandboxStage.CONNECTED, expect=SandboxStage.CREDENTIALED)
        return env

    def run_conformance(self, sandbox_id: str) -> SandboxEnvironment:
        """Deterministic commerce + support suites (no real money)."""
        from evals.runner.harness import EvaluationHarness
        from sellable.repositories import EvaluationRepository

        env = self._env(sandbox_id)
        harness = EvaluationHarness(EvaluationRepository(self._eval_engine))
        reports = {}
        for suite_id in ("seller-commerce-v1", "cs-support-v1", "invariants-v1"):
            reports[suite_id] = harness.run_suite(
                lambda: env.core, suite_id, agent_id=env.agent_id
            ).__dict__
        env.summary["conformance"] = {
            suite_id: {"passed": r["passed"], "failed": r["failed"]}
            for suite_id, r in reports.items()
        }
        green = all(r["failed"] == 0 for r in reports.values())
        env.summary["conformance_green"] = green
        if not green:
            self._persist(env)
            raise SandboxError("conformance suite failed; fix before security stage")
        self._advance(env, SandboxStage.CONFORMANCE, expect=SandboxStage.CONNECTED)
        return env

    def run_security(self, sandbox_id: str) -> SandboxEnvironment:
        """Adversarial + safety suites."""
        from evals.runner.harness import EvaluationHarness
        from sellable.repositories import EvaluationRepository

        env = self._env(sandbox_id)
        harness = EvaluationHarness(EvaluationRepository(self._eval_engine))
        reports = {}
        for suite_id in ("adversarial-v1", "seller-safety-v1"):
            reports[suite_id] = harness.run_suite(
                lambda: env.core, suite_id, agent_id=env.agent_id
            ).__dict__
        env.summary["security"] = {
            suite_id: {"passed": r["passed"], "failed": r["failed"]}
            for suite_id, r in reports.items()
        }
        green = all(r["failed"] == 0 for r in reports.values())
        env.summary["security_green"] = green
        if not green:
            self._persist(env)
            raise SandboxError("security suite failed; fix before scenario stage")
        self._advance(env, SandboxStage.SECURITY, expect=SandboxStage.CONFORMANCE)
        return env

    def run_scenarios(self, sandbox_id: str) -> SandboxEnvironment:
        """End-to-end commerce scenarios on simulated rails."""
        env = self._env(sandbox_id)
        evidence: dict = {}
        evidence["valid_purchase"] = self._scenario_purchase(env, succeed=True)
        evidence["payment_failure"] = self._scenario_purchase(env, succeed=False)
        evidence["return_refund"] = self._scenario_return_refund(env)
        env.summary["scenarios"] = evidence
        green = all(v.get("passed") for v in evidence.values())
        env.summary["scenarios_green"] = green
        if not green:
            self._persist(env)
            raise SandboxError("scenario battery failed")
        self._advance(env, SandboxStage.SCENARIOS, expect=SandboxStage.SECURITY)
        return env

    def seed_trust(self, sandbox_id: str) -> SandboxEnvironment:
        """Initialize the agent reputation baseline (zeroed counters)."""
        from sellable.agent_identity import AgentReputation

        env = self._env(sandbox_id)
        env.core.agent_repo.save_reputation(AgentReputation(agent_id=env.agent_id))
        env.summary["trust_seeded"] = True
        self._advance(env, SandboxStage.TRUST_SEEDED, expect=SandboxStage.SCENARIOS)
        return env

    def approve(self, sandbox_id: str, *, approved_by: str) -> SandboxEnvironment:
        env = self._env(sandbox_id)
        if env.stage is not SandboxStage.TRUST_SEEDED:
            raise SandboxError("approval requires all prior stages green")
        for key in ("conformance_green", "security_green", "scenarios_green"):
            if not env.summary.get(key):
                raise SandboxError(f"approval blocked: {key} is not green")
        env.summary["approved_by"] = approved_by
        self._advance(env, SandboxStage.APPROVED, expect=SandboxStage.TRUST_SEEDED)
        return env

    def grant_production(self, sandbox_id: str) -> SandboxEnvironment:
        """Marker only: real production access is a platform ops action."""
        env = self._env(sandbox_id)
        self._advance(env, SandboxStage.PRODUCTION, expect=SandboxStage.APPROVED)
        return env

    # ------------------------------------------------------------------
    # Scenario battery (simulated rails, core settlement).
    # ------------------------------------------------------------------

    def _scenario_purchase(self, env: SandboxEnvironment, *, succeed: bool) -> dict:
        from datetime import timedelta

        from sellable.contracts import (
            CartItem,
            CartMandate,
            IntentMandate,
            OrderStatus,
            utc_now,
        )

        try:
            intent = IntentMandate(
                buyer_agent_id=f"sandbox:{env.agent_id}",
                budget_ceiling_paise=500_000,
                allowed_categories=["accessories", "gifting", "snacks"],
                purpose="sandbox scenario",
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
                cart=mandate, intent=intent, trace_id=f"trc_{uuid4().hex}",
                idempotency_key=f"idem_sbx_{uuid4().hex}",
            )
            consent = env.core.issue_consent(order.order_id)
            env.core.consume_consent(consent.consent_id, order_id=order.order_id)
            env.core.mark_payment_pending(order.order_id)
            if succeed:
                settled = env.core.mark_paid(
                    order.order_id, provider_ref=f"sim_pay_{uuid4().hex[:8]}"
                )
                passed = settled.status == OrderStatus.PAID
            else:
                failed = env.core.mark_payment_failed(order.order_id, reason="simulated decline")
                passed = failed.status == OrderStatus.PAYMENT_FAILED
            return {"passed": passed, "order_id": order.order_id}
        except Exception as error:  # noqa: BLE001 — scenario evidence
            logger.warning("sandbox scenario failed: %s", error)
            return {"passed": False, "error": str(error)[:200]}

    def _scenario_return_refund(self, env: SandboxEnvironment) -> dict:
        from sellable.contracts import OrderStatus

        purchase = self._scenario_purchase(env, succeed=True)
        if not purchase.get("passed"):
            return {"passed": False, "error": "purchase failed"}
        try:
            case = env.core.request_return(
                purchase["order_id"],
                [{"sku": "AUDIO-CASE-01", "quantity": 1}],
                "sandbox scenario return",
                trace_id=f"trc_{uuid4().hex}",
            )
            env.core.decide_return(case.return_id, approve=True, trace_id=f"trc_{uuid4().hex}")
            ask = env.core.request_refund(
                purchase["order_id"], 69_900, "sandbox scenario",
                trace_id=f"trc_{uuid4().hex}",
            )
            decided = env.core.decide_refund(
                ask.refund_request_id, approve=True,
                decided_by="sandbox", trace_id=f"trc_{uuid4().hex}",
            )
            _ = decided
            return {"passed": True, "return_id": case.return_id}
        except Exception as error:  # noqa: BLE001 — scenario evidence
            return {"passed": False, "error": str(error)[:200]}
