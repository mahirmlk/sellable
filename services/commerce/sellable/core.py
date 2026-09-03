"""The Phase 1 deterministic transaction flow, intentionally usable without an LLM."""

from __future__ import annotations

import json
import threading
from datetime import timedelta
from pathlib import Path

from sellable.catalog import CatalogService
from sellable.consent import ConsentService, ConsentValidationError
from sellable.contracts import (
    CartMandate,
    Consent,
    ConsentStatus,
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

from sqlalchemy.exc import IntegrityError


class IdempotencyReuseError(ValueError):
    """An idempotency key was reused for a different transaction.

    A ValueError subclass so existing ``except ValueError`` mappings keep
    working; endpoints catch this specifically to return a precise 409.
    """


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
            # Load only this merchant's consents (legacy NULL rows whose
            # payee matches stay visible to their owning tenant only).
            consents = self.consent_repo.all(merchant_id=self.merchant_scope)
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
        self,
        *,
        cart: CartMandate,
        intent: IntentMandate,
        trace_id: str,
        upsells_in_session: int = 0,
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
            upsells_in_session=upsells_in_session,
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
                # Identity is (key, amount): the same key for a different
                # amount is a different transaction and must fail. A different
                # trace_id with the same amount is a client retry that dropped
                # the trace (fresh traces are minted per request) — replay the
                # same order rather than 409ing a safe retry.
                if existing.amount_paise != cart.total_paise:
                    raise IdempotencyReuseError("Idempotency key cannot be reused for a different transaction")
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
            # Persist to database. The (merchant_id, idempotency_key) unique
            # constraint is the cross-worker backstop: if a concurrent process
            # won the race, resolve against the winner instead of duplicating.
            try:
                self.order_repo.save(order)
            except IntegrityError:
                winner = self.order_repo.for_idempotency_key(
                    self.merchant_scope, idempotency_key
                )
                if winner is None:
                    raise
                if winner.amount_paise != cart.total_paise:
                    raise IdempotencyReuseError(
                        "Idempotency key cannot be reused for a different transaction"
                    ) from None
                self._orders[winner.order_id] = winner
                self._idempotency_keys[idempotency_key] = winner.order_id
                return winner
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
                merchant_id=self.merchant_scope,
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
        # The order lock makes consume + transition atomic against concurrent
        # start_payment calls for the same order.
        with self._order_lock:
            order = self.get_order(order_id)
            # Validate the transition BEFORE burning the single-use consent:
            # a failed transition must leave the consent ISSUED so the order
            # stays recoverable instead of bricking.
            transition(order.status, OrderStatus.CONSENTED)
            try:
                used_consent = self.consent_service.consume(
                    consent_id,
                    order_id=order.order_id,
                    amount_paise=order.amount_paise,
                    payee_id=order.merchant_id,
                )
            except ConsentValidationError:
                # The expiry flip happens in memory; persist it so a restart
                # cannot resurrect an expired consent as ISSUED.
                current = self.consent_service.get(consent_id)
                if current is not None and current.status is ConsentStatus.EXPIRED:
                    self.consent_repo.save(current)
                raise
            # Persist updated consent
            self.consent_repo.save(used_consent)
            updated_order = order.model_copy(update={"status": OrderStatus.CONSENTED})
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
        # DB-first: webhook settlement (or another replica) may have advanced
        # the order after this core hydrated. Foreign orders are invisible.
        order = self.order_repo.get(order_id)
        if order is None or order.merchant_id != self.merchant_scope:
            raise ValueError("Order does not exist")
        self._orders[order_id] = order
        return order

    def attach_provider_refs(
        self,
        order_id: str,
        *,
        link_id: str,
        provider_order_id: str | None,
        payment_url: str | None = None,
    ) -> Order:
        """Persist the provider payment-link references on the order.

        Webhook settlement must survive process restarts, so the provider
        identifiers live in the database, not only in memory. The payment URL
        is persisted too so rebuilt attempts stay payable.
        """
        order = self.get_order(order_id)
        updated = order.model_copy(
            update={
                "provider_link_id": link_id,
                "provider_order_id": provider_order_id,
                "provider_payment_url": payment_url,
            }
        )
        self._orders[order_id] = updated
        self.order_repo.save(updated)
        return updated

    def find_order_by_provider(
        self, *, link_id: str | None = None, provider_order_id: str | None = None
    ) -> Order | None:
        """Locate an order by persisted provider reference (webhook path)."""
        order = self.order_repo.for_provider(link_id=link_id, provider_order_id=provider_order_id)
        if order is not None:
            self._orders.setdefault(order.order_id, order)
        return order

    def get_order_by_idempotency_key(self, idempotency_key: str) -> Order | None:
        # DB-backed (not just the in-memory map) so replay detection works
        # across processes and restarts.
        order = self.order_repo.for_idempotency_key(self.merchant_scope, idempotency_key)
        if order is None:
            return None
        self._orders[order.order_id] = order
        self._idempotency_keys[idempotency_key] = order.order_id
        return order

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

    def mark_fulfilled(self, order_id: str) -> Order:
        return self._transition_order(
            order_id,
            OrderStatus.FULFILLED,
            action="order.fulfilled",
            explanation="The merchant marked the paid order as fulfilled.",
        )

    def mark_refunded(self, order_id: str, *, provider_ref: str, partial: bool = False) -> Order:
        """Settle a provider-confirmed refund onto the order.

        Full refunds move PAID/FULFILLED → REFUNDED. Partial refunds keep the
        order PAID and only leave a ledger trail (plus the refund record).
        """
        if partial:
            order = self.get_order(order_id)
            self._record(
                trace_id=order.trace_id,
                actor=LedgerActor.COMMERCE_CORE,
                action="refund.partial_settled",
                inputs={"order_id": order_id},
                output={"status": order.status},
                reasoning_summary="A partial provider refund settled; the order stays PAID.",
                provider_ref=provider_ref,
                outcome_effect={"order_state": order.status},
            )
            return order
        return self._transition_order(
            order_id,
            OrderStatus.REFUNDED,
            action="refund.settled",
            explanation="A provider-confirmed full refund settled the order.",
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
                merchant_id=self.merchant_scope,
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
        # DB-first so externally-advanced state (webhook settlement by another
        # process/replica) is always reflected.
        return list(self.order_repo.all(merchant_id=self.merchant_scope))

    def get_policy(self) -> MerchantPolicy:
        return self.policy

    def update_policy(self, **kwargs: object) -> None:
        merged = {**self.policy.model_dump(), **kwargs}
        self.policy = MerchantPolicy.model_validate(merged)
