"""The Phase 1 deterministic transaction flow, intentionally usable without an LLM."""

from __future__ import annotations

import json
import threading
from datetime import timedelta
from pathlib import Path

from sellable.catalog import CatalogService
from sellable.consent import ConsentService
from sellable.contracts import (
    CartMandate,
    Consent,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    MerchantPolicy,
    Order,
    OrderStatus,
    PolicyDecision,
    PolicyVerdict,
    utc_now,
)
from sellable.ledger.service import LedgerRepository
from sellable.orders import transition
from sellable.policy import PolicyEngine
from sellable.repositories import ConsentRepository, OrderRepository


def repository_root() -> Path:
    """Find the project root by looking for infra/seed relative to cwd or __file__."""
    cwd = Path.cwd()
    if (cwd / "infra" / "seed").is_dir():
        return cwd
    if (cwd / "services" / "commerce" / "infra" / "seed").is_dir():
        return cwd / "services" / "commerce"
    return Path(__file__).resolve().parents[3]


class CommerceCore:
    """Owns candidate-cart policy evaluation, consent, and authoritative order state."""

    def __init__(
        self,
        *,
        catalog: CatalogService,
        policy: MerchantPolicy,
        ledger: LedgerRepository,
        order_repo: OrderRepository | None = None,
        consent_repo: ConsentRepository | None = None,
        consent_service: ConsentService | None = None,
        policy_engine: PolicyEngine | None = None,
        engine: object | None = None,
        merchant_scope: str | None = None,
    ) -> None:
        self.catalog = catalog
        self.policy = policy
        self.ledger = ledger
        self.order_repo = order_repo or OrderRepository(engine=engine)
        self.consent_repo = consent_repo or ConsentRepository(engine=engine)
        self.consent_service = consent_service or ConsentService()
        self.policy_engine = policy_engine or PolicyEngine()
        self._idempotency_keys: dict[str, str] = {}
        self._order_lock = threading.Lock()
        self.merchant_scope = merchant_scope or policy.merchant_id

        # Hydrate from database
        self._hydrate()

    def _hydrate(self) -> None:
        """Load persisted state from the database (scoped to this core's merchant)."""
        try:
            # Load orders belonging to this merchant only
            orders = self.order_repo.all(merchant_id=self.merchant_scope)
            self._orders: dict[str, Order] = {o.order_id: o for o in orders}
            # Rebuild idempotency key map
            self._idempotency_keys = {o.idempotency_key: o.order_id for o in orders}
            # Load consents into consent service
            consents = self.consent_repo.all()
            for c in consents:
                self.consent_service._consents[c.consent_id] = c
        except Exception:
            # Tables may not exist yet on first run
            self._orders = {}
            self._idempotency_keys = {}

    @classmethod
    def from_seed(cls, ledger: LedgerRepository, policy_override: MerchantPolicy | None = None, engine: object | None = None) -> "CommerceCore":
        root = repository_root()
        catalog = CatalogService.from_json(root / "infra" / "seed" / "catalog.json")
        if policy_override:
            policy = policy_override
        else:
            policy_data = json.loads(
                (root / "infra" / "seed" / "merchant_policy.json").read_text(encoding="utf-8")
            )
            policy = MerchantPolicy.model_validate(policy_data)
        return cls(
            catalog=catalog,
            policy=policy,
            ledger=ledger,
            engine=engine,
        )

    def evaluate_quote(
        self, *, cart: CartMandate, intent: IntentMandate, trace_id: str
    ) -> PolicyDecision:
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="quote.received",
            inputs={"cart_id": cart.mandate_id, "total_paise": cart.total_paise},
            reasoning_summary="Received a candidate cart for deterministic policy evaluation.",
        )
        decision = self.policy_engine.evaluate_cart(
            cart=cart,
            intent=intent,
            policy=self.policy,
            products={product.sku: product for product in self.catalog.all()},
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.POLICY_ENGINE,
            action="policy.checked",
            inputs={
                "cart_id": cart.mandate_id,
                "total_paise": cart.total_paise,
                "buyer_budget_paise": intent.budget_ceiling_paise,
            },
            output={"verdict": decision.verdict, "reason_code": decision.reason_code},
            reasoning_summary=decision.reasoning_summary,
            policy_refs=decision.policy_refs,
        )
        return decision

    def create_order(
        self,
        *,
        cart: CartMandate,
        intent: IntentMandate,
        trace_id: str,
        idempotency_key: str,
    ) -> Order:
        with self._order_lock:
            existing_order_id = self._idempotency_keys.get(idempotency_key)
            if existing_order_id is not None:
                existing = self._orders[existing_order_id]
                if existing.amount_paise != cart.total_paise or existing.trace_id != trace_id:
                    raise ValueError("Idempotency key cannot be reused for a different transaction")
                return existing

            decision = self.evaluate_quote(cart=cart, intent=intent, trace_id=trace_id)
            if decision.verdict is PolicyVerdict.DENY:
                raise ValueError(
                    f"Order creation is blocked by policy: {decision.reason_code or decision.verdict}"
                )
            requires_approval = decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL
            order = Order(
                trace_id=trace_id,
                quote_id=cart.mandate_id,
                buyer_agent_id=intent.buyer_agent_id,
                merchant_id=self.policy.merchant_id,
                amount_paise=cart.total_paise,
                idempotency_key=idempotency_key,
                requires_approval=requires_approval,
            )
            self._orders[order.order_id] = order
            self._idempotency_keys[idempotency_key] = order.order_id
            # Persist to database
            self.order_repo.save(order)
            self._record(
                trace_id=trace_id,
                actor=LedgerActor.COMMERCE_CORE,
                action="order.created",
                inputs={"quote_id": cart.mandate_id, "idempotency_key": idempotency_key},
                output={
                    "order_id": order.order_id,
                    "status": order.status,
                    "requires_approval": requires_approval,
                    "items": [
                        {
                            "sku": item.sku,
                            "quantity": item.quantity,
                            "unit_price_paise": item.unit_price_paise,
                            "offered_price_paise": item.offered_price_paise,
                            "line_total_paise": item.line_total_paise,
                        }
                        for item in cart.items
                    ],
                    "buyer_budget_paise": intent.budget_ceiling_paise,
                },
                reasoning_summary=(
                    "Created an order only after the deterministic policy engine allowed it. "
                    "Orders above the human-approval threshold are created in a held state."
                    if requires_approval
                    else "Created an order only after the deterministic policy engine allowed it."
                ),
                policy_refs=["POLICY.order_creation_requires_allow"],
                outcome_effect={"order_state": order.status},
            )
            return order

    def approve_order(self, order_id: str) -> Order:
        """Grant the merchant's explicit human approval, unblocking consent."""
        order = self.get_order(order_id)
        updated = order.model_copy(
            update={"requires_approval": False, "approved_at": utc_now()}
        )
        self._orders[order_id] = updated
        self.order_repo.save(updated)
        self._record(
            trace_id=order.trace_id,
            actor=LedgerActor.HUMAN,
            action="human.approval_granted",
            inputs={"order_id": order_id, "amount_paise": order.amount_paise},
            output={"approved_at": updated.approved_at.isoformat()},
            reasoning_summary=(
                "Merchant explicitly approved an order that exceeded the human-approval threshold."
            ),
            policy_refs=["POLICY.human_approval_threshold"],
            outcome_effect={"order_state": updated.status},
        )
        return updated

    def issue_consent(self, order_id: str, *, lifetime_minutes: int = 10) -> Consent:
        order = self.get_order(order_id)
        if order.status is not OrderStatus.AWAITING_CONSENT:
            raise ValueError("Consent can only be issued for an order awaiting consent")
        if order.requires_approval:
            raise ValueError("Order requires merchant approval before consent can be issued")
        active = self.consent_service.active_for_order(order_id)
        if active is not None:
            raise ValueError("A consent is already active for this order")
        consent = self.consent_service.issue(
            Consent(
                order_id=order.order_id,
                amount_paise=order.amount_paise,
                payee_id=order.merchant_id,
                purpose="single_transaction",
                expires_at=utc_now() + timedelta(minutes=lifetime_minutes),
            )
        )
        # Persist consent
        self.consent_repo.save(consent)
        self._record(
            trace_id=order.trace_id,
            actor=LedgerActor.CONSENT_SERVICE,
            action="consent.issued",
            inputs={"order_id": order.order_id, "amount_paise": order.amount_paise},
            output={"consent_id": consent.consent_id, "expires_at": consent.expires_at.isoformat()},
            reasoning_summary="Issued single-use consent bound to this order, amount, and merchant.",
            policy_refs=["POLICY.transaction_bound_consent"],
        )
        return consent

    def consume_consent(self, consent_id: str, *, order_id: str) -> Order:
        order = self.get_order(order_id)
        used_consent = self.consent_service.consume(
            consent_id,
            order_id=order.order_id,
            amount_paise=order.amount_paise,
            payee_id=order.merchant_id,
        )
        # Persist updated consent
        self.consent_repo.save(used_consent)
        updated_order = order.model_copy(
            update={"status": transition(order.status, OrderStatus.CONSENTED)}
        )
        self._orders[order_id] = updated_order
        # Persist updated order
        self.order_repo.save(updated_order)
        self._record(
            trace_id=order.trace_id,
            actor=LedgerActor.CONSENT_SERVICE,
            action="consent.used",
            inputs={"consent_id": used_consent.consent_id, "order_id": order_id},
            output={"order_status": updated_order.status},
            reasoning_summary="Validated and consumed the exact single-use consent for this order.",
            policy_refs=["POLICY.consent_single_use"],
            outcome_effect={"order_state": updated_order.status},
        )
        return updated_order

    def get_order(self, order_id: str) -> Order:
        try:
            return self._orders[order_id]
        except KeyError as error:
            raise ValueError("Order does not exist") from error

    def get_order_by_idempotency_key(self, idempotency_key: str) -> Order | None:
        order_id = self._idempotency_keys.get(idempotency_key)
        if order_id is None:
            return None
        return self._orders.get(order_id)

    def mark_payment_pending(self, order_id: str, *, provider_ref: str | None = None) -> Order:
        return self._transition_order(
            order_id,
            OrderStatus.PAYMENT_PENDING,
            action="payment.pending",
            explanation="A valid consent was consumed; payment is now awaiting provider confirmation.",
            provider_ref=provider_ref,
        )

    def mark_paid(self, order_id: str, *, provider_ref: str) -> Order:
        return self._transition_order(
            order_id,
            OrderStatus.PAID,
            action="order.paid",
            explanation="A signature-verified provider event confirmed that payment was captured.",
            provider_ref=provider_ref,
        )

    def mark_payment_failed(self, order_id: str, *, reason: str, provider_ref: str | None = None) -> Order:
        return self._transition_order(
            order_id,
            OrderStatus.PAYMENT_FAILED,
            action="payment.failed",
            explanation=f"The payment attempt failed: {reason}",
            provider_ref=provider_ref,
        )

    def mark_aborted(self, order_id: str, *, reason: str) -> Order:
        return self._transition_order(
            order_id,
            OrderStatus.ABORTED,
            action="order.aborted",
            explanation=f"The order was aborted safely: {reason}",
        )

    def _transition_order(
        self,
        order_id: str,
        target: OrderStatus,
        *,
        action: str,
        explanation: str,
        provider_ref: str | None = None,
    ) -> Order:
        order = self.get_order(order_id)
        if order.status is target:
            return order  # idempotent: duplicate webhook/delivery must not crash
        updated_order = order.model_copy(update={"status": transition(order.status, target)})
        self._orders[order_id] = updated_order
        # Persist updated order
        self.order_repo.save(updated_order)
        self._record(
            trace_id=order.trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action=action,
            inputs={"order_id": order_id, "previous_status": order.status},
            output={"status": updated_order.status},
            reasoning_summary=explanation,
            provider_ref=provider_ref,
            outcome_effect={"order_state": updated_order.status},
        )
        return updated_order

    def _record(
        self,
        *,
        trace_id: str,
        actor: LedgerActor,
        action: str,
        inputs: dict[str, object],
        reasoning_summary: str,
        output: dict[str, object] | None = None,
        policy_refs: list[str] | None = None,
        outcome_effect: dict[str, object] | None = None,
        provider_ref: str | None = None,
    ) -> None:
        self.ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                actor=actor,
                action=action,
                inputs=inputs,
                output=output or {},
                reasoning_summary=reasoning_summary,
                policy_refs=policy_refs or [],
                outcome_effect=outcome_effect,
                provider_ref=provider_ref,
            )
        )

    def all_orders(self) -> list[Order]:
        return list(self._orders.values())

    def get_policy(self) -> MerchantPolicy:
        return self.policy

    def update_policy(self, **kwargs: object) -> None:
        merged = {**self.policy.model_dump(), **kwargs}
        self.policy = MerchantPolicy.model_validate(merged)
