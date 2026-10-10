"""Fraud and risk platform (target §24).

Policy answers *allowed?*, risk answers *how risky?*, fraud answers *is
this abuse?* — three separate layers with separate records. All rules are
deterministic and explainable: every assessment carries rule codes, and
every block carries a persisted fraud signal. The LLM never sees raw risk
internals; it gets purpose-built decisions through checkout and gateway
flows.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sellable.contracts import (
    FraudEvent,
    FraudKind,
    RiskAssessment,
    RiskLevel,
    TrustTier,
    utc_now,
)
from sellable.delegations import OperationScope


# Observation windows and deterministic thresholds.
ORDER_VELOCITY_WINDOW = timedelta(minutes=10)
ORDER_VELOCITY_STEP_UP = 3
ORDER_VELOCITY_BLOCK = 6
CART_BURST_STEP_UP = 10
CART_BURST_BLOCK = 25
FAILURE_WINDOW = timedelta(minutes=30)
FAILED_PAYMENTS_STEP_UP = 2
FAILED_PAYMENTS_BLOCK = 4
FAILED_AUTH_STEP_UP = 3
PAYMENT_TESTING_COUNT = 3
PAYMENT_TESTING_MAX_PAISE = 2_000
PAYMENT_TESTING_WINDOW = timedelta(minutes=30)

_LEVEL_SCORE = {
    RiskLevel.ALLOW: 500,
    RiskLevel.LOW_RISK_REVIEW: 3_000,
    RiskLevel.STEP_UP_AUTH: 5_000,
    RiskLevel.REQUIRE_CUSTOMER: 7_000,
    RiskLevel.REQUIRE_HUMAN: 7_500,
    RiskLevel.BLOCK: 9_500,
}


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class RiskService:
    """Deterministic risk decisions over order/ledger/delegation history."""

    def __init__(
        self,
        *,
        order_repo: object | None = None,
        ledger: object | None = None,
        delegation_lookup: object | None = None,
        agent_lookup: object | None = None,
        fraud_service: "FraudService | None" = None,
        risk_repo: object | None = None,
        policy: object | None = None,
    ) -> None:
        self._orders = order_repo
        self._ledger = ledger
        self._delegations = delegation_lookup
        self._agents = agent_lookup
        self._fraud = fraud_service
        self._risk_repo = risk_repo
        self._policy = policy

    def assess(
        self,
        *,
        merchant_id: str,
        amount_paise: int,
        subject_id: str | None = None,
        agent_id: str | None = None,
        delegation_id: str | None = None,
        trust_tier: TrustTier | None = None,
        approval_threshold_paise: int | None = None,
        max_order_paise: int | None = None,
        trace_id: str | None = None,
        now: datetime | None = None,
    ) -> RiskAssessment:
        moment = now or utc_now()
        triggered: list[tuple[RiskLevel, str]] = []
        threshold = (
            approval_threshold_paise
            if approval_threshold_paise is not None
            else getattr(self._policy, "human_approval_threshold_paise", None)
        )
        ceiling = (
            max_order_paise
            if max_order_paise is not None
            else getattr(self._policy, "max_order_value_paise", None)
        )

        if ceiling is not None and amount_paise > ceiling:
            triggered.append((RiskLevel.BLOCK, "AMOUNT_OVER_MAX"))
        elif threshold is not None and amount_paise >= threshold:
            triggered.append((RiskLevel.REQUIRE_HUMAN, "AMOUNT_REQUIRES_HUMAN"))

        if trust_tier is TrustTier.FLAGGED:
            triggered.append((RiskLevel.BLOCK, "FLAGGED_SUBJECT"))

        if subject_id is not None:
            recent_orders = self._orders_since(merchant_id, subject_id, moment - ORDER_VELOCITY_WINDOW, moment)
            if len(recent_orders) >= ORDER_VELOCITY_BLOCK:
                triggered.append((RiskLevel.BLOCK, "ORDER_VELOCITY_HIGH"))
                self._flag(
                    merchant_id, FraudKind.VELOCITY_ABUSE, subject_id,
                    {"orders_in_window": len(recent_orders)}, trace_id,
                )
            elif len(recent_orders) >= ORDER_VELOCITY_STEP_UP:
                triggered.append((RiskLevel.STEP_UP_AUTH, "ORDER_VELOCITY_ELEVATED"))
            elif len(recent_orders) >= 2:
                triggered.append((RiskLevel.LOW_RISK_REVIEW, "ORDER_VELOCITY_WATCH"))

            small_recent = [
                o for o in self._orders_since(
                    merchant_id, subject_id, moment - PAYMENT_TESTING_WINDOW, moment
                )
                if o.amount_paise <= PAYMENT_TESTING_MAX_PAISE
            ]
            if len(small_recent) >= PAYMENT_TESTING_COUNT:
                triggered.append((RiskLevel.BLOCK, "PAYMENT_TESTING_PATTERN"))
                self._flag(
                    merchant_id, FraudKind.PAYMENT_TESTING, subject_id,
                    {"small_orders_in_window": len(small_recent)}, trace_id,
                )

            failed_payments = self._ledger_action_count(
                merchant_id, "payment.failed", moment - FAILURE_WINDOW, moment
            )
            if failed_payments >= FAILED_PAYMENTS_BLOCK:
                triggered.append((RiskLevel.BLOCK, "FAILED_PAYMENTS_BURST"))
            elif failed_payments >= FAILED_PAYMENTS_STEP_UP:
                triggered.append((RiskLevel.STEP_UP_AUTH, "FAILED_PAYMENTS_ELEVATED"))
            elif failed_payments >= 1:
                triggered.append((RiskLevel.LOW_RISK_REVIEW, "FAILED_PAYMENT_SEEN"))

            failed_auth = self._ledger_action_count(
                merchant_id, "authorization.denied", moment - FAILURE_WINDOW, moment
            )
            if failed_auth >= FAILED_AUTH_STEP_UP:
                triggered.append((RiskLevel.STEP_UP_AUTH, "FAILED_AUTH_BURST"))

            cart_burst = self._ledger_action_count(
                merchant_id, "cart.created", moment - ORDER_VELOCITY_WINDOW, moment
            )
            if cart_burst >= CART_BURST_BLOCK:
                triggered.append((RiskLevel.BLOCK, "BOT_CART_BURST"))
                self._flag(
                    merchant_id, FraudKind.BOT_BEHAVIOR, subject_id,
                    {"carts_in_window": cart_burst}, trace_id,
                )
            elif cart_burst >= CART_BURST_STEP_UP:
                triggered.append((RiskLevel.STEP_UP_AUTH, "BOT_CART_ELEVATED"))

        if agent_id is not None and self._agents is not None:
            if self._agents.get(agent_id) is None:
                half_threshold = threshold // 2 if threshold else 100_000
                if amount_paise >= half_threshold:
                    triggered.append((RiskLevel.STEP_UP_AUTH, "UNVERIFIED_AGENT_HIGH_VALUE"))

        level = RiskLevel.ALLOW
        for candidate, _ in triggered:
            if _LEVEL_SCORE[candidate] > _LEVEL_SCORE[level]:
                level = candidate
        assessment = RiskAssessment(
            merchant_id=merchant_id,
            level=level,
            score_bps=_LEVEL_SCORE[level],
            reasons=[code for _, code in triggered] or ["NO_RISK_SIGNALS"],
            subject_type="customer" if subject_id else ("agent" if agent_id else None),
            subject_id=subject_id or agent_id,
            trace_id=trace_id,
        )
        if self._risk_repo is not None:
            self._risk_repo.save(assessment)
        return assessment

    # ------------------------------------------------------------------

    def _orders_since(
        self, merchant_id: str, subject_id: str, since: datetime, moment: datetime
    ) -> list[object]:
        if self._orders is None:
            return []
        orders = self._orders.all(merchant_id, limit=500) if hasattr(self._orders, "all") else []
        windowed = []
        for order in orders:
            created = _as_aware(order.created_at)
            if created < since or created > moment:
                continue
            buyer = getattr(order, "buyer_agent_id", "") or ""
            if buyer == subject_id or buyer.startswith(subject_id):
                windowed.append(order)
        return windowed

    def _ledger_action_count(
        self, merchant_id: str, action: str, since: datetime, moment: datetime
    ) -> int:
        if self._ledger is None or not hasattr(self._ledger, "all_events"):
            return 0
        count = 0
        for record in self._ledger.all_events(limit=500, merchant_id=merchant_id):
            if record.action != action:
                continue
            occurred = _as_aware(record.timestamp)
            if since <= occurred <= moment:
                count += 1
        return count

    def _flag(
        self,
        merchant_id: str,
        kind: FraudKind,
        subject_id: str,
        detail: dict[str, object],
        trace_id: str | None,
    ) -> None:
        if self._fraud is None:
            return
        try:
            self._fraud.flag(
                merchant_id=merchant_id,
                kind=kind,
                subject_type="customer",
                subject_id=subject_id,
                detail=detail,
                trace_id=trace_id,
            )
        except Exception:  # noqa: BLE001 — flagging never breaks assessment
            pass


class FraudService:
    """Fraud signal recording (§24.4). Signals feed future assessments;
    they never execute commerce actions themselves."""

    def __init__(self, fraud_repo: object | None = None) -> None:
        self._fraud_repo = fraud_repo

    def flag(
        self,
        *,
        merchant_id: str,
        kind: FraudKind,
        subject_type: str = "customer",
        subject_id: str,
        detail: dict[str, object] | None = None,
        trace_id: str | None = None,
    ) -> FraudEvent:
        event = FraudEvent(
            merchant_id=merchant_id,
            kind=kind,
            subject_type=subject_type,
            subject_id=subject_id,
            detail=dict(detail or {}),
            trace_id=trace_id,
        )
        if self._fraud_repo is not None:
            self._fraud_repo.save(event)
        return event

    def recent(
        self, merchant_id: str, *, kind: FraudKind | None = None, limit: int = 50
    ) -> list[FraudEvent]:
        if self._fraud_repo is None:
            return []
        return self._fraud_repo.list_for(merchant_id, kind=kind, limit=limit)


def risk_scope_for_order() -> OperationScope:
    """Scope assessed at order creation (kept beside the engine for
    discoverability; the gateway and core import it)."""
    return OperationScope.CHECKOUT_WRITE
