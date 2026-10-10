"""Deterministic customer-service tools (§7.3 tool groups).

Authority discipline: the agent can read order/shipping state, open and
update support cases, and REQUEST returns/exchanges/refunds through the
merchant-gated services. It can never execute refunds, mutate account
security, reveal another customer's data, or override merchant policy —
those paths do not exist in this surface. Order PII tools require an
AUTHENTICATED customer (active delegation as principal); claimed-only
customers get public information plus an identity-linking path. Full
customer-order linkage arrives with Phase 5 identity linking.
"""

from __future__ import annotations

from enum import StrEnum

from sellable.contracts import (
    CartLine,
    ExchangeRequest,
    LedgerActor,
    LedgerEvent,
    Order,
    RefundRequest,
    ReturnRequest,
    SupportCase,
    SupportCategory,
)
from sellable.core import CommerceCore


class CustomerAuthTier(StrEnum):
    AUTHENTICATED = "AUTHENTICATED"
    CLAIMED = "CLAIMED"


class AuthResult:
    """Authentication outcome for a customer context (§7.3)."""

    def __init__(self, customer_id: str | None, tier: CustomerAuthTier, method: str) -> None:
        self.customer_id = customer_id
        self.tier = tier
        self.method = method


class CustomerServiceTools:
    """Narrow tool surface for the support orchestration layer."""

    #: Tool registry version stamped on telemetry (§8.3).
    TOOL_REGISTRY_VERSION = "cs-tools-v1"

    def __init__(self, commerce: CommerceCore, recorder=None) -> None:
        self.commerce = commerce
        self.recorder = recorder

    def _note_tool(self, name: str, **kwargs) -> None:
        if self.recorder is not None:
            self.recorder.tool(name, version=self.TOOL_REGISTRY_VERSION, **kwargs)

    # ------------------------------------------------------------------
    # Identity (§7.3: authenticate customer context)
    # ------------------------------------------------------------------

    def customer_authenticate(
        self, *, customer_id: str | None, trace_id: str
    ) -> AuthResult:
        """Authenticate the customer context. AUTHENTICATED requires an
        active delegation where the customer is principal, or a LINKED
        identity; otherwise the identity is CLAIMED (public info only)."""
        tier = CustomerAuthTier.CLAIMED
        method = "claimed"
        if customer_id:
            history = self.commerce.delegation_repo.history_for_principal(
                self.commerce.merchant_scope, customer_id
            )
            active = [g for g in history if g.status.value == "ACTIVE"]
            if active:
                tier = CustomerAuthTier.AUTHENTICATED
                method = "active_delegation"
            elif self._identity_linked(customer_id):
                tier = CustomerAuthTier.AUTHENTICATED
                method = "identity_link"
        self._note_tool("customer.authenticate_context")
        self._record(
            trace_id=trace_id,
            action="customer.authenticated",
            inputs={"customer_id": customer_id},
            output={"tier": tier.value, "method": method},
            explanation="Authenticated the customer context against delegation history.",
        )
        return AuthResult(customer_id, tier, method)

    def _require_authenticated(self, auth: AuthResult, tool: str) -> None:
        if auth.tier is not CustomerAuthTier.AUTHENTICATED:
            raise PermissionError(
                f"{tool} requires an authenticated customer; link identity first."
            )

    def _identity_linked(self, customer_id: str) -> bool:
        identity_repo = getattr(self.commerce, "identity_repo", None)
        if identity_repo is None:
            return False
        try:
            return bool(
                identity_repo.linked_for_customer(
                    self.commerce.merchant_scope, customer_id
                )
            )
        except Exception:  # noqa: BLE001 — linking is additive
            return False

    # ------------------------------------------------------------------
    # Orders and shipping
    # ------------------------------------------------------------------

    def order_get(
        self, *, order_id: str, auth: AuthResult, trace_id: str
    ) -> Order | None:
        self._require_authenticated(auth, "order.get")
        try:
            order = self.commerce.get_order(order_id)
        except ValueError:
            order = None
        self._note_tool("order.get")
        self._record(
            trace_id=trace_id,
            action="support.order_fetched",
            inputs={"order_id": order_id, "customer_id": auth.customer_id},
            output={"status": order.status.value if order else None},
            explanation="Retrieved the order for an authenticated customer.",
        )
        return order

    def order_timeline(
        self, *, order_id: str, auth: AuthResult, trace_id: str
    ) -> list[dict[str, object]]:
        """Replayable order history from the ledger (§28.3 support slice)."""
        order = self.order_get(order_id=order_id, auth=auth, trace_id=trace_id)
        if order is None:
            return []
        entries = []
        for event in self.commerce.ledger.for_trace(
            order.trace_id, merchant_id=self.commerce.merchant_scope
        ):
            entries.append(
                {
                    "action": event.action,
                    "actor": event.actor,
                    "summary": event.reasoning_summary,
                    "outcome": event.outcome_effect_json,
                }
            )
        self._note_tool("order.timeline")
        return entries

    def shipping_track(
        self, *, order_id: str, auth: AuthResult, trace_id: str
    ) -> dict[str, object]:
        """Basic shipping information (§7.3): fulfillment + tracking
        timeline, or the order state when nothing has shipped."""
        order = self.order_get(order_id=order_id, auth=auth, trace_id=trace_id)
        if order is None:
            return {"order_id": order_id, "status": "UNKNOWN_ORDER"}
        fulfillment = self.commerce.fulfillment_service.for_order(
            order.order_id, self.commerce.merchant_scope
        )
        if fulfillment is None:
            result: dict[str, object] = {
                "order_id": order_id,
                "status": "NO_FULFILLMENT",
                "order_status": order.status.value,
            }
        else:
            timeline = self.commerce.fulfillment_service.timeline(
                fulfillment.fulfillment_id, self.commerce.merchant_scope
            )
            result = {
                "order_id": order_id,
                "status": fulfillment.status.value,
                "tracking_reference": fulfillment.tracking_reference,
                "carrier": fulfillment.carrier,
                "method": fulfillment.method.value,
                "timeline": [
                    {"status": e.status.value, "location": e.location} for e in timeline
                ],
            }
        self._note_tool("shipping.track")
        self._record(
            trace_id=trace_id,
            action="support.shipping_tracked",
            inputs={"order_id": order_id},
            output={"status": result["status"]},
            explanation="Provided basic shipping information for the order.",
        )
        return result

    # ------------------------------------------------------------------
    # Returns, exchanges, refund asks (merchant-gated services)
    # ------------------------------------------------------------------

    def return_create(
        self,
        *,
        order_id: str,
        items: list[dict[str, object]],
        reason: str,
        auth: AuthResult,
        trace_id: str,
    ) -> ReturnRequest:
        self._require_authenticated(auth, "return.create")
        lines = [
            CartLine(
                sku=str(item["sku"]),
                quantity=int(item["quantity"]),
                unit_price_paise=self.commerce.catalog.get(str(item["sku"])).price_paise,
            )
            for item in items
        ]
        case = self.commerce.return_service.request_return(
            order_id,
            self.commerce.merchant_scope,
            items=lines,
            reason=reason,
            customer_id=auth.customer_id,
        )
        self._note_tool("return.create")
        self._record(
            trace_id=trace_id,
            action="support.return_requested",
            inputs={"order_id": order_id, "customer_id": auth.customer_id},
            output={"return_id": case.return_id},
            explanation="Initiated an eligible return request for the customer.",
        )
        return case

    def exchange_create(
        self,
        *,
        return_id: str,
        replacement_sku: str,
        replacement_quantity: int,
        auth: AuthResult,
        trace_id: str,
    ) -> ExchangeRequest:
        self._require_authenticated(auth, "exchange.create")
        exchange = self.commerce.return_service.request_exchange(
            return_id,
            self.commerce.merchant_scope,
            replacement_sku,
            replacement_quantity,
        )
        self._note_tool("exchange.create")
        self._record(
            trace_id=trace_id,
            action="support.exchange_requested",
            inputs={"return_id": return_id},
            output={"exchange_id": exchange.exchange_id},
            explanation="Initiated an eligible exchange request for the customer.",
        )
        return exchange

    def refund_request(
        self, *, order_id: str, amount_paise: int, reason: str,
        auth: AuthResult, trace_id: str, max_direct_refund_paise: int,
    ):
        """Request a refund within CS authority. Above the cap the caller
        must escalate instead — the tool refuses, never over-authorizes."""
        self._require_authenticated(auth, "refund.request")
        if amount_paise > max_direct_refund_paise:
            raise PermissionError(
                f"refund amount exceeds customer-service authority "
                f"({max_direct_refund_paise} paise); escalate to a human."
            )
        ask = self.commerce.return_service.request_refund(
            order_id, self.commerce.merchant_scope, amount_paise, reason
        )
        self._note_tool("refund.request")
        self._record(
            trace_id=trace_id,
            action="support.refund_requested",
            inputs={"order_id": order_id, "amount_paise": amount_paise},
            output={"refund_request_id": ask.refund_request_id},
            explanation="Requested a refund within customer-service authority.",
        )
        return ask

    def customer_get_profile(
        self, *, auth: AuthResult, trace_id: str
    ) -> dict[str, object]:
        """Scoped customer profile (§7.3): identity tier, linked agents,
        and delegation scopes — never credentials, payment instruments,
        or other customers' data."""
        self._require_authenticated(auth, "customer.profile")
        delegations = self.commerce.delegation_repo.history_for_principal(
            self.commerce.merchant_scope, auth.customer_id or ""
        )
        scopes = sorted(
            {
                scope.value
                for grant in delegations
                for scope in grant.operation_scopes
            }
        )
        profile = {
            "customer_id": auth.customer_id,
            "tier": auth.tier.value,
            "auth_method": auth.method,
            "linked_agents": sorted(
                {grant.subject_agent_id for grant in delegations}
            ),
            "delegation_scopes": scopes,
        }
        self._note_tool("customer.profile")
        self._record(
            trace_id=trace_id,
            action="support.customer_profile",
            inputs={"customer_id": auth.customer_id},
            output={"tier": auth.tier.value, "scopes": scopes},
            explanation="Loaded the scoped customer profile.",
        )
        return profile

    def customer_get_permissions(
        self, *, auth: AuthResult, trace_id: str
    ) -> dict[str, object]:
        """What this customer may do through agents (§7.3): the union of
        active delegation scopes. Informational — enforcement stays in
        the authorization service."""
        self._require_authenticated(auth, "customer.permissions")
        active = [
            grant
            for grant in self.commerce.delegation_repo.history_for_principal(
                self.commerce.merchant_scope, auth.customer_id or ""
            )
            if grant.status.value == "ACTIVE"
        ]
        permissions = {
            "scopes": sorted(
                {scope.value for grant in active for scope in grant.operation_scopes}
            ),
            "active_delegations": len(active),
        }
        self._note_tool("customer.permissions")
        return permissions

    def return_get(
        self, *, return_id: str, auth: AuthResult, trace_id: str
    ):
        """Read one return case (§7.3 return.get)."""
        self._require_authenticated(auth, "return.get")
        case = self.commerce.return_service.get_return(
            return_id, self.commerce.merchant_scope
        )
        self._note_tool("return.get")
        return case

    def refund_get(
        self, *, refund_request_id: str, auth: AuthResult, trace_id: str
    ) -> RefundRequest:
        """Read one refund ask (§7.3 refund.get). Provider execution state
        comes from the refund rail, never from this read."""
        self._require_authenticated(auth, "refund.get")
        ask = self.commerce.return_service.get_refund_request(
            refund_request_id, self.commerce.merchant_scope
        )
        self._note_tool("refund.get")
        return ask

    def shipping_estimate(
        self, *, pincode: str, auth: AuthResult, trace_id: str
    ) -> dict[str, object]:
        """Cheapest serviceable option with ETA (§7.3 shipping.estimate)."""
        options = self.commerce.shipping_service.quote(
            self.commerce.merchant_scope, pincode
        )
        serviceable = [o for o in options if o.serviceable]
        self._note_tool("shipping.estimate")
        self._record(
            trace_id=trace_id,
            action="support.shipping_estimated",
            inputs={"pincode": pincode},
            output={"options": len(serviceable)},
            explanation="Estimated shipping from deterministic options.",
        )
        if not serviceable:
            return {"pincode": pincode, "serviceable": False}
        cheapest = min(serviceable, key=lambda o: o.price_paise)
        return {
            "pincode": pincode,
            "serviceable": True,
            "method": cheapest.method.value,
            "price_paise": cheapest.price_paise,
            "eta_min_days": cheapest.eta_min_days,
            "eta_max_days": cheapest.eta_max_days,
        }

    def case_update(
        self, *, case_id: str, trace_id: str, begin_work: bool = False,
        resolve: bool = False, wait_for_customer: bool = False,
    ):
        """Advance a case along its lifecycle (§7.3 support.case.update).
        Exactly one transition per call."""
        transitions = [begin_work, resolve, wait_for_customer]
        if sum(1 for t in transitions if t) != 1:
            raise ValueError("case_update takes exactly one transition")
        service = self.commerce.case_service
        merchant = self.commerce.merchant_scope
        if begin_work:
            updated = service.begin_work(case_id, merchant)
        elif resolve:
            updated = service.resolve(case_id, merchant)
        else:
            updated = service.wait_for_customer(case_id, merchant)
        self._note_tool("support.case.update")
        self._record(
            trace_id=trace_id,
            action="support.case_updated",
            inputs={"case_id": case_id},
            output={"status": updated.status.value},
            explanation="Advanced the support case lifecycle.",
        )
        return updated

    # ------------------------------------------------------------------
    # Policy and cases
    # ------------------------------------------------------------------

    def policy_lookup(self, *, topic: str, trace_id: str) -> dict[str, object]:
        """Answer product/policy questions from merchant configuration."""
        policy = self.commerce.policy
        self._note_tool("policy.lookup")
        catalog = {
            "max_order_value_paise": policy.max_order_value_paise,
            "max_discount_percent": policy.max_discount_percent,
            "allowed_categories": list(policy.allowed_categories),
            "max_negotiation_rounds": policy.max_negotiation_rounds,
            "human_approval_threshold_paise": policy.human_approval_threshold_paise,
        }
        self._record(
            trace_id=trace_id,
            action="support.policy_explained",
            inputs={"topic": topic},
            output={"topic": topic},
            explanation="Answered a policy question from merchant configuration.",
        )
        return catalog

    def case_create(
        self,
        *,
        summary: str,
        trace_id: str,
        customer_id: str | None = None,
        order_id: str | None = None,
        category=None,
    ) -> SupportCase:
        from sellable.contracts import SupportCategory as _Category
        from sellable.privacy import redact_pii

        case = self.commerce.case_service.open_case(
            self.commerce.merchant_scope,
            redact_pii(summary) or summary,
            customer_id=customer_id,
            order_id=order_id,
            category=category or _Category.OTHER,
            context={"opened_via": "customer_service_agent"},
        )
        self._note_tool("support.case.create")
        self._record(
            trace_id=trace_id,
            action="support.case_created",
            inputs={"order_id": order_id},
            output={"case_id": case.case_id},
            explanation="Opened a support case.",
        )
        return case

    def case_escalate(
        self,
        *,
        case_id: str,
        trace_id: str,
        customer_summary: str,
        issue_classification: str,
        recommended_next_action: str,
        order_id: str | None = None,
        risk_flags: list[str] | None = None,
    ) -> SupportCase:
        """Escalate with the full §26.3 handoff payload."""
        from sellable.support import build_escalation_payload

        payload = build_escalation_payload(
            customer_summary=customer_summary,
            issue_classification=issue_classification,
            order_context={"order_id": order_id} if order_id else {},
            actions_attempted=["customer_service_agent_triage"],
            recommended_next_action=recommended_next_action,
            risk_flags=risk_flags,
            trace_id=trace_id,
        )
        escalated = self.commerce.case_service.escalate(
            case_id, self.commerce.merchant_scope, payload
        )
        self._note_tool("support.case.escalate")
        self._record(
            trace_id=trace_id,
            action="support.case_escalated",
            inputs={"case_id": case_id},
            output={"status": escalated.status.value},
            explanation="Escalated the case to human support with full context.",
        )
        return escalated

    # ------------------------------------------------------------------

    def _record(
        self,
        *,
        trace_id: str,
        action: str,
        inputs: dict[str, object],
        output: dict[str, object],
        explanation: str,
    ) -> None:
        self.commerce.ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                merchant_id=self.commerce.merchant_scope,
                actor=LedgerActor.CUSTOMER_SERVICE_AGENT,
                action=action,
                inputs=inputs,
                output=output,
                reasoning_summary=explanation,
            )
        )
