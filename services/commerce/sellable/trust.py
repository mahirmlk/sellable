"""Trust aggregation (target §32): identity + authentication + delegation
+ capability-adjacent history + reputation + transaction history, combined
into explicit tiers that the risk engine consumes as one input among many.

Reputation is never the sole authorization mechanism — tiers are signals
for risk and access-tier decisions (§32.3), recorded as append-only trust
events for audit.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sellable.contracts import TrustAssessment, TrustTier, new_id, utc_now


TRUSTED_MIN_SUCCESSES = 10
ESTABLISHED_MIN_SUCCESSES = 3
MERCHANT_NEW_AGE = timedelta(days=7)
MERCHANT_TRUSTED_MIN_ORDERS = 50
MERCHANT_ESTABLISHED_MIN_ORDERS = 10
MERCHANT_DISPUTE_REVIEW_BPS = 2_000  # 20% refunds/returns share


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class TrustService:
    def __init__(
        self,
        *,
        agent_repo: object | None = None,
        merchant_repo: object | None = None,
        onboarding_repo: object | None = None,
        order_repo: object | None = None,
        delegation_repo: object | None = None,
        trust_event_repo: object | None = None,
        ledger: object | None = None,
    ) -> None:
        self._agents = agent_repo
        self._merchants = merchant_repo
        self._onboarding = onboarding_repo
        self._orders = order_repo
        self._delegations = delegation_repo
        self._trust_events = trust_event_repo
        self._ledger = ledger

    # ------------------------------------------------------------------
    # Assessments
    # ------------------------------------------------------------------

    def agent_assessment(self, agent_id: str, merchant_id: str) -> TrustAssessment:
        """Tier for an acting agent. Unregistered agents are UNVERIFIED —
        usable for discovery-class actions, stepped up for money."""
        if self._agents is None:
            return TrustAssessment(
                subject_type="agent", subject_id=agent_id,
                tier=TrustTier.UNVERIFIED, signals=["no agent registry configured"],
            )
        identity = self._agents.get(agent_id)
        if identity is None:
            return TrustAssessment(
                subject_type="agent", subject_id=agent_id,
                tier=TrustTier.UNVERIFIED, signals=["agent not registered"],
            )
        signals = [f"credential:{identity.credential_status.value}"]
        if not identity.is_credential_usable():
            return TrustAssessment(
                subject_type="agent", subject_id=agent_id,
                tier=TrustTier.FLAGGED, signals=[*signals, "credential not usable"],
            )
        reputation = self._agents.reputation(agent_id)
        if reputation is None:
            return TrustAssessment(
                subject_type="agent", subject_id=agent_id,
                tier=TrustTier.NEW, signals=[*signals, "no transaction history"],
            )
        signals.append(f"success:{reputation.successful_transactions}")
        if reputation.fraud_flags > 0 or reputation.abuse_flags > 0:
            return TrustAssessment(
                subject_type="agent", subject_id=agent_id,
                tier=TrustTier.FLAGGED,
                signals=[*signals, "fraud/abuse flags present"],
            )
        if (
            reputation.successful_transactions >= TRUSTED_MIN_SUCCESSES
            and reputation.policy_denials == 0
            and reputation.authorization_failures == 0
        ):
            tier = TrustTier.TRUSTED
        elif reputation.successful_transactions >= ESTABLISHED_MIN_SUCCESSES:
            tier = TrustTier.ESTABLISHED
        else:
            tier = TrustTier.NEW
        return TrustAssessment(
            subject_type="agent", subject_id=agent_id, tier=tier, signals=signals
        )

    def merchant_assessment(self, merchant_id: str) -> TrustAssessment:
        """Tier for a merchant: onboarding stage, account age, volume, and
        dispute share (refunds + returns over orders, ledger-observed)."""
        signals: list[str] = []
        if self._onboarding is not None:
            onboarding = self._onboarding.get(merchant_id)
            stage = onboarding.stage.value if onboarding else "UNKNOWN"
            signals.append(f"onboarding:{stage}")
            if onboarding is None or stage != "LIVE":
                return TrustAssessment(
                    subject_type="merchant", subject_id=merchant_id,
                    tier=TrustTier.PROVISIONAL, signals=signals,
                )
        age = self._merchant_age(merchant_id)
        if age is not None:
            signals.append(f"age_days:{age.days}")
        order_count = self._order_count(merchant_id)
        signals.append(f"orders:{order_count}")
        dispute_bps = self._dispute_share_bps(merchant_id, order_count)
        signals.append(f"dispute_bps:{dispute_bps}")
        if dispute_bps >= MERCHANT_DISPUTE_REVIEW_BPS and order_count >= 5:
            return TrustAssessment(
                subject_type="merchant", subject_id=merchant_id,
                tier=TrustTier.UNDER_REVIEW, signals=signals,
            )
        if age is not None and age < MERCHANT_NEW_AGE:
            return TrustAssessment(
                subject_type="merchant", subject_id=merchant_id,
                tier=TrustTier.NEW, signals=signals,
            )
        if order_count >= MERCHANT_TRUSTED_MIN_ORDERS and dispute_bps < 500:
            tier = TrustTier.TRUSTED
        elif order_count >= MERCHANT_ESTABLISHED_MIN_ORDERS:
            tier = TrustTier.ESTABLISHED
        else:
            tier = TrustTier.NEW
        return TrustAssessment(
            subject_type="merchant", subject_id=merchant_id, tier=tier, signals=signals
        )

    def customer_assessment(self, customer_id: str, merchant_id: str) -> TrustAssessment:
        """Tier for a customer from delegation history (identity-linking
        depth arrives with Phase 5; until then delegations are the record)."""
        if self._delegations is None:
            return TrustAssessment(
                subject_type="customer", subject_id=customer_id,
                tier=TrustTier.NEW, signals=["no delegation history source"],
            )
        actives = [
            g for g in self._delegations.active_for_agent(merchant_id, customer_id)
        ] if hasattr(self._delegations, "active_for_agent") else []
        # Delegations are keyed by subject agent; customer history is read
        # through grants where the customer is principal — approximated by
        # direct lookup when the repo supports it.
        history = (
            self._delegations.history_for_principal(merchant_id, customer_id)
            if hasattr(self._delegations, "history_for_principal")
            else []
        )
        signals = [f"active_delegations:{len(actives)}"]
        revoked = sum(1 for g in history if g.status.value == "REVOKED")
        signals.append(f"revoked_delegations:{revoked}")
        if revoked > 0:
            return TrustAssessment(
                subject_type="customer", subject_id=customer_id,
                tier=TrustTier.UNDER_REVIEW, signals=signals,
            )
        if len(actives) >= 2 or len(history) >= 3:
            tier = TrustTier.ESTABLISHED
        else:
            tier = TrustTier.NEW
        return TrustAssessment(
            subject_type="customer", subject_id=customer_id, tier=tier, signals=signals
        )

    # ------------------------------------------------------------------
    # Recording (registered agents only; silent no-op otherwise)
    # ------------------------------------------------------------------

    def record_success(
        self, agent_id: str, *, merchant_id: str = "", amount_paise: int = 0, reference: str = ""
    ) -> None:
        self._record(agent_id, "SUCCESS", merchant_id=merchant_id, reference=reference, amount_paise=amount_paise)

    def record_order_failure(
        self, agent_id: str, *, merchant_id: str = "", reference: str = ""
    ) -> None:
        self._record(agent_id, "ORDER_FAILURE", merchant_id=merchant_id, reference=reference)

    def record_policy_denial(
        self, agent_id: str, *, merchant_id: str = "", reference: str = ""
    ) -> None:
        self._record(agent_id, "POLICY_DENIAL", merchant_id=merchant_id, reference=reference)

    def record_auth_failure(
        self, agent_id: str, *, merchant_id: str = "", reference: str = ""
    ) -> None:
        self._record(agent_id, "AUTH_FAILURE", merchant_id=merchant_id, reference=reference)

    def record_fraud_flag(
        self, agent_id: str, *, merchant_id: str = "", reference: str = ""
    ) -> None:
        self._record(agent_id, "FRAUD_FLAG", merchant_id=merchant_id, reference=reference)

    def _record(
        self, agent_id: str, kind: str, *, merchant_id: str, reference: str, amount_paise: int = 0
    ) -> None:
        if self._agents is None:
            return
        try:
            identity = self._agents.get(agent_id)
            if identity is None:
                return
            reputation = self._agents.reputation(agent_id)
            from sellable.agent_identity import AgentReputation

            reputation = reputation or AgentReputation(agent_id=agent_id)
            if kind == "SUCCESS":
                reputation = reputation.model_copy(
                    update={
                        "successful_transactions": reputation.successful_transactions + 1,
                        "average_order_value_paise": amount_paise or reputation.average_order_value_paise,
                        "last_updated_at": utc_now(),
                    }
                )
            elif kind == "ORDER_FAILURE":
                reputation = reputation.model_copy(
                    update={
                        "failed_transactions": reputation.failed_transactions + 1,
                        "last_updated_at": utc_now(),
                    }
                )
            elif kind == "POLICY_DENIAL":
                reputation = reputation.model_copy(
                    update={
                        "policy_denials": reputation.policy_denials + 1,
                        "last_updated_at": utc_now(),
                    }
                )
            elif kind == "AUTH_FAILURE":
                reputation = reputation.model_copy(
                    update={
                        "authorization_failures": reputation.authorization_failures + 1,
                        "last_updated_at": utc_now(),
                    }
                )
            elif kind == "FRAUD_FLAG":
                reputation = reputation.model_copy(
                    update={
                        "fraud_flags": reputation.fraud_flags + 1,
                        "last_updated_at": utc_now(),
                    }
                )
            self._agents.save_reputation(reputation)
            if self._trust_events is not None:
                self._trust_events.append(
                    {
                        "event_id": new_id("txe"),
                        "merchant_id": merchant_id,
                        "agent_id": agent_id,
                        "kind": kind,
                        "reference": reference,
                    }
                )
        except Exception:  # noqa: BLE001 — trust never breaks commerce
            pass

    # ------------------------------------------------------------------

    def _merchant_age(self, merchant_id: str):
        if self._merchants is None:
            return None
        try:
            record = self._merchants.get(merchant_id)
            if record is None:
                return None
            return utc_now() - _as_aware(record.created_at)
        except Exception:  # noqa: BLE001 — best-effort signal
            return None

    def _order_count(self, merchant_id: str) -> int:
        if self._orders is None or not hasattr(self._orders, "all"):
            return 0
        try:
            return len(self._orders.all(merchant_id, limit=500))
        except Exception:  # noqa: BLE001 — best-effort signal
            return 0

    def _dispute_share_bps(self, merchant_id: str, order_count: int) -> int:
        if order_count == 0 or self._ledger is None or not hasattr(self._ledger, "all_events"):
            return 0
        try:
            disputes = sum(
                1
                for record in self._ledger.all_events(limit=500, merchant_id=merchant_id)
                if record.action
                in (
                    "refund.settled",
                    "refund.partial_settled",
                    "return.completed",
                    "exchange.fulfilled",
                )
            )
            return min(disputes * 10_000 // order_count, 10_000)
        except Exception:  # noqa: BLE001 — best-effort signal
            return 0
