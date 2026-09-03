"""Reference Buyer Agent proving the agent-to-agent discovery and quote loop."""

from __future__ import annotations

from enum import StrEnum
from typing import NotRequired, TypedDict
from uuid import uuid4

from pydantic import Field

import logging

from agents.buyer.graph import build_buyer_graph
from agents.buyer.policies import BuyerPolicy, BuyerPolicyVerdict
from agents.buyer.tools import BuyerTools
from agents.llm.adapters.base import LLMAdapter, reply_skus_known
from agents.seller.agent import SellerAction, SellerDecision, SellerRequest
from sellable.catalog import UnknownSkuError
from sellable.contracts import (
    BuyerMission,
    Consent,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    Order,
    PolicyVerdict,
    StrictModel,
)
from sellable.gateway import AgentGateway


logger = logging.getLogger("sellable.agents.buyer")


class BuyerAction(StrEnum):
    READY_FOR_CONSENT = "READY_FOR_CONSENT"
    NEEDS_HUMAN_APPROVAL = "NEEDS_HUMAN_APPROVAL"
    DENIED = "DENIED"
    NO_MATCH = "NO_MATCH"


class BuyerResult(StrictModel):
    trace_id: str
    action: BuyerAction
    buyer_summary: str = Field(min_length=1, max_length=1_000)
    merchant_manifest: dict[str, object]
    seller_decision: SellerDecision | None = None
    order_id: str | None = None
    consent_id: str | None = None
    steps: list[str] = Field(default_factory=list)


class BuyerGraphState(TypedDict):
    mission: BuyerMission
    trace_id: str
    manifest: NotRequired[dict[str, object]]
    catalog_skus: NotRequired[list[str]]
    intent: NotRequired[IntentMandate]
    seller_decision: NotRequired[SellerDecision]
    result: NotRequired[BuyerResult]
    order_id: NotRequired[str]
    consent_id: NotRequired[str]
    steps: NotRequired[list[str]]


class BuyerAgent:
    def __init__(self, gateway: AgentGateway, llm: "LLMAdapter | None" = None) -> None:
        self.gateway = gateway
        self.llm = llm
        self.tools = BuyerTools(gateway)
        self.policy = BuyerPolicy()
        self._graph = self._build_graph()

    def run(self, mission: BuyerMission, *, trace_id: str | None = None) -> BuyerResult:
        state = self._graph.invoke(
            {"mission": mission, "trace_id": trace_id or f"trc_{uuid4().hex}", "steps": []}
        )
        return state["result"]

    def _build_graph(self):
        return build_buyer_graph(self, BuyerGraphState)

    def _route_after_evaluate(self, state: BuyerGraphState) -> str:
        result = state.get("result")
        if result is not None and result.action is BuyerAction.READY_FOR_CONSENT:
            return "order"
        return "end"

    def _discover(self, state: BuyerGraphState) -> dict[str, object]:
        manifest = self.tools.discover_merchant(trace_id=state["trace_id"])
        return {"manifest": manifest, "steps": [*state["steps"], "DISCOVER"]}

    def _research(self, state: BuyerGraphState) -> dict[str, object]:
        mission = state["mission"]
        skus = self.tools.research_catalog(
            message=mission.message,
            allowed_categories=mission.allowed_categories,
            trace_id=state["trace_id"],
        )
        return {"catalog_skus": skus, "steps": [*state["steps"], "RESEARCH"]}

    def _request_quote(self, state: BuyerGraphState) -> dict[str, object]:
        mission = state["mission"]
        intent = IntentMandate(
            buyer_agent_id=mission.buyer_agent_id,
            budget_ceiling_paise=mission.budget_ceiling_paise,
            allowed_categories=mission.allowed_categories,
            purpose=mission.purpose,
            expires_at=mission.expires_at,
        )
        decision = self.tools.request_quote(
            message=mission.message,
            intent=intent,
            request_upsell=mission.request_upsell,
            trace_id=state["trace_id"],
            requested_sku=mission.requested_sku,
            quantity=mission.quantity,
            buyer_offer_paise=mission.buyer_offer_paise,
        )
        return {
            "seller_decision": decision,
            "intent": intent,
            "steps": [*state["steps"], "REQUEST_QUOTE"],
        }

    def _independent_check(
        self, cart, mission: BuyerMission, intent: IntentMandate
    ) -> BuyerPolicyVerdict:
        """Run the buyer's own guards: expiry + budget + category grounding.

        Budget and categories come from the buyer's MISSION (its own
        authorization), deliberately not from the intent sent to the merchant —
        the two can diverge for direct tool callers, and the buyer must guard
        its own ceiling first. The merchant policy engine backstops all of
        these at order creation. Every cart SKU must also resolve in the
        catalog, so a hallucinated SKU can never get a READY verdict here.
        """
        expiry = self.policy.check_mandate_expiry(intent=intent)
        if not expiry.allowed:
            return expiry
        budget = self.policy.check_budget(
            cart_total_paise=cart.total_paise,
            budget_ceiling_paise=mission.budget_ceiling_paise,
        )
        if not budget.allowed:
            return budget
        categories_by_sku: dict[str, str] = {}
        for item in cart.items:
            try:
                categories_by_sku[item.sku] = self.gateway.get_catalog_item(item.sku).category
            except UnknownSkuError:
                return BuyerPolicyVerdict(
                    allowed=False,
                    reason_code="UNKNOWN_SKU",
                    explanation=f"{item.sku} does not exist in the merchant catalog.",
                )
        return self.policy.check_categories(
            categories_by_sku=categories_by_sku,
            allowed_categories=mission.allowed_categories,
        )

    def _evaluate(self, state: BuyerGraphState) -> dict[str, object]:
        decision = state["seller_decision"]
        if decision.action is SellerAction.NO_MATCH:
            action = BuyerAction.NO_MATCH
            summary = "No merchant catalog item matches the buyer mission."
        elif decision.cart is None or decision.policy_decision is None:
            action = BuyerAction.DENIED
            summary = "The seller returned no candidate cart to evaluate."
        else:
            buyer_verdict: BuyerPolicyVerdict = self._independent_check(
                decision.cart, state["mission"], state["intent"]
            )
            if not buyer_verdict.allowed:
                # Budget (and expiry/category) is evaluated BEFORE the
                # merchant approval state so an over-budget cart reports
                # OVER_BUDGET instead of misleadingly queuing for approval.
                action = BuyerAction.DENIED
                summary = (
                    f"DENIED ({buyer_verdict.reason_code}): {buyer_verdict.explanation}"
                )
            elif decision.action is SellerAction.NEEDS_HUMAN_APPROVAL:
                action = BuyerAction.NEEDS_HUMAN_APPROVAL
                summary = "The cart is within buyer budget but requires merchant approval before consent."
            elif decision.policy_decision.verdict is PolicyVerdict.ALLOW:
                action = BuyerAction.READY_FOR_CONSENT
                summary = "A catalog-grounded, policy-valid cart is ready for explicit transaction consent."
            else:
                action = BuyerAction.DENIED
                summary = (
                    "The merchant policy did not permit a candidate cart: "
                    f"{decision.policy_decision.reason_code or decision.policy_decision.verdict}"
                )
        self._record(
            state["trace_id"],
            "buyer.mission_evaluated",
            {"result": action, "candidate_total_paise": decision.cart.total_paise if decision.cart else None},
            summary,
        )
        summary = self._phrase_summary(
            summary, decision, state["mission"].message, state["trace_id"]
        )
        return {
            "result": BuyerResult(
                trace_id=state["trace_id"],
                action=action,
                buyer_summary=summary,
                merchant_manifest=state["manifest"],
                seller_decision=decision,
                steps=[*state["steps"], "EVALUATE"],
            ),
            "steps": [*state["steps"], "EVALUATE"],
        }

    def _phrase_summary(
        self,
        deterministic_summary: str,
        decision: SellerDecision,
        mission: str,
        trace_id: str,
    ) -> str:
        """Rephrase the buyer-facing summary with the LLM when available.

        The model only rephrases the deterministic evaluation outcome from the
        grounded seller decision; it cannot alter the action, cart, or budget
        verdict. The reply is validated against the known cart SKUs — a reply
        naming an unknown SKU is rejected — and every outcome (llm phrasing
        vs deterministic fallback) is ledgered so replay shows the provenance.
        On any failure the deterministic summary is kept.
        """
        if self.llm is None or decision.cart is None:
            return deterministic_summary
        known_skus = {item.sku for item in decision.cart.items}
        payload = (
            f"Buyer mission: {mission}\n"
            f"Evaluation result: {deterministic_summary}\n"
            f"Seller action: {decision.action}\n"
            f"Cart total: {decision.cart.total_paise} paise\n"
            f"Items: {', '.join(f'{i.sku} x{i.quantity}' for i in decision.cart.items)}\n"
            f"Policy verdict: {decision.policy_decision.verdict if decision.policy_decision else 'n/a'}"
        )
        try:
            reply = self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are an AI purchasing agent summarizing a completed evaluation for "
                            "your human buyer. Use ONLY the facts in the payload. Never invent SKUs, "
                            "prices, or outcomes. Reply in 1-2 concise sentences."
                        ),
                    },
                    {"role": "user", "content": payload},
                ]
            ).strip()
            if reply and len(reply) <= 1_000 and reply_skus_known(reply, known_skus):
                self._record(
                    trace_id,
                    "buyer.response_phrased",
                    {"llm_used": True, "model": getattr(self.llm, "model", "unknown")},
                    "Rephrased the buyer summary with the LLM; SKUs validated against the cart.",
                )
                return reply
            if reply:
                logger.warning(
                    "buyer summary rephrase rejected (length or unknown SKU); using deterministic text"
                )
        except Exception as error:
            logger.warning("buyer summary rephrase failed; using deterministic text: %s", error)
        self._record(
            trace_id,
            "buyer.response_phrased",
            {"llm_used": False},
            "Kept the deterministic buyer summary.",
        )
        return deterministic_summary

    def _create_order(self, state: BuyerGraphState) -> dict[str, object]:
        decision = state["seller_decision"]
        intent = state["intent"]
        order: Order = self.tools.create_order(
            decision=decision, intent=intent, trace_id=state["trace_id"]
        )
        steps = [*state["steps"], "ORDER"]
        result = state["result"].model_copy(update={"order_id": order.order_id, "steps": steps})
        return {
            "result": result,
            "order_id": order.order_id,
            "steps": steps,
        }

    def _request_consent(self, state: BuyerGraphState) -> dict[str, object]:
        consent: Consent = self.tools.request_consent(
            order_id=state["order_id"], trace_id=state["trace_id"]
        )
        steps = [*state["steps"], "CONSENT"]
        result = state["result"].model_copy(update={"consent_id": consent.consent_id, "steps": steps})
        return {
            "result": result,
            "consent_id": consent.consent_id,
            "steps": steps,
        }

    def verify_payment(self, order_id: str, *, trace_id: str | None = None) -> dict[str, object]:
        """Read the authoritative order state for a buyer order.

        The buyer flow ends at consent — payment itself happens outside
        ``run()`` (human checkout or provider settlement). This method lets
        the buyer (or an operator) verify the outcome later against the same
        trace without ever touching the payment rail: read-only, no provider
        calls, no state changes.
        """
        order = self.gateway.commerce.get_order(order_id)
        resolved_trace = trace_id or order.trace_id
        self._record(
            resolved_trace,
            "buyer.payment_verified",
            {"order_id": order.order_id, "status": order.status},
            f"Verified the authoritative order state: {order.status}.",
        )
        return {
            "order_id": order.order_id,
            "status": order.status,
            "trace_id": resolved_trace,
        }

    def _record(self, trace_id: str, action: str, output: dict[str, object], summary: str) -> None:
        self.gateway.commerce.ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                merchant_id=self.gateway.commerce.merchant_scope,
                actor=LedgerActor.BUYER_AGENT,
                action=action,
                output=output,
                reasoning_summary=summary,
            )
        )
