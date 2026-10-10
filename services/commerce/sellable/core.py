"""The Phase 1 deterministic transaction flow, intentionally usable without an LLM."""

from __future__ import annotations

import json
import logging
import threading
from datetime import timedelta
from pathlib import Path

from sellable.authorization import AuthorizationService
from sellable.cart import CartService
from sellable.catalog import CatalogService
from sellable.checkout import CheckoutService
from sellable.consent import ConsentService, ConsentValidationError
from sellable.connectors.base import ConnectorConfig
from sellable.connectors.service import ConnectorService
from sellable.contracts import (
    Cart,
    CartItem,
    CartLine,
    CartMandate,
    Checkout,
    CheckoutStatus,
    Consent,
    ConsentStatus,
    EscalationPayload,
    FulfillmentStatus,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    MerchantPolicy,
    Order,
    OrderStatus,
    PolicyDecision,
    PolicyVerdict,
    Promotion,
    PromotionResult,
    Quote,
    QuoteNegotiationOutcome,
    RefundRequestStatus,
    ReturnStatus,
    RiskLevel,
    ShippingMethod,
    ShippingMethodConfig,
    ShippingOption,
    SupportCase,
    SupportCasePriority,
    SupportCategory,
    TaxRate,
    TrustTier,
    utc_now,
)
from sellable.delegations import AuthorizationOutcome, OperationScope
from sellable.events import new_event
from sellable.ledger.service import LedgerRepository
from sellable.orders import transition
from sellable.policy import PolicyEngine
from sellable.pricing import PricingService
from sellable.promotions import PromotionEngine
from sellable.quotes import QuoteService
from sellable.repositories import (
    AgentIdentityRepository,
    CartRepository,
    CatalogRepository,
    CheckoutRepository,
    ConsentRepository,
    ConnectorRepository,
    DelegationRepository,
    FraudRepository,
    FulfillmentRepository,
    IdentityLinkRepository,
    MerchantOnboardingRepository,
    MerchantRepository,
    OrderRepository,
    OutboxRepository,
    PromotionRepository,
    ProtocolSessionRepository,
    QuoteRepository,
    ReturnRepository,
    RiskRepository,
    ShippingMethodRepository,
    SupportCaseRepository,
    TaxRateRepository,
    TrustEventRepository,
)
from sellable.returns import ReturnService
from sellable.risk import FraudService, RiskService
from sellable.shipping import FulfillmentService, ShippingService
from sellable.support import CaseService, build_escalation_payload
from sellable.tax import TaxService
from sellable.tracing import Span, traced
from sellable.trust import TrustService

from sqlalchemy.exc import IntegrityError


logger = logging.getLogger(__name__)


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
        delegation_repo: DelegationRepository | None = None,
        authorization_service: AuthorizationService | None = None,
        outbox_repo: OutboxRepository | None = None,
        cart_repo: CartRepository | None = None,
        cart_service: CartService | None = None,
        promotion_repo: PromotionRepository | None = None,
        quote_repo: QuoteRepository | None = None,
        checkout_repo: CheckoutRepository | None = None,
        pricing_service: PricingService | None = None,
        promotion_engine: PromotionEngine | None = None,
        quote_service: QuoteService | None = None,
        checkout_service: CheckoutService | None = None,
        tax_repo: TaxRateRepository | None = None,
        shipping_repo: ShippingMethodRepository | None = None,
        fulfillment_repo: FulfillmentRepository | None = None,
        return_repo: ReturnRepository | None = None,
        tax_service: TaxService | None = None,
        shipping_service: ShippingService | None = None,
        fulfillment_service: FulfillmentService | None = None,
        return_service: ReturnService | None = None,
        agent_repo: AgentIdentityRepository | None = None,
        merchant_repo: MerchantRepository | None = None,
        onboarding_repo: MerchantOnboardingRepository | None = None,
        risk_repo: RiskRepository | None = None,
        fraud_repo: FraudRepository | None = None,
        trust_event_repo: TrustEventRepository | None = None,
        case_repo: SupportCaseRepository | None = None,
        session_repo: ProtocolSessionRepository | None = None,
        identity_repo: IdentityLinkRepository | None = None,
        connector_repo: ConnectorRepository | None = None,
        connector_service: ConnectorService | None = None,
        risk_service: RiskService | None = None,
        fraud_service: FraudService | None = None,
        trust_service: TrustService | None = None,
        case_service: CaseService | None = None,
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
        self.delegation_repo = delegation_repo or DelegationRepository(engine=engine)
        self.authorization_service = (
            authorization_service
            or AuthorizationService(
                delegation_lookup=self.delegation_repo,
                usage_lookup=self._delegation_usage,
            )
        )
        self.outbox_repo = outbox_repo or OutboxRepository(engine=engine)
        self.cart_repo = cart_repo or CartRepository(engine=engine)
        self.cart_service = cart_service or CartService(catalog, self.cart_repo)
        self.promotion_repo = promotion_repo or PromotionRepository(engine=engine)
        self.quote_repo = quote_repo or QuoteRepository(engine=engine)
        self.checkout_repo = checkout_repo or CheckoutRepository(engine=engine)
        self.pricing_service = pricing_service or PricingService(catalog)
        self.promotion_engine = promotion_engine or PromotionEngine()
        self.quote_service = quote_service or QuoteService(
            catalog, self.quote_repo, policy
        )
        self.checkout_service = checkout_service or CheckoutService(
            catalog=catalog,
            pricing=self.pricing_service,
            promotion_engine=self.promotion_engine,
            checkout_repo=self.checkout_repo,
            cart_repo=self.cart_repo,
            promotion_repo=self.promotion_repo,
            quote_repo=self.quote_repo,
            delegation_lookup=self.delegation_repo,
            order_repo=self.order_repo,
            usage_lookup=self._delegation_usage,
        )
        self.tax_repo = tax_repo or TaxRateRepository(engine=engine)
        self.shipping_repo = shipping_repo or ShippingMethodRepository(engine=engine)
        self.fulfillment_repo = fulfillment_repo or FulfillmentRepository(engine=engine)
        self.return_repo = return_repo or ReturnRepository(engine=engine)
        self.tax_service = tax_service or TaxService(catalog, self.tax_repo)
        self.shipping_service = shipping_service or ShippingService(self.shipping_repo)
        self.fulfillment_service = fulfillment_service or FulfillmentService(
            self.fulfillment_repo
        )
        self.return_service = return_service or ReturnService(
            catalog, self.return_repo, self.order_repo, self.fulfillment_repo
        )
        self.agent_repo = agent_repo or AgentIdentityRepository(engine=engine)
        self.merchant_repo = merchant_repo or MerchantRepository(engine=engine)
        self.onboarding_repo = onboarding_repo or MerchantOnboardingRepository(
            engine=engine
        )
        self.risk_repo = risk_repo or RiskRepository(engine=engine)
        self.fraud_repo = fraud_repo or FraudRepository(engine=engine)
        self.trust_event_repo = trust_event_repo or TrustEventRepository(engine=engine)
        self.case_repo = case_repo or SupportCaseRepository(engine=engine)
        self.session_repo = session_repo or ProtocolSessionRepository(engine=engine)
        self.identity_repo = identity_repo or IdentityLinkRepository(engine=engine)
        self.connector_repo = connector_repo or ConnectorRepository(engine=engine)
        self.connector_service = connector_service or ConnectorService(
            self.connector_repo, CatalogRepository(engine=engine)
        )
        self.fraud_service = fraud_service or FraudService(self.fraud_repo)
        self.risk_service = risk_service or RiskService(
            order_repo=self.order_repo,
            ledger=self.ledger,
            delegation_lookup=self.delegation_repo,
            agent_lookup=self.agent_repo,
            fraud_service=self.fraud_service,
            risk_repo=self.risk_repo,
            policy=self.policy,
        )
        self.trust_service = trust_service or TrustService(
            agent_repo=self.agent_repo,
            merchant_repo=self.merchant_repo,
            onboarding_repo=self.onboarding_repo,
            order_repo=self.order_repo,
            delegation_repo=self.delegation_repo,
            trust_event_repo=self.trust_event_repo,
            ledger=self.ledger,
        )
        self.case_service = case_service or CaseService(self.case_repo)
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

    # ------------------------------------------------------------------
    # Persistent carts (target §18.2, §21.1). Thin delegates: the
    # CartService owns domain rules; the core adds attribution (ledger)
    # and fan-out (outbox cart.updated). Quote/order paths are untouched.
    # ------------------------------------------------------------------

    def create_cart(
        self,
        *,
        trace_id: str,
        customer_id: str | None = None,
        agent_session_id: str | None = None,
    ) -> Cart:
        cart = self.cart_service.create_cart(
            self.merchant_scope,
            customer_id=customer_id,
            agent_session_id=agent_session_id,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="cart.created",
            inputs={"cart_id": cart.cart_id},
            output={"status": cart.status.value, "version": cart.version},
            reasoning_summary="Created a persistent, versioned cart for the session.",
            outcome_effect={"cart_state": cart.status.value},
        )
        self._publish_cart_outbox(cart, trace_id=trace_id)
        return cart

    def get_cart(self, cart_id: str) -> Cart:
        return self.cart_service.get_cart(cart_id, self.merchant_scope)

    def cart_add_item(
        self, cart_id: str, sku: str, quantity: int, *, expected_version: int, trace_id: str
    ) -> Cart:
        return self._mutate_cart(
            trace_id=trace_id,
            action="cart.updated",
            detail=f"Added {quantity} x {sku}.",
            mutate=lambda: self.cart_service.add_item(
                cart_id, self.merchant_scope, sku, quantity, expected_version=expected_version
            ),
        )

    def cart_set_quantity(
        self, cart_id: str, sku: str, quantity: int, *, expected_version: int, trace_id: str
    ) -> Cart:
        return self._mutate_cart(
            trace_id=trace_id,
            action="cart.updated",
            detail=f"Set {sku} quantity to {quantity}.",
            mutate=lambda: self.cart_service.set_quantity(
                cart_id, self.merchant_scope, sku, quantity, expected_version=expected_version
            ),
        )

    def cart_remove_item(
        self, cart_id: str, sku: str, *, expected_version: int, trace_id: str
    ) -> Cart:
        return self._mutate_cart(
            trace_id=trace_id,
            action="cart.updated",
            detail=f"Removed {sku}.",
            mutate=lambda: self.cart_service.remove_item(
                cart_id, self.merchant_scope, sku, expected_version=expected_version
            ),
        )

    def cart_start_checkout(
        self, cart_id: str, *, expected_version: int, trace_id: str
    ) -> Cart:
        return self._mutate_cart(
            trace_id=trace_id,
            action="cart.checkout_started",
            detail="Locked the cart for the checkout transaction.",
            mutate=lambda: self.cart_service.start_checkout(
                cart_id, self.merchant_scope, expected_version=expected_version
            ),
        )

    def _mutate_cart(self, *, trace_id: str, action: str, detail: str, mutate) -> Cart:
        cart = mutate()
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action=action,
            inputs={"cart_id": cart.cart_id},
            output={
                "status": cart.status.value,
                "version": cart.version,
                "grand_total_paise": cart.grand_total_paise,
            },
            reasoning_summary=detail + " Prices re-snapshotted from the catalog.",
            outcome_effect={"cart_state": cart.status.value},
        )
        self._publish_cart_outbox(cart, trace_id=trace_id)
        return cart

    def _publish_cart_outbox(self, cart: Cart, *, trace_id: str) -> None:
        try:
            self.outbox_repo.publish(
                new_event(
                    event_type="cart.updated",
                    tenant_id=cart.merchant_id,
                    merchant_id=cart.merchant_id,
                    aggregate_type="cart",
                    aggregate_id=cart.cart_id,
                    trace_id=trace_id,
                    actor_type="commerce_core",
                    actor_id=self.merchant_scope,
                    data={
                        "status": cart.status.value,
                        "version": cart.version,
                        "grand_total_paise": cart.grand_total_paise,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 — outbox is additive
            logger.warning("Outbox publish failed for cart.updated: %s", exc)

    # ------------------------------------------------------------------
    # Quotes, promotions, checkout (target §18.3, §18.4, §20). Thin
    # delegates: domain services own the rules; the core adds attribution
    # (ledger) and fan-out (outbox checkout.completed).
    # ------------------------------------------------------------------

    def create_promotion(self, promotion: Promotion) -> Promotion:
        if promotion.merchant_id != self.merchant_scope:
            raise ValueError("promotion merchant does not match this core")
        self.promotion_repo.save(promotion)
        return promotion

    def evaluate_promotions(
        self,
        cart_id: str,
        *,
        trace_id: str,
        coupon_code: str | None = None,
        channel: str = "agent",
    ) -> PromotionResult:
        from sellable.promotions import PromotionLine

        cart = self.cart_service.get_cart(cart_id, self.merchant_scope)
        lines = [
            PromotionLine(
                sku=line.sku,
                quantity=line.quantity,
                unit_price_paise=line.unit_price_paise,
                category=self.catalog.get(line.sku).category,
            )
            for line in cart.items
        ]
        result = self.promotion_engine.evaluate(
            lines=lines,
            promotions=self.promotion_repo.active_for_merchant(self.merchant_scope),
            customer_id=cart.customer_id,
            channel=channel,
            coupon_code=coupon_code,
            usage=self.promotion_repo.usage(self.merchant_scope),
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="promotion.evaluated",
            inputs={"cart_id": cart_id, "coupon_code": coupon_code},
            output={
                "applied": result.applied_promotion_ids,
                "discount_total_paise": result.discount_total_paise,
            },
            reasoning_summary="Evaluated eligible promotions against authoritative cart state.",
            policy_refs=["PROMOTION.eligibility"],
        )
        return result

    def create_quote(self, cart_id: str, *, trace_id: str) -> Quote:
        cart = self.cart_service.get_cart(cart_id, self.merchant_scope)
        quote = self.quote_service.create_from_cart(cart)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="quote.created",
            inputs={"cart_id": cart_id},
            output={
                "quote_id": quote.quote_id,
                "negotiated_subtotal_paise": quote.negotiated_subtotal_paise,
            },
            reasoning_summary="Snapshotted the cart into a bounded commercial offer.",
            outcome_effect={"quote_state": quote.status.value},
        )
        return quote

    def negotiate_quote(
        self, quote_id: str, proposed_total_paise: int, *, trace_id: str
    ) -> QuoteNegotiationOutcome:
        from sellable.quotes import QuoteNegotiation

        negotiation: QuoteNegotiation = self.quote_service.negotiate(
            quote_id, self.merchant_scope, proposed_total_paise
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="quote.negotiated",
            inputs={"quote_id": quote_id, "proposed_total_paise": proposed_total_paise},
            output={
                "outcome": negotiation.outcome.value,
                "negotiated_subtotal_paise": negotiation.quote.negotiated_subtotal_paise,
                "round_number": negotiation.quote.round_number,
            },
            reasoning_summary=f"Negotiation {negotiation.outcome.value.lower()}: {negotiation.reason_code}.",
            policy_refs=["POLICY.negotiation_bounds"],
            outcome_effect={"quote_state": negotiation.quote.status.value},
        )
        return negotiation.outcome

    def create_checkout(
        self,
        cart_id: str,
        *,
        trace_id: str,
        delegation_id: str | None = None,
        quote_id: str | None = None,
    ) -> Checkout:
        checkout = self.checkout_service.create_from_cart(
            cart_id,
            self.merchant_scope,
            delegation_id=delegation_id,
            quote_id=quote_id,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.created",
            inputs={"cart_id": cart_id, "quote_id": quote_id},
            output={
                "checkout_id": checkout.checkout_id,
                "status": checkout.status.value,
            },
            reasoning_summary="Opened a first-class checkout session from the locked cart.",
            outcome_effect={"checkout_state": checkout.status.value},
        )
        return checkout

    def checkout_validate(self, checkout_id: str, *, trace_id: str) -> Checkout:
        return self._checkout_step(
            checkout_id, trace_id=trace_id, action="checkout.validated",
            step=lambda: self.checkout_service.validate(checkout_id, self.merchant_scope),
        )

    def checkout_price(
        self,
        checkout_id: str,
        *,
        trace_id: str,
        coupon_code: str | None = None,
        channel: str = "agent",
        tax_total_paise: int = 0,
        shipping_total_paise: int = 0,
    ) -> Checkout:
        priced, _ = self.checkout_service.price(
            checkout_id,
            self.merchant_scope,
            coupon_code=coupon_code,
            channel=channel,
            tax_total_paise=tax_total_paise,
            shipping_total_paise=shipping_total_paise,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.priced",
            inputs={"checkout_id": checkout_id},
            output={
                "status": priced.status.value,
                "grand_total_paise": priced.grand_total_paise,
                "applied_promotions": priced.applied_promotion_ids,
            },
            reasoning_summary="Priced the checkout from authoritative services; promotions evaluated deterministically.",
            outcome_effect={"checkout_state": priced.status.value},
        )
        return priced

    @traced("checkout.authorize")
    def checkout_authorize(self, checkout_id: str, *, trace_id: str) -> Checkout:
        from sellable.contracts import CheckoutStatus as _CheckoutStatus

        pending = self.checkout_service.get_checkout(checkout_id, self.merchant_scope)
        if pending.status is not _CheckoutStatus.PRICED:
            raise ValueError("checkout must be PRICED before authorization")
        assessment = self.risk_service.assess(
            merchant_id=self.merchant_scope,
            amount_paise=pending.grand_total_paise,
            subject_id=pending.customer_id or pending.agent_session_id,
            agent_id=self._risk_agent_for(pending),
            delegation_id=pending.delegation_id,
            trust_tier=self._risk_tier_for(pending),
            approval_threshold_paise=self.policy.human_approval_threshold_paise,
            max_order_paise=self.policy.max_order_value_paise,
            trace_id=trace_id,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.RISK_ENGINE,
            action=(
                "risk.blocked"
                if assessment.level is RiskLevel.BLOCK
                else "risk.assessed"
            ),
            inputs={"checkout_id": checkout_id, "amount_paise": pending.grand_total_paise},
            output={
                "level": assessment.level.value,
                "score_bps": assessment.score_bps,
                "reasons": assessment.reasons,
            },
            reasoning_summary="Evaluated transaction risk before authorization.",
            policy_refs=[f"RISK.{reason}" for reason in assessment.reasons[:5]],
        )
        if assessment.level is RiskLevel.BLOCK:
            self.checkout_service.reject(checkout_id, self.merchant_scope)
            self._publish_bus_event(
                event_type="risk.action_taken",
                tenant_id=self.merchant_scope,
                merchant_id=self.merchant_scope,
                aggregate_type="checkout",
                aggregate_id=checkout_id,
                trace_id=trace_id,
                actor_type="risk_engine",
                actor_id=self.merchant_scope,
                data={
                    "level": assessment.level.value,
                    "reasons": assessment.reasons,
                    "decision_id": assessment.decision_id,
                },
            )
            raise ValueError(
                f"Checkout blocked by risk: {','.join(assessment.reasons)}"
            )
        if assessment.level in (
            RiskLevel.REQUIRE_HUMAN,
            RiskLevel.REQUIRE_CUSTOMER,
            RiskLevel.STEP_UP_AUTH,
        ):
            raise ValueError(f"Checkout held by risk: {assessment.level.value}")
        reference = f"{assessment.level.value}:{assessment.decision_id}"
        reviewed = self.checkout_service.review_risk(
            checkout_id, self.merchant_scope, risk_reference=reference
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.risk_reviewed",
            inputs={"checkout_id": checkout_id},
            output={"status": reviewed.status.value, "risk_reference": reference},
            reasoning_summary="Risk review recorded; deterministic engine evaluated the transaction.",
            outcome_effect={"checkout_state": reviewed.status.value},
        )
        authorized = self.checkout_service.authorize(checkout_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.AUTHORIZATION_SERVICE,
            action="checkout.authorized",
            inputs={"checkout_id": checkout_id},
            output={
                "status": authorized.status.value,
                "price_hash": authorized.price_hash,
            },
            reasoning_summary="Bound the authorization to the exact priced state.",
            outcome_effect={"checkout_state": authorized.status.value},
        )
        return authorized

    def checkout_complete(
        self, checkout_id: str, order_id: str, *, trace_id: str
    ) -> Checkout:
        pending = self.checkout_service.mark_payment_pending(checkout_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.payment_pending",
            inputs={"checkout_id": checkout_id},
            output={"status": pending.status.value},
            reasoning_summary="Checkout awaits provider confirmation against the bound total.",
            outcome_effect={"checkout_state": pending.status.value},
        )
        completed = self.checkout_service.complete(
            checkout_id, self.merchant_scope, order_id
        )
        self._emit_checkout_completed(completed, order_id, trace_id=trace_id)
        return completed

    def checkout_cancel(self, checkout_id: str, *, trace_id: str) -> Checkout:
        return self._checkout_step(
            checkout_id, trace_id=trace_id, action="checkout.cancelled",
            step=lambda: self.checkout_service.cancel(checkout_id, self.merchant_scope),
        )

    def _checkout_step(self, checkout_id: str, *, trace_id: str, action: str, step) -> Checkout:
        checkout = step()
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action=action,
            inputs={"checkout_id": checkout_id},
            output={
                "status": checkout.status.value,
                "grand_total_paise": checkout.grand_total_paise,
            },
            reasoning_summary=f"Checkout transition recorded: {action}.",
            outcome_effect={"checkout_state": checkout.status.value},
        )
        return checkout

    # ------------------------------------------------------------------
    # Trust, risk, and gateway helpers (target §24, §32). Recording is
    # best-effort: trust must never break commerce.
    # ------------------------------------------------------------------

    def _delegation_subject(self, delegation_id: str | None) -> str | None:
        if not delegation_id:
            return None
        try:
            grant = self.delegation_repo.get(delegation_id)
            return grant.subject_agent_id if grant else None
        except Exception:  # noqa: BLE001 — trust is additive
            return None

    def _delegation_usage(self, delegation_id: str) -> int:
        """Completed-use count for frequency limits: ledgered order
        creations carrying this delegation id (bounded scan). Resolution
        checks (gates, quotes) do not consume frequency."""
        try:
            return sum(
                1
                for record in self.ledger.all_events(
                    limit=500, merchant_id=self.merchant_scope
                )
                if record.action == "order.created"
                and (record.inputs_json or {}).get("delegation_id") == delegation_id
            )
        except Exception:  # noqa: BLE001 — usage is advisory
            return 0

    def _line_categories(self, lines) -> list[str]:
        """Catalog categories for delegation category-scope checks."""
        categories = []
        for line in lines:
            try:
                category = self.catalog.get(line.sku).category
            except Exception:  # noqa: BLE001 — unknown SKUs fail their own checks
                continue
            if category not in categories:
                categories.append(category)
        return categories

    def _record_trust_outcome(
        self, kind: str, delegation_id: str | None, *, amount_paise: int = 0, reference: str = ""
    ) -> None:
        subject = self._delegation_subject(delegation_id)
        if subject is None:
            return
        try:
            recorder = {
                "success": self.trust_service.record_success,
                "order_failure": self.trust_service.record_order_failure,
                "policy_denial": self.trust_service.record_policy_denial,
                "auth_failure": self.trust_service.record_auth_failure,
                "fraud_flag": self.trust_service.record_fraud_flag,
            }[kind]
            if kind == "success":
                recorder(
                    subject,
                    merchant_id=self.merchant_scope,
                    amount_paise=amount_paise,
                    reference=reference,
                )
            else:
                recorder(subject, merchant_id=self.merchant_scope, reference=reference)
        except Exception as exc:  # noqa: BLE001 — trust is additive
            logger.warning("Trust recording failed for %s: %s", kind, exc)

    def _flag_credential_abuse(
        self, delegation_id: str, *, trace_id: str, detail: str
    ) -> None:
        subject = self._delegation_subject(delegation_id)
        if subject is None:
            return
        try:
            from sellable.contracts import FraudKind

            self.fraud_service.flag(
                merchant_id=self.merchant_scope,
                kind=FraudKind.CREDENTIAL_ABUSE,
                subject_type="agent",
                subject_id=subject,
                detail={"delegation_id": delegation_id, "detail": detail},
                trace_id=trace_id,
            )
            self._record_trust_outcome("fraud_flag", delegation_id, reference=delegation_id)
        except Exception as exc:  # noqa: BLE001 — trust is additive
            logger.warning("Fraud flagging failed: %s", exc)

    def _risk_agent_for(self, checkout: Checkout) -> str | None:
        subject = self._delegation_subject(checkout.delegation_id)
        return subject or checkout.agent_session_id

    def _risk_tier_for(self, checkout: Checkout):
        agent = self._risk_agent_for(checkout)
        if agent is None:
            return None
        try:
            return self.trust_service.agent_assessment(agent, self.merchant_scope).tier
        except Exception:  # noqa: BLE001 — trust is additive
            return None

    def log_gateway_authorization(
        self, *, trace_id: str, decision, route: str
    ):
        """Attribute a gateway delegation decision in the ledger (§4.4)."""
        outcome = decision.outcome.value
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.AUTHORIZATION_SERVICE,
            action=(
                "authorization.denied"
                if outcome == "DENY"
                else "authorization.held"
                if outcome.startswith("REQUIRE")
                else "authorization.checked"
            ),
            inputs={"route": route, "delegation_id": decision.delegation_id},
            output={"outcome": outcome, "reason_code": decision.reason_code},
            reasoning_summary=f"Gateway resolved delegation for {route}: {outcome}.",
            policy_refs=decision.matched_policies,
        )
        return decision

    # ------------------------------------------------------------------
    # Human escalation (target §26.3): full-context handoff cases.
    # ------------------------------------------------------------------

    def escalate_support(
        self,
        *,
        trace_id: str,
        customer_summary: str,
        issue_classification: str,
        recommended_next_action: str,
        order_id: str | None = None,
        checkout_id: str | None = None,
        customer_id: str | None = None,
        agent_id: str | None = None,
        category: SupportCategory = SupportCategory.OTHER,
        priority: SupportCasePriority = SupportCasePriority.MEDIUM,
        actions_attempted: list[str] | None = None,
        risk_flags: list[str] | None = None,
    ) -> SupportCase:
        """Open a support case with a complete escalation payload: order +
        checkout context auto-attached, policy constraints and trace linked."""
        order_context: dict[str, object] = {}
        policy_constraints: list[str] = []
        from sellable.privacy import redact_pii

        customer_summary = redact_pii(customer_summary) or customer_summary
        recommended_next_action = (
            redact_pii(recommended_next_action) or recommended_next_action
        )
        try:
            if order_id is not None:
                order = self.get_order(order_id)
                order_context["order"] = {
                    "order_id": order.order_id,
                    "status": order.status.value,
                    "amount_paise": order.amount_paise,
                }
                policy_constraints.append(f"order_state:{order.status.value}")
        except Exception:  # noqa: BLE001 — context is best-effort
            pass
        try:
            if checkout_id is not None:
                checkout = self.checkout_service.get_checkout(
                    checkout_id, self.merchant_scope
                )
                order_context["checkout"] = {
                    "checkout_id": checkout.checkout_id,
                    "status": checkout.status.value,
                    "grand_total_paise": checkout.grand_total_paise,
                }
        except Exception:  # noqa: BLE001 — context is best-effort
            pass
        payload: EscalationPayload = build_escalation_payload(
            customer_summary=customer_summary,
            issue_classification=issue_classification,
            order_context=order_context,
            actions_attempted=actions_attempted,
            policy_constraints=policy_constraints,
            risk_flags=risk_flags,
            recommended_next_action=recommended_next_action,
            trace_id=trace_id,
        )
        case = self.case_service.open_case(
            self.merchant_scope,
            customer_summary,
            customer_id=customer_id,
            agent_id=agent_id,
            order_id=order_id,
            checkout_id=checkout_id,
            category=category,
            priority=priority,
            context={},
        )
        escalated = self.case_service.escalate(case.case_id, self.merchant_scope, payload)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="support.case.escalated",
            inputs={"case_id": case.case_id, "classification": issue_classification},
            output={"status": escalated.status.value},
            reasoning_summary="Escalated to human support with full order, policy, and risk context.",
            outcome_effect={"case_state": escalated.status.value},
        )
        try:
            self.outbox_repo.publish(
                new_event(
                    event_type="support.case.updated",
                    tenant_id=self.merchant_scope,
                    merchant_id=self.merchant_scope,
                    aggregate_type="support_case",
                    aggregate_id=case.case_id,
                    trace_id=trace_id,
                    actor_type="commerce_core",
                    actor_id=self.merchant_scope,
                    data={"status": escalated.status.value},
                )
            )
        except Exception as exc:  # noqa: BLE001 — outbox is additive
            logger.warning("Outbox publish failed for support.case.updated: %s", exc)
        return escalated

    def support_case_get(self, case_id: str) -> SupportCase:
        return self.case_service.get_case(case_id, self.merchant_scope)

    def support_cases_open(self) -> list[SupportCase]:
        return self.case_service.list_open(self.merchant_scope)

    def refresh_onboarding_readiness(
        self, *, trace_id: str, payment_configured: bool, webhook_configured: bool,
        sandbox_repo=None,
    ) -> dict[str, bool]:
        """Run automated pre-activation checks (§10.3) and record passing
        ones on the merchant onboarding row."""
        from sellable.onboarding import MerchantOnboarding, validate_readiness

        results = validate_readiness(
            catalog=self.catalog,
            policy=self.policy,
            promotion_repo=self.promotion_repo,
            shipping_service=self.shipping_service,
            merchant_id=self.merchant_scope,
            payment_configured=payment_configured,
            webhook_configured=webhook_configured,
            sandbox_repo=sandbox_repo,
        )
        onboarding = self.onboarding_repo.get(self.merchant_scope) or MerchantOnboarding(
            merchant_id=self.merchant_scope
        )
        for check, passed in results.items():
            if passed:
                onboarding = onboarding.record_check(check)
        self.onboarding_repo.save(onboarding)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="onboarding.validated",
            inputs={"merchant_id": self.merchant_scope},
            output={
                "passed": sorted(c for c, ok in results.items() if ok),
                "failed": sorted(c for c, ok in results.items() if not ok),
                "activation_ready": onboarding.is_activation_ready,
            },
            reasoning_summary="Ran automated merchant readiness checks before activation.",
        )
        return results

    # ------------------------------------------------------------------
    # Merchant connectors (target §3): register, health-check, and sync
    # source systems into the canonical catalog. Secrets never persist —
    # the repository strips secret-looking headers on write.
    # ------------------------------------------------------------------

    def connector_register(self, config: ConnectorConfig, *, trace_id: str) -> dict:
        if config.merchant_id != self.merchant_scope:
            raise ValueError("connector merchant does not match this core")
        saved = self.connector_service.register(config)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="connector.registered",
            inputs={"connector_id": config.connector_id, "provider": config.provider},
            output={"connector_id": saved["connector_id"]},
            reasoning_summary="Registered a merchant source-system connector.",
        )
        return saved

    def connector_list(self) -> list[dict]:
        return self.connector_service.list_for_merchant(self.merchant_scope)

    def connector_remove(self, connector_id: str, *, trace_id: str) -> None:
        if not self.connector_service.remove(connector_id, self.merchant_scope):
            raise ValueError(f"Unknown connector: {connector_id}")
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="connector.removed",
            inputs={"connector_id": connector_id},
            output={},
            reasoning_summary="Removed a merchant source-system connector.",
        )

    def connector_health(self, connector_id: str, *, trace_id: str) -> dict:
        health = self.connector_service.health(connector_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="connector.health_checked",
            inputs={"connector_id": connector_id},
            output={"ok": health.ok, "latency_ms": health.latency_ms},
            reasoning_summary="Probed the merchant source system.",
        )
        return {"connector_id": connector_id, "ok": health.ok, "detail": health.detail}

    def connector_sync(
        self, connector_id: str, *, trace_id: str, limit: int = 500, fetcher=None
    ) -> dict:
        """Pull source products, normalize to canonical Products, upsert
        into the merchant catalog, and refresh the in-memory service."""
        try:
            result = self.connector_service.sync_catalog(
                connector_id, self.merchant_scope, limit=limit, fetcher=fetcher
            )
        except Exception as error:
            self._record(
                trace_id=trace_id,
                actor=LedgerActor.COMMERCE_CORE,
                action="connector.sync_failed",
                inputs={"connector_id": connector_id},
                output={"error": str(error)[:300]},
                reasoning_summary="Connector catalog sync failed; catalog untouched.",
            )
            raise
        # Refresh the long-lived in-memory service from the database truth
        # (add new SKUs, overwrite changed rows in place).
        for product in CatalogRepository(
            engine=self.connector_repo._engine
        ).list(self.merchant_scope):
            try:
                self.catalog.add_product(product)
            except ValueError:
                self.catalog._products[product.sku] = product
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="connector.synced",
            inputs={"connector_id": connector_id},
            output=result,
            reasoning_summary="Synced source products into the canonical catalog.",
        )
        return result

    # ------------------------------------------------------------------
    # Tax, shipping, fulfillment (target §22, §23). Thin delegates with
    # ledger attribution; deterministic services own the math.
    # ------------------------------------------------------------------

    def set_tax_rate(self, rate: TaxRate) -> TaxRate:
        if rate.merchant_id != self.merchant_scope:
            raise ValueError("tax rate merchant does not match this core")
        return self.tax_service.set_rate(rate)

    def configure_shipping(self, config: ShippingMethodConfig) -> ShippingMethodConfig:
        if config.merchant_id != self.merchant_scope:
            raise ValueError("shipping config merchant does not match this core")
        return self.shipping_service.configure(config)

    def shipping_options(self, pincode: str, *, free_shipping: bool = False) -> list[ShippingOption]:
        return self.shipping_service.quote(
            self.merchant_scope, pincode, free_shipping=free_shipping
        )

    def checkout_apply_tax_shipping(
        self,
        checkout_id: str,
        *,
        trace_id: str,
        merchant_state: str | None = None,
        customer_state: str | None = None,
        method: ShippingMethod = ShippingMethod.STANDARD,
        pincode: str = "",
    ) -> Checkout:
        """Compute deterministic tax + shipping for a PRICED checkout and
        re-price with them. Free-shipping promotions zero the standard
        option automatically inside the price step."""
        checkout = self.checkout_service.get_checkout(checkout_id, self.merchant_scope)
        if checkout.status is not CheckoutStatus.PRICED:
            raise ValueError("checkout must be PRICED before tax and shipping apply")
        cart_lines = [
            CartLine(sku=l.sku, quantity=l.quantity, unit_price_paise=l.unit_price_paise)
            for l in checkout.lines
        ]
        tax = self.tax_service.calculate(
            cart_lines,
            merchant_id=self.merchant_scope,
            merchant_state=merchant_state,
            customer_state=customer_state,
        )
        options = self.shipping_service.quote(
            self.merchant_scope,
            pincode,
            free_shipping=checkout.free_shipping_applied,
        )
        option = next((o for o in options if o.method is method), None)
        if option is None or not option.serviceable:
            raise ValueError(f"shipping method {method.value} is not serviceable")
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.tax_shipping_applied",
            inputs={"checkout_id": checkout_id, "method": method.value},
            output={
                "tax_total_paise": tax.tax_total_paise,
                "shipping_total_paise": option.price_paise,
                "calculation_reference": tax.calculation_reference,
            },
            reasoning_summary="Applied deterministic tax lines and the selected shipping option.",
        )
        return self.checkout_price(
            checkout_id,
            trace_id=trace_id,
            tax_total_paise=tax.tax_total_paise,
            shipping_total_paise=option.price_paise,
        )

    def create_fulfillment(
        self, order_id: str, method: ShippingMethod, *, trace_id: str,
        issue_label: bool = False, carrier: str = "manual", pincode: str = "",
    ) -> object:
        from sellable.connectors.shipping import carrier_for

        order = self.get_order(order_id)
        if order.status is not OrderStatus.PAID:
            raise ValueError("fulfillment requires a paid order")
        tracking_reference = None
        carrier_name = None
        if issue_label:
            label = carrier_for(carrier).create_shipment(
                order_id=order_id,
                merchant_id=self.merchant_scope,
                method=method.value,
                destination_pincode=pincode,
            )
            tracking_reference = label.tracking_reference
            carrier_name = label.carrier
        fulfillment = self.fulfillment_service.create_for_order(
            order.order_id, self.merchant_scope, method,
            tracking_reference=tracking_reference, carrier=carrier_name,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="fulfillment.created",
            inputs={"order_id": order_id, "method": method.value},
            output={
                "fulfillment_id": fulfillment.fulfillment_id,
                "status": fulfillment.status.value,
            },
            reasoning_summary="Opened basic fulfillment for the paid order.",
            outcome_effect={"fulfillment_state": fulfillment.status.value},
        )
        return fulfillment

    def ship_fulfillment(
        self,
        fulfillment_id: str,
        *,
        trace_id: str,
        tracking_reference: str | None = None,
        carrier: str | None = None,
    ) -> object:
        fulfillment = self.fulfillment_service.mark_shipped(
            fulfillment_id,
            self.merchant_scope,
            tracking_reference=tracking_reference,
            carrier=carrier,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="fulfillment.shipped",
            inputs={"fulfillment_id": fulfillment_id},
            output={
                "status": fulfillment.status.value,
                "tracking_reference": fulfillment.tracking_reference,
            },
            reasoning_summary="Carrier collected the order; tracking reference issued.",
            outcome_effect={"fulfillment_state": fulfillment.status.value},
        )
        self._publish_bus_event(
            event_type="order.shipped",
            tenant_id=self.merchant_scope,
            merchant_id=self.merchant_scope,
            aggregate_type="order",
            aggregate_id=fulfillment.order_id,
            trace_id=trace_id,
            actor_type="commerce_core",
            actor_id=self.merchant_scope,
            data={"tracking_reference": fulfillment.tracking_reference},
        )
        return fulfillment

    def track_fulfillment(
        self, fulfillment_id: str, status: FulfillmentStatus, *, trace_id: str, location: str | None = None
    ) -> object:
        fulfillment = self.fulfillment_service.update_status(
            fulfillment_id, self.merchant_scope, status, location=location
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="fulfillment.status_updated",
            inputs={"fulfillment_id": fulfillment_id},
            output={"status": fulfillment.status.value},
            reasoning_summary="Ingested a carrier/shipping status update.",
            outcome_effect={"fulfillment_state": fulfillment.status.value},
        )
        if status is FulfillmentStatus.DELIVERED:
            self._publish_bus_event(
                event_type="order.delivered",
                tenant_id=self.merchant_scope,
                merchant_id=self.merchant_scope,
                aggregate_type="order",
                aggregate_id=fulfillment.order_id,
                trace_id=trace_id,
                actor_type="commerce_core",
                actor_id=self.merchant_scope,
                data={"tracking_reference": fulfillment.tracking_reference},
            )
        return fulfillment

    # ------------------------------------------------------------------
    # Returns, exchanges, refund asks (target §26 seed). Merchant-gated;
    # the provider refund rail executes in Phase 4.
    # ------------------------------------------------------------------

    def request_return(
        self,
        order_id: str,
        items: list[dict[str, object]],
        reason: str,
        *,
        trace_id: str,
        customer_id: str | None = None,
    ) -> object:
        from sellable.contracts import CartLine as _CartLine
        from sellable.privacy import redact_pii

        reason = redact_pii(reason) or reason
        lines = [
            _CartLine(
                sku=str(item["sku"]),
                quantity=int(item["quantity"]),
                unit_price_paise=self.catalog.get(str(item["sku"])).price_paise,
            )
            for item in items
        ]
        case = self.return_service.request_return(
            order_id,
            self.merchant_scope,
            items=lines,
            reason=reason,
            customer_id=customer_id,
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="return.requested",
            inputs={"order_id": order_id},
            output={"return_id": case.return_id, "status": case.status.value},
            reasoning_summary="Opened a post-purchase return case on the settled order.",
            outcome_effect={"return_state": case.status.value},
        )
        self._publish_bus_event(
            event_type="return.created",
            tenant_id=self.merchant_scope,
            merchant_id=self.merchant_scope,
            aggregate_type="return",
            aggregate_id=case.return_id,
            trace_id=trace_id,
            actor_type="commerce_core",
            actor_id=self.merchant_scope,
            data={"order_id": order_id},
        )
        return case

    def decide_return(
        self, return_id: str, *, approve: bool, trace_id: str
    ) -> object:
        case = (
            self.return_service.approve_return(return_id, self.merchant_scope)
            if approve
            else self.return_service.reject_return(return_id, self.merchant_scope)
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.HUMAN,
            action="return.approved" if approve else "return.rejected",
            inputs={"return_id": return_id},
            output={"status": case.status.value},
            reasoning_summary="Merchant decided the return case.",
            outcome_effect={"return_state": case.status.value},
        )
        return case

    def receive_return(self, return_id: str, *, trace_id: str) -> object:
        case = self.return_service.receive_return(return_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="return.received",
            inputs={"return_id": return_id},
            output={"status": case.status.value},
            reasoning_summary="Returned goods received back.",
            outcome_effect={"return_state": case.status.value},
        )
        return case

    def complete_return(self, return_id: str, *, trace_id: str) -> object:
        case = self.return_service.complete_return(return_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="return.completed",
            inputs={"return_id": return_id},
            output={"status": case.status.value},
            reasoning_summary="Return case closed.",
            outcome_effect={"return_state": case.status.value},
        )
        return case

    def request_exchange(
        self, return_id: str, replacement_sku: str, replacement_quantity: int, *, trace_id: str
    ) -> object:
        exchange = self.return_service.request_exchange(
            return_id, self.merchant_scope, replacement_sku, replacement_quantity
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="exchange.requested",
            inputs={"return_id": return_id, "replacement_sku": replacement_sku},
            output={"exchange_id": exchange.exchange_id, "status": exchange.status.value},
            reasoning_summary="Linked a replacement-shipment ask to the approved return.",
            outcome_effect={"exchange_state": exchange.status.value},
        )
        return exchange

    def decide_exchange(
        self, exchange_id: str, *, approve: bool, trace_id: str
    ) -> object:
        exchange = (
            self.return_service.approve_exchange(exchange_id, self.merchant_scope)
            if approve
            else self.return_service.reject_exchange(exchange_id, self.merchant_scope)
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.HUMAN,
            action="exchange.approved" if approve else "exchange.rejected",
            inputs={"exchange_id": exchange_id},
            output={"status": exchange.status.value},
            reasoning_summary="Merchant decided the replacement-shipment ask.",
            outcome_effect={"exchange_state": exchange.status.value},
        )
        return exchange

    def fulfill_exchange(self, exchange_id: str, *, trace_id: str) -> object:
        exchange = self.return_service.fulfill_exchange(exchange_id, self.merchant_scope)
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="exchange.fulfilled",
            inputs={"exchange_id": exchange_id},
            output={"status": exchange.status.value},
            reasoning_summary="Replacement shipment fulfilled for the approved exchange.",
            outcome_effect={"exchange_state": exchange.status.value},
        )
        return exchange

    def request_refund(
        self, order_id: str, amount_paise: int, reason: str, *, trace_id: str, return_id: str | None = None
    ) -> object:
        from sellable.privacy import redact_pii

        reason = redact_pii(reason) or reason
        ask = self.return_service.request_refund(
            order_id, self.merchant_scope, amount_paise, reason, return_id=return_id
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="refund.requested",
            inputs={"order_id": order_id, "amount_paise": amount_paise},
            output={"refund_request_id": ask.refund_request_id, "status": ask.status.value},
            reasoning_summary="Opened a merchant-gated refund ask; provider execution needs approval.",
            outcome_effect={"refund_request_state": ask.status.value},
        )
        return ask

    def decide_refund(
        self, refund_request_id: str, *, approve: bool, decided_by: str, trace_id: str
    ) -> object:
        ask = self.return_service.decide_refund(
            refund_request_id, self.merchant_scope, approve=approve, decided_by=decided_by
        )
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.HUMAN,
            action="refund_request.approved" if approve else "refund_request.denied",
            inputs={"refund_request_id": refund_request_id},
            output={"status": ask.status.value},
            reasoning_summary="Merchant decided the refund ask.",
            outcome_effect={"refund_request_state": ask.status.value},
        )
        return ask

    # ------------------------------------------------------------------
    # Checkout → order integration: the new canonical money path is
    # cart → checkout (validated, priced, authorized) → order → consent →
    # payment → webhook → auto-completed checkout. The legacy direct
    # create_order path is unchanged.
    # ------------------------------------------------------------------

    @traced("order.create_from_checkout")
    def create_order_from_checkout(
        self,
        checkout_id: str,
        *,
        intent: IntentMandate,
        idempotency_key: str,
        delegation_id: str | None = None,
        trace_id: str,
    ) -> Order:
        from sellable.contracts import CheckoutStatus

        with self._order_lock:
            checkout = self.checkout_service.get_checkout(checkout_id, self.merchant_scope)
            # Replay first: the same key for the same grand total returns the
            # same order even after the checkout moved past AUTHORIZED.
            existing_order_id = self._idempotency_keys.get(idempotency_key)
            if existing_order_id is not None:
                existing = self._orders[existing_order_id]
                if existing.amount_paise != checkout.grand_total_paise:
                    raise IdempotencyReuseError(
                        "Idempotency key cannot be reused for a different transaction"
                    )
                if checkout.order_id is None:
                    try:
                        self.checkout_service.link_order(
                            checkout_id, self.merchant_scope, existing.order_id
                        )
                    except Exception:  # noqa: BLE001 — replay must stay safe
                        logger.warning("Checkout order re-link skipped on replay")
                return existing

            if checkout.status is not CheckoutStatus.AUTHORIZED:
                raise ValueError("orders require an AUTHORIZED checkout")
            if utc_now() >= checkout.expires_at:
                raise ValueError("checkout has expired")

            # Unified policy-on-grand: line-level rules run on the
            # negotiated merchandise state while amount rules bind the
            # authorized grand total (promotions/tax/shipping included).
            mandate = self._policy_mandate_for_checkout(checkout, intent)
            decision = self.evaluate_quote(
                cart=mandate,
                intent=intent,
                trace_id=trace_id,
                amount_override_paise=checkout.grand_total_paise,
            )
            if decision.verdict is PolicyVerdict.DENY:
                self._record_trust_outcome(
                    "policy_denial", delegation_id, reference=idempotency_key
                )
                raise ValueError(
                    f"Order creation is blocked by policy: {decision.reason_code or decision.verdict}"
                )

            authz_hold = False
            if delegation_id is not None:
                auth_decision = self.authorization_service.authorize(
                    delegation_id=delegation_id,
                    scope=OperationScope.CHECKOUT_WRITE,
                    merchant_id=self.merchant_scope,
                    amount_paise=checkout.grand_total_paise,
                    categories=self._line_categories(checkout.lines),
                )
                self._record(
                    trace_id=trace_id,
                    actor=LedgerActor.AUTHORIZATION_SERVICE,
                    action=(
                        "authorization.denied"
                        if auth_decision.outcome is AuthorizationOutcome.DENY
                        else "authorization.checked"
                    ),
                    inputs={"delegation_id": delegation_id},
                    output={
                        "outcome": auth_decision.outcome.value,
                        "reason_code": auth_decision.reason_code,
                    },
                    reasoning_summary="Resolved the customer delegation for the checkout order.",
                    policy_refs=auth_decision.matched_policies,
                )
                if auth_decision.outcome is AuthorizationOutcome.DENY:
                    self._record_trust_outcome(
                        "auth_failure", delegation_id, reference=idempotency_key
                    )
                    if auth_decision.reason_code == "DELEGATION_REVOKED":
                        self._flag_credential_abuse(
                            delegation_id,
                            trace_id=trace_id,
                            detail="revoked delegation presented at order creation",
                        )
                    raise ValueError(
                        "Order creation is blocked by authorization: "
                        f"{auth_decision.reason_code}"
                    )
                authz_hold = auth_decision.outcome in (
                    AuthorizationOutcome.REQUIRE_CUSTOMER,
                    AuthorizationOutcome.REQUIRE_HUMAN,
                )

            requires_approval = (
                decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL or authz_hold
            )
            order = Order(
                trace_id=trace_id,
                quote_id=checkout.quote_id or checkout.checkout_id,
                buyer_agent_id=intent.buyer_agent_id,
                merchant_id=self.policy.merchant_id,
                amount_paise=checkout.grand_total_paise,
                idempotency_key=idempotency_key,
                requires_approval=requires_approval,
            )
            self._orders[order.order_id] = order
            self._idempotency_keys[idempotency_key] = order.order_id
            try:
                self.order_repo.save(order)
            except IntegrityError:
                winner = self.order_repo.for_idempotency_key(
                    self.merchant_scope, idempotency_key
                )
                if winner is None:
                    raise
                if winner.amount_paise != checkout.grand_total_paise:
                    raise IdempotencyReuseError(
                        "Idempotency key cannot be reused for a different transaction"
                    ) from None
                self._orders[winner.order_id] = winner
                self._idempotency_keys[idempotency_key] = winner.order_id
                return winner
            pending = self.checkout_service.mark_payment_pending(checkout_id, self.merchant_scope)
            _ = pending
            self.checkout_service.link_order(checkout_id, self.merchant_scope, order.order_id)
            self._record(
                trace_id=trace_id,
                actor=LedgerActor.COMMERCE_CORE,
                action="order.created",
                inputs={
                    "checkout_id": checkout_id,
                    "quote_id": order.quote_id,
                    "idempotency_key": idempotency_key,
                    "delegation_id": delegation_id,
                },
                output={
                    "order_id": order.order_id,
                    "status": order.status,
                    "requires_approval": requires_approval,
                    "amount_paise": order.amount_paise,
                },
                reasoning_summary=(
                    "Created an order from the authorized checkout at the exact bound total."
                ),
                policy_refs=["POLICY.order_creation_requires_allow"],
                outcome_effect={"order_state": order.status},
            )
            self._publish_outbox(
                event_type="order.created",
                order=order,
                actor_type="commerce_core",
                actor_id=self.merchant_scope,
                data={"amount_paise": order.amount_paise, "checkout_id": checkout_id},
            )
            return order

    def _policy_mandate_for_checkout(
        self, checkout: Checkout, intent: IntentMandate
    ) -> CartMandate:
        """Policy-evaluation view of a checkout: list prices with the
        negotiated checkout units as offers. Totals need not match the
        checkout grand (promotions/tax/shipping live outside the legacy
        mandate); the grand total is capped explicitly at the call site."""
        items = []
        for line in checkout.lines:
            list_unit = self.catalog.get(line.sku).price_paise
            items.append(
                CartItem(
                    sku=line.sku,
                    quantity=line.quantity,
                    unit_price_paise=list_unit,
                    offered_price_paise=min(line.unit_price_paise, list_unit),
                )
            )
        subtotal = sum(i.quantity * i.unit_price_paise for i in items)
        offered = sum(i.line_total_paise for i in items)
        return CartMandate(
            intent_ref=intent.mandate_id,
            items=items,
            subtotal_paise=subtotal,
            discount_paise=subtotal - offered,
            total_paise=offered,
            negotiation_round=0,
        )

    def evaluate_quote(
        self,
        *,
        cart: CartMandate,
        intent: IntentMandate,
        trace_id: str,
        upsells_in_session: int = 0,
        amount_override_paise: int | None = None,
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
            amount_override_paise=amount_override_paise,
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
        delegation_id: str | None = None,
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

            # Delegation check (target §14): additive — orders without a
            # delegation behave exactly as before. A DENY blocks creation;
            # REQUIRE_* holds the order for approval like a policy HITL.
            authz_hold = False
            if delegation_id is not None:
                decision = self.authorization_service.authorize(
                    delegation_id=delegation_id,
                    scope=OperationScope.CHECKOUT_WRITE,
                    merchant_id=self.merchant_scope,
                    amount_paise=cart.total_paise,
                    categories=self._line_categories(cart.items),
                )
                self._record(
                    trace_id=trace_id,
                    actor=LedgerActor.AUTHORIZATION_SERVICE,
                    action=(
                        "authorization.denied"
                        if decision.outcome is AuthorizationOutcome.DENY
                        else "authorization.checked"
                    ),
                    inputs={
                        "delegation_id": delegation_id,
                        "scope": decision.scope_used.value,
                        "amount_paise": cart.total_paise,
                    },
                    output={
                        "outcome": decision.outcome.value,
                        "reason_code": decision.reason_code,
                    },
                    reasoning_summary=(
                        "Resolved the customer delegation before touching commerce state."
                    ),
                    policy_refs=decision.matched_policies,
                )
                if decision.outcome is AuthorizationOutcome.DENY:
                    self._record_trust_outcome(
                        "auth_failure", delegation_id, reference=idempotency_key
                    )
                    if decision.reason_code == "DELEGATION_REVOKED":
                        self._flag_credential_abuse(
                            delegation_id,
                            trace_id=trace_id,
                            detail="revoked delegation presented at order creation",
                        )
                    raise ValueError(
                        "Order creation is blocked by authorization: "
                        f"{decision.reason_code}"
                    )
                authz_hold = decision.outcome in (
                    AuthorizationOutcome.REQUIRE_CUSTOMER,
                    AuthorizationOutcome.REQUIRE_HUMAN,
                )

            decision = self.evaluate_quote(cart=cart, intent=intent, trace_id=trace_id)
            if decision.verdict is PolicyVerdict.DENY:
                self._record_trust_outcome(
                    "policy_denial", delegation_id, reference=idempotency_key
                )
                raise ValueError(
                    f"Order creation is blocked by policy: {decision.reason_code or decision.verdict}"
                )
            requires_approval = (
                decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL or authz_hold
            )
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
                inputs={
                    "quote_id": cart.mandate_id,
                    "idempotency_key": idempotency_key,
                    "delegation_id": delegation_id,
                },
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
            self._publish_outbox(
                event_type="order.created",
                order=order,
                actor_type="commerce_core",
                actor_id=self.merchant_scope,
                data={"amount_paise": order.amount_paise, "status": order.status.value},
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
        # start_payment calls for the same order *in this process only*.
        # Cross-worker atomicity is NOT provided here: a second worker would
        # pass its own in-memory check against the same ISSUED consent. That
        # is why startup refuses multi-worker config (see
        # _assert_single_worker in main.py) until consumption becomes an
        # atomic DB transition (UPDATE ... WHERE status=ISSUED RETURNING).
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
        probe = self.get_order(order_id)
        with Span("payment.reconcile", trace_id=probe.trace_id, order_id=order_id):
            return self._mark_paid_inner(order_id, provider_ref=provider_ref)

    def _mark_paid_inner(self, order_id: str, *, provider_ref: str) -> Order:
        before = self.get_order(order_id).status
        updated = self._transition_order(
            order_id,
            OrderStatus.PAID,
            action="order.paid",
            explanation="A signature-verified provider event confirmed that payment was captured.",
            provider_ref=provider_ref,
        )
        if before is not OrderStatus.PAID:
            self._publish_outbox(
                event_type="order.paid",
                order=updated,
                actor_type="commerce_core",
                actor_id=self.merchant_scope,
                data={"provider_ref": provider_ref},
            )
            self._auto_complete_linked_checkout(updated)
        return updated

    def _auto_complete_linked_checkout(self, order: Order) -> None:
        """Complete the checkout bound to a just-paid order (new canonical
        path). Best-effort: legacy orders have no linked checkout, and a
        completion failure must never unsettle payment."""
        from sellable.contracts import CheckoutStatus as _CheckoutStatus

        try:
            checkout = self.checkout_repo.for_order(order.order_id, self.merchant_scope)
        except Exception as exc:  # noqa: BLE001 — checkout is additive
            logger.warning("Checkout lookup failed for order %s: %s", order.order_id, exc)
            return
        if checkout is None or checkout.status is not _CheckoutStatus.PAYMENT_PENDING:
            return
        try:
            completed = self.checkout_service.complete(
                checkout.checkout_id, self.merchant_scope, order.order_id
            )
        except Exception as exc:  # noqa: BLE001 — payment already settled
            logger.warning(
                "Linked checkout completion failed for order %s: %s", order.order_id, exc
            )
            return
        self._emit_checkout_completed(completed, order.order_id, trace_id=order.trace_id)
        self._record_trust_outcome(
            "success",
            completed.delegation_id,
            amount_paise=order.amount_paise,
            reference=order.order_id,
        )

    def _emit_checkout_completed(self, completed: Checkout, order_id: str, *, trace_id: str) -> None:
        self._record(
            trace_id=trace_id,
            actor=LedgerActor.COMMERCE_CORE,
            action="checkout.completed",
            inputs={"checkout_id": completed.checkout_id, "order_id": order_id},
            output={
                "status": completed.status.value,
                "grand_total_paise": completed.grand_total_paise,
            },
            reasoning_summary="Checkout completed against the authorized total; promotion redemptions recorded.",
            outcome_effect={"checkout_state": completed.status.value},
        )
        try:
            self.outbox_repo.publish(
                new_event(
                    event_type="checkout.completed",
                    tenant_id=completed.merchant_id,
                    merchant_id=completed.merchant_id,
                    aggregate_type="checkout",
                    aggregate_id=completed.checkout_id,
                    trace_id=trace_id,
                    actor_type="commerce_core",
                    actor_id=self.merchant_scope,
                    data={
                        "order_id": order_id,
                        "grand_total_paise": completed.grand_total_paise,
                        "delegation_id": completed.delegation_id,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 — outbox is additive
            logger.warning("Outbox publish failed for checkout.completed: %s", exc)

    def mark_payment_failed(self, order_id: str, *, reason: str, provider_ref: str | None = None) -> Order:
        failed = self._transition_order(
            order_id,
            OrderStatus.PAYMENT_FAILED,
            action="payment.failed",
            explanation=f"The payment attempt failed: {reason}",
            provider_ref=provider_ref,
        )
        try:
            checkout = self.checkout_repo.for_order(order_id, self.merchant_scope)
            if checkout is not None and checkout.delegation_id is not None:
                self._record_trust_outcome(
                    "order_failure", checkout.delegation_id, reference=order_id
                )
        except Exception as exc:  # noqa: BLE001 — trust is additive
            logger.warning("Trust recording failed for payment failure: %s", exc)
        return failed

    def payment_receipt(self, order_id: str):
        """Build the normalized receipt for a settled order (§25.3),
        binding provider state to authorization, risk, and trace evidence."""
        from sellable.contracts import OrderStatus as _OrderStatus
        from sellable.contracts import PaymentReceipt

        order = self.get_order(order_id)
        if order.status not in (_OrderStatus.PAID, _OrderStatus.FULFILLED, _OrderStatus.REFUNDED):
            raise ValueError("receipts exist only for settled orders")
        consent_id = None
        provider_reference = order.provider_order_id or order.provider_link_id
        paid_at = None
        for event in self.ledger.for_trace(order.trace_id):
            outputs = event.output_json or {}
            if event.action == "consent.issued" and consent_id is None:
                consent_id = outputs.get("consent_id")
            if event.action == "order.paid":
                provider_reference = (
                    event.provider_ref or provider_reference
                )
                paid_at = event.timestamp
        authorization_reference = consent_id
        risk_reference = None
        try:
            checkout = self.checkout_repo.for_order(order_id, self.merchant_scope)
        except Exception:  # noqa: BLE001 — linkage is best-effort
            checkout = None
        if checkout is not None:
            authorization_reference = (
                checkout.authorization_id or consent_id
            )
            risk_reference = checkout.risk_reference
        provider = "razorpay"
        if provider_reference and provider_reference.startswith("pi_"):
            provider = "stripe"
        elif provider_reference and provider_reference.startswith("sim_"):
            provider = "simulated"
        return PaymentReceipt(
            order_id=order.order_id,
            provider=provider,
            provider_reference=provider_reference,
            amount_paise=order.amount_paise,
            currency=self.policy.currency,
            timestamp=paid_at or order.created_at,
            authorization_reference=authorization_reference,
            risk_reference=risk_reference,
            trace_id=order.trace_id,
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
        before = self.get_order(order_id).status
        updated = self._transition_order(
            order_id,
            OrderStatus.REFUNDED,
            action="refund.settled",
            explanation="A provider-confirmed full refund settled the order.",
            provider_ref=provider_ref,
        )
        if before is not OrderStatus.REFUNDED:
            self._publish_outbox(
                event_type="refund.completed",
                order=updated,
                actor_type="commerce_core",
                actor_id=self.merchant_scope,
                data={"provider_ref": provider_ref, "amount_paise": updated.amount_paise},
            )
        return updated

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

    def _publish_outbox(
        self,
        *,
        event_type: str,
        order: Order,
        actor_type: str,
        actor_id: str,
        data: dict[str, object] | None = None,
    ) -> None:
        """Best-effort bus publish (target §27). A queue failure must never
        break commerce: the ledger row is already durable, and
        shared-transaction atomicity arrives with the Phase 6 bus."""
        self._publish_bus_event(
            event_type=event_type,
            tenant_id=order.merchant_id,
            merchant_id=order.merchant_id,
            aggregate_type="order",
            aggregate_id=order.order_id,
            trace_id=order.trace_id,
            actor_type=actor_type,
            actor_id=actor_id,
            data=data,
        )

    def _publish_bus_event(
        self,
        *,
        event_type: str,
        tenant_id: str,
        merchant_id: str,
        aggregate_type: str,
        aggregate_id: str,
        trace_id: str,
        actor_type: str,
        actor_id: str,
        data: dict[str, object] | None = None,
    ) -> None:
        try:
            self.outbox_repo.publish(
                new_event(
                    event_type=event_type,
                    tenant_id=tenant_id,
                    merchant_id=merchant_id,
                    aggregate_type=aggregate_type,
                    aggregate_id=aggregate_id,
                    trace_id=trace_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    data=dict(data or {}),
                )
            )
        except Exception as exc:  # noqa: BLE001 — outbox is additive
            logger.warning("Outbox publish failed for %s: %s", event_type, exc)

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

    def all_orders(self, *, limit: int = 500, offset: int = 0) -> list[Order]:
        # DB-first so externally-advanced state (webhook settlement by another
        # process/replica) is always reflected.
        return list(
            self.order_repo.all(
                merchant_id=self.merchant_scope, limit=limit, offset=offset
            )
        )

    def get_orders_many(self, order_ids: list[str]) -> dict[str, Order]:
        """Merchant-scoped batch order fetch in ONE query (mission list path).

        Foreign orders are excluded, like repeated get_order calls — and the
        core cache is refreshed so later reads in this request see them.
        """
        orders = self.order_repo.get_many(order_ids, merchant_id=self.merchant_scope)
        self._orders.update(orders)
        return orders

    def get_policy(self) -> MerchantPolicy:
        return self.policy

    def update_policy(self, **kwargs: object) -> None:
        merged = {**self.policy.model_dump(), **kwargs}
        self.policy = MerchantPolicy.model_validate(merged)
