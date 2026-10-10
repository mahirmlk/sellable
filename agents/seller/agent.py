"""Bounded Seller Agent orchestration built on a staged LangGraph state machine.

Stages (§7.2): UNDERSTAND_INTENT → SEARCH → RECOMMEND → BUILD_CART →
PRICE → PROMOTION → CHECKOUT → RESPOND, with negotiation folded into the
single-shot counter inside BUILD_CART (bounded by the merchant's round
limit counted across the trace) and upsell evaluation before promotion.

The model proposes phrasing only. Every SKU, price, promotion, and policy
outcome originates from deterministic tools; pre/post guardrails (§9),
version stamping (§8.3), model-gateway telemetry (§8.2), and run recording
(§29.1) wrap every execution.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import NotRequired, TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from pydantic import Field

from agents.llm.adapters.base import LLMAdapter, reply_amounts_known, reply_skus_known
from agents.runtime import guardrails as guards
from agents.runtime.guardrails import GuardrailContext, GuardrailRecorder
from agents.runtime.model_gateway import ModelGateway
from agents.runtime.recorder import AgentRunRecorder
from agents.runtime.versions import (
    SELLER_AGENT_ID,
    AgentVersion,
    VersionRegistry,
    policy_bundle_version,
    seed_registry,
)
from agents.seller.intent import TurnKind, classify_buyer_message
from agents.seller.tools import SellerTools
from sellable.catalog import UnknownSkuError
from sellable.contracts import (
    CartMandate,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    PolicyDecision,
    PolicyVerdict,
    Product,
    PromotionResult,
    StrictModel,
)
from sellable.core import CommerceCore


logger = logging.getLogger("sellable.agents.seller")

#: Hard cap on graph recursion: the graph is linear by construction, so any
#: recursion here means a wiring bug — fail safe, never loop.
GRAPH_RECURSION_LIMIT = 16


class SellerAction(StrEnum):
    QUOTE_READY = "QUOTE_READY"
    COUNTERED = "COUNTERED"
    NEEDS_HUMAN_APPROVAL = "NEEDS_HUMAN_APPROVAL"
    DENIED = "DENIED"
    NO_MATCH = "NO_MATCH"
    PRICE_QUERY = "PRICE_QUERY"


class SellerStage(StrEnum):
    UNDERSTAND_INTENT = "UNDERSTAND_INTENT"
    SEARCH = "SEARCH"
    RECOMMEND = "RECOMMEND"
    BUILD_CART = "BUILD_CART"
    PRICE = "PRICE"
    NEGOTIATE = "NEGOTIATE"
    PROMOTION = "PROMOTION"
    CHECKOUT = "CHECKOUT"
    RESPOND = "RESPOND"


class SellerRequest(StrictModel):
    message: str = Field(min_length=1, max_length=1_000)
    intent: IntentMandate
    requested_sku: str | None = Field(default=None, max_length=64)
    quantity: int = Field(default=1, ge=1, le=100)
    buyer_offer_paise: int | None = Field(default=None, gt=0)
    request_upsell: bool = True
    # "What's your best price?" — reply with the policy-derived floor, no cart.
    price_query: bool = False
    # Explicit buyer acceptance of a suggested add-on; only this mutates the
    # cart with the upsell item (policy re-checked).
    accept_upsell: bool = False
    # Optional promotion coupon evaluated deterministically at PROMOTION.
    coupon_code: str | None = Field(default=None, max_length=64)


class SellerDecision(StrictModel):
    trace_id: str
    action: SellerAction
    response_message: str = Field(min_length=1, max_length=1_000)
    cart: CartMandate | None = None
    policy_decision: PolicyDecision | None = None
    selected_product: Product | None = None
    upsell_product: Product | None = None
    tool_calls: list[str] = Field(default_factory=list)
    stage: SellerStage = SellerStage.RESPOND
    recommendations: list[Product] = Field(default_factory=list)
    promotion: PromotionResult | None = None
    persistent_cart_id: str | None = None
    agent_id: str = ""
    agent_version: str = ""
    prompt_version: str = ""
    guardrail_blocks: list[str] = Field(default_factory=list)


class SellerGraphState(TypedDict):
    request: SellerRequest
    trace_id: str
    turn_kind: NotRequired[str]
    search_results: NotRequired[list[Product]]
    selected_product: NotRequired[Product | None]
    recommendations: NotRequired[list[Product]]
    candidate_cart: NotRequired[CartMandate | None]
    policy_decision: NotRequired[PolicyDecision | None]
    promotion_result: NotRequired[PromotionResult | None]
    persistent_cart_id: NotRequired[str | None]
    upsell_product: NotRequired[Product | None]
    countered: NotRequired[bool]
    best_price_paise: NotRequired[int | None]
    tool_calls: NotRequired[list[str]]
    result: NotRequired[SellerDecision]


class SellerAgent:
    def __init__(
        self,
        commerce: CommerceCore,
        llm: "LLMAdapter | None" = None,
        *,
        versions: AgentVersion | None = None,
        registry: VersionRegistry | None = None,
        guardrails_enabled: bool = True,
        recorder: AgentRunRecorder | None = None,
        model_gateway: ModelGateway | None = None,
    ) -> None:
        self.commerce = commerce
        self.llm = llm
        if versions is None:
            registry = registry or seed_registry(
                VersionRegistry(), commerce.policy
            )
            versions = registry.require(SELLER_AGENT_ID)
        self.versions = versions
        self.guardrails_enabled = guardrails_enabled
        self.recorder = recorder or AgentRunRecorder(
            merchant_id=commerce.merchant_scope, agent_id=versions.agent_id
        )
        self.recorder.merchant_id = commerce.merchant_scope
        self.gateway = model_gateway
        if self.gateway is None and llm is not None:
            self.gateway = ModelGateway(llm, recorder=self.recorder.record_model)
        self.tools = SellerTools(commerce, recorder=self.recorder)
        self._checkpointer = MemorySaver()
        self._graph = self._build_graph()

    # ------------------------------------------------------------------
    # Entry point: guards → recorded run → post-checks.
    # ------------------------------------------------------------------

    def respond(self, request: SellerRequest, *, trace_id: str | None = None) -> SellerDecision:
        resolved_trace = trace_id or f"trc_{uuid4().hex}"
        guard_recorder = GuardrailRecorder()
        if self.guardrails_enabled:
            blocked, results = guards.run_guards(
                self._guard_context(request, resolved_trace)
            )
            guard_recorder.extend(results)
            if blocked:
                return self._denied_by_guardrail(
                    request, resolved_trace, guard_recorder
                )
        run_trace = resolved_trace
        self.recorder.open_run(
            trace_id=run_trace,
            versions=self.versions,
            model_version=self.gateway.model if self.gateway else "",
        )
        try:
            result = self._graph.invoke(
                {"request": request, "trace_id": run_trace},
                config={
                    "recursion_limit": GRAPH_RECURSION_LIMIT,
                    "configurable": {"thread_id": run_trace},
                },
            )["result"]
        except Exception as error:  # noqa: BLE001 — agents degrade, never crash flows
            logger.warning("seller run failed safely: %s", error)
            result = SellerDecision(
                trace_id=run_trace,
                action=SellerAction.DENIED,
                response_message="I could not complete that request safely, so no quote was created.",
                tool_calls=[],
                stage=SellerStage.RESPOND,
                agent_id=self.versions.agent_id,
                agent_version=self.versions.agent_version,
                prompt_version=self.versions.prompt_version,
                guardrail_blocks=["RUN_FAILED_SAFE"],
            )
            self.recorder.close_run(status="ERROR", outcome="DENIED", error=str(error)[:300])
            return result
        result = result.model_copy(
            update={
                "agent_id": self.versions.agent_id,
                "agent_version": self.versions.agent_version,
                "prompt_version": self.versions.prompt_version,
                "guardrail_blocks": guard_recorder.blocks,
            }
        )
        self.recorder.close_run(status="COMPLETED", outcome=result.action.value)
        self._publish_run_completed(result)
        return result

    def _publish_run_completed(self, result: SellerDecision) -> None:
        """Fan agent telemetry into the event bus (§29 + §34.2): the
        analytics consumer normalizes run/completion facts. Best-effort —
        the ledger run rows are already durable."""
        try:
            from sellable.events import new_event

            cost_usd = self.gateway.total_cost_usd if self.gateway else 0.0
            self.commerce.outbox_repo.publish(
                new_event(
                    event_type="agent.run.completed",
                    tenant_id=self.commerce.merchant_scope,
                    merchant_id=self.commerce.merchant_scope,
                    aggregate_type="agent_run",
                    aggregate_id=self.recorder.run_id,
                    trace_id=result.trace_id,
                    actor_type="agent",
                    actor_id=self.versions.agent_id,
                    data={
                        "action": result.action.value,
                        "agent_version": self.versions.agent_version,
                        "model_cost_usd": cost_usd,
                        "tool_calls": len(result.tool_calls),
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 — telemetry is additive
            logger.warning("agent run publish failed: %s", exc)

    def _guard_context(
        self, request: SellerRequest, trace_id: str
    ) -> GuardrailContext:
        return GuardrailContext(
            agent_id=self.versions.agent_id,
            agent_type="SELLABLE_INTERNAL_AGENT",
            merchant_id=self.commerce.merchant_scope,
            session_id=trace_id,
            trace_id=trace_id,
            input_text=request.message,
            allowed_tools=self._tool_allowlist(),
        )

    @staticmethod
    def _tool_allowlist() -> tuple[str, ...]:
        return (
            "catalog.search",
            "catalog.get",
            "catalog.compare",
            "catalog.availability",
            "cart.create",
            "cart.add_item",
            "cart.get",
            "cart.prepare",
            "quotes.create",
            "quotes.negotiate",
            "quote.best_price",
            "quote.refresh",
            "upsell.suggest",
            "recommendations.get",
            "promotion.evaluate",
            "promotion.explain",
            "shipping.get_options",
            "checkout.create",
            "checkout.get",
            "checkout.request_approval",
            "customer.get_context",
            "order.get",
            "order.cancel_request",
            "service.create_case",
            "service.handoff",
            "policy.evaluate",
        )

    def _denied_by_guardrail(
        self,
        request: SellerRequest,
        trace_id: str,
        guard_recorder: GuardrailRecorder,
    ) -> SellerDecision:
        self.tools._record(
            trace_id=trace_id,
            action="seller.guardrail_blocked",
            inputs={"blocks": guard_recorder.blocks},
            output={"action": SellerAction.DENIED},
            explanation="Guardrail middleware blocked the seller run before tool use.",
        )
        self.recorder.open_run(trace_id=trace_id, versions=self.versions)
        self.recorder.close_run(status="BLOCKED", outcome="DENIED")
        return SellerDecision(
            trace_id=trace_id,
            action=SellerAction.DENIED,
            response_message="That request cannot be handled safely, so no quote was created.",
            tool_calls=[],
            stage=SellerStage.UNDERSTAND_INTENT,
            agent_id=self.versions.agent_id,
            agent_version=self.versions.agent_version,
            prompt_version=self.versions.prompt_version,
            guardrail_blocks=guard_recorder.blocks,
        )

    # ------------------------------------------------------------------
    # Staged graph (§7.2).
    # ------------------------------------------------------------------

    def _build_graph(self):
        graph = StateGraph(SellerGraphState)
        graph.add_node("understand_intent", self._understand_intent)
        graph.add_node("search_catalog", self._search_catalog)
        graph.add_node("recommend", self._recommend)
        graph.add_node("build_cart", self._build_cart)
        graph.add_node("evaluate_price", self._evaluate_price)
        graph.add_node("consider_upsell", self._consider_upsell)
        graph.add_node("promote", self._promote)
        graph.add_node("checkout_assist", self._checkout_assist)
        graph.add_node("format_response", self._format_response)
        graph.add_edge(START, "understand_intent")
        graph.add_edge("understand_intent", "search_catalog")
        graph.add_edge("search_catalog", "recommend")
        graph.add_edge("recommend", "build_cart")
        graph.add_edge("build_cart", "evaluate_price")
        graph.add_edge("evaluate_price", "consider_upsell")
        graph.add_edge("consider_upsell", "promote")
        graph.add_edge("promote", "checkout_assist")
        graph.add_edge("checkout_assist", "format_response")
        graph.add_edge("format_response", END)
        return graph.compile(checkpointer=self._checkpointer)

    def _understand_intent(self, state: SellerGraphState) -> dict[str, object]:
        try:
            turn_kind = classify_buyer_message(state["request"].message).kind.value
        except Exception:  # noqa: BLE001 — classification never breaks runs
            turn_kind = TurnKind.OTHER.value
        return {"turn_kind": turn_kind}

    def _search_catalog(self, state: SellerGraphState) -> dict[str, object]:
        request = state["request"]
        trace_id = state["trace_id"]
        tool_calls = ["catalog.search"]
        if request.requested_sku:
            try:
                selected = self.tools.catalog_get(sku=request.requested_sku, trace_id=trace_id)
            except UnknownSkuError:
                selected = None
            tool_calls = ["catalog.get"]
            results = [selected] if selected else []
        else:
            results = self.tools.catalog_search(
                query=request.message,
                trace_id=trace_id,
                allowed_categories=request.intent.allowed_categories,
            )
            selected = results[0] if results else None
        return {
            "search_results": results,
            "selected_product": selected,
            "tool_calls": tool_calls,
        }

    def _recommend(self, state: SellerGraphState) -> dict[str, object]:
        request = state["request"]
        selected = state.get("selected_product")
        # Recommendations serve first-touch discovery, never contested
        # pricing: while negotiating, price-querying, or accepting an upsell,
        # the run stays focused on the item at hand.
        if (
            selected is None
            or request.requested_sku is not None
            or request.buyer_offer_paise is not None
            or request.price_query
            or request.accept_upsell
        ):
            return {"recommendations": []}
        recommendations = self.tools.recommend(
            product=selected, trace_id=state["trace_id"]
        )
        return {
            "recommendations": recommendations,
            "tool_calls": [*state["tool_calls"], "recommendations.get"],
        }

    def _build_cart(self, state: SellerGraphState) -> dict[str, object]:
        product = state.get("selected_product")
        if product is None:
            return {"candidate_cart": None, "policy_decision": None}
        request = state["request"]
        trace_id = state["trace_id"]
        if request.price_query:
            # Informational: the lowest policy-valid price, no cart mutation.
            best = self.tools.best_price(product=product, trace_id=trace_id)
            return {
                "best_price_paise": best,
                "candidate_cart": None,
                "policy_decision": None,
                "tool_calls": [*state["tool_calls"], "quote.best_price"],
            }
        # Negotiation rounds accumulate across one trace: every prior
        # countered offer on this trace counts, so a buyer hammering offers
        # eventually trips the merchant's max_negotiation_rounds policy.
        # Tenant-scoped: trace ids are client-influenced, so a colliding
        # trace from another merchant must never inflate this merchant's
        # rounds (fail-closed direction, but still a cross-tenant read).
        prior_rounds = sum(
            1
            for event in self.commerce.ledger.for_trace(
                trace_id, merchant_id=self.commerce.merchant_scope
            )
            if event.action == "negotiation.countered"
        )
        cart, countered = self.tools.quote_create(
            product=product,
            quantity=request.quantity,
            buyer_offer_paise=request.buyer_offer_paise,
            intent_ref=request.intent.mandate_id,
            trace_id=trace_id,
            negotiation_round=(prior_rounds + 1) if request.buyer_offer_paise is not None else None,
        )
        return {
            "candidate_cart": cart,
            "countered": countered,
            "tool_calls": [
                *state["tool_calls"],
                "quotes.negotiate" if countered else "quotes.create",
            ],
        }

    def _evaluate_price(self, state: SellerGraphState) -> dict[str, object]:
        cart = state.get("candidate_cart")
        if cart is None:
            return {"policy_decision": None}
        request = state["request"]
        decision = self.commerce.evaluate_quote(
            cart=cart, intent=request.intent, trace_id=state["trace_id"]
        )
        self.tools._note_tool("policy.evaluate")
        return {
            "policy_decision": decision,
            "tool_calls": [*state["tool_calls"], "policy.evaluate"],
        }

    def _consider_upsell(self, state: SellerGraphState) -> dict[str, object]:
        request = state["request"]
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        if (
            cart is None
            or decision is None
            or decision.verdict is not PolicyVerdict.ALLOW
        ):
            return {"upsell_product": None}
        # Negotiation discipline: while the buyer is negotiating (an explicit
        # offer is on the table) or asking for the best price, upsells are
        # disabled — no accessories while the primary price is contested.
        if request.buyer_offer_paise is not None or request.price_query:
            return {"upsell_product": None}
        # Single-shot respond(): at most one upsell per session here, so the
        # session count is 0 and the merchant cap is enforced both in the
        # tool (max == 0 disables upsells) and in the policy evaluation.
        accept = request.accept_upsell
        enriched, upsell = self.tools.upsell_suggest(
            cart=cart, trace_id=state["trace_id"], session_upsells=0, accept=accept
        )
        if upsell is None:
            return {"upsell_product": None}
        enriched_decision = self.commerce.evaluate_quote(
            cart=enriched,
            intent=request.intent,
            trace_id=state["trace_id"],
            upsells_in_session=0,
        )
        self.tools._note_tool("policy.evaluate")
        if enriched_decision.verdict is PolicyVerdict.ALLOW:
            if accept:
                return {
                    "candidate_cart": enriched,
                    "policy_decision": enriched_decision,
                    "upsell_product": upsell,
                    "tool_calls": [*state["tool_calls"], "upsell.suggest", "policy.evaluate"],
                }
            # Suggestion only: the cart the buyer is quoting on stays
            # unchanged until the buyer explicitly accepts the add-on.
            return {
                "upsell_product": upsell,
                "tool_calls": [*state["tool_calls"], "upsell.suggest", "policy.evaluate"],
            }
        self.tools._record(
            trace_id=state["trace_id"],
            action="upsell.skipped",
            inputs={"upsell_sku": upsell.sku},
            output={"reason_code": enriched_decision.reason_code},
            explanation="Skipped the upsell because the enriched cart was not policy-valid.",
        )
        return {
            "upsell_product": None,
            "tool_calls": [*state["tool_calls"], "upsell.suggest", "policy.evaluate"],
        }

    def _promote(self, state: SellerGraphState) -> dict[str, object]:
        """PROMOTION stage: deterministic promotion opportunities on ALLOW
        carts. The LLM later explains them; it can never invent one."""
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        if (
            cart is None
            or decision is None
            or decision.verdict is not PolicyVerdict.ALLOW
        ):
            return {"promotion_result": None}
        result = self.tools.promotion_evaluate(
            cart=cart,
            trace_id=state["trace_id"],
            channel="agent",
            coupon_code=state["request"].coupon_code,
        )
        return {
            "promotion_result": result,
            "tool_calls": [*state["tool_calls"], "promotion.evaluate"],
        }

    def _checkout_assist(self, state: SellerGraphState) -> dict[str, object]:
        """CHECKOUT stage: bridge the quote-era mandate into a persistent,
        versioned cart the checkout flow can consume. Best-effort: a stock
        race between quote and persist skips assistance, never breaks it."""
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        if (
            cart is None
            or decision is None
            or decision.verdict is not PolicyVerdict.ALLOW
        ):
            return {"persistent_cart_id": None}
        trace_id = state["trace_id"]
        try:
            persistent = self.commerce.cart_service.create_cart(
                self.commerce.merchant_scope, agent_session_id=trace_id
            )
            for item in cart.items:
                persistent = self.commerce.cart_service.add_item(
                    persistent.cart_id,
                    self.commerce.merchant_scope,
                    item.sku,
                    item.quantity,
                    expected_version=persistent.version,
                )
        except Exception as error:  # noqa: BLE001 — assistance is additive
            logger.warning("checkout assist skipped: %s", error)
            return {"persistent_cart_id": None}
        self.tools._record(
            trace_id=trace_id,
            action="checkout.cart_prepared",
            inputs={"mandate_id": cart.mandate_id},
            output={
                "persistent_cart_id": persistent.cart_id,
                "grand_total_paise": persistent.grand_total_paise,
            },
            explanation="Bridged the quoted mandate into a persistent cart for checkout.",
        )
        return {
            "persistent_cart_id": persistent.cart_id,
            "tool_calls": [*state["tool_calls"], "cart.prepare"],
        }

    def _format_response(self, state: SellerGraphState) -> dict[str, object]:
        product = state.get("selected_product")
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        buyer_offer_paise = state["request"].buyer_offer_paise
        best_price_paise = state.get("best_price_paise")
        promotion = state.get("promotion_result")
        if product is None:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.NO_MATCH,
                response_message="I could not find a matching catalog item, so no quote was created.",
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
            )
        elif best_price_paise is not None:
            # Price query: policy-derived floor, no cart created.
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.PRICE_QUERY,
                response_message=(
                    f"The lowest policy-valid price for {product.sku} is "
                    f"{self._inr(best_price_paise)} per unit "
                    f"(list {self._inr(product.price_paise)}). "
                    "Tell me the amount you'd like to pay and I'll check it against the merchant rules."
                ),
                selected_product=product,
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
            )
        elif decision is None or cart is None:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.DENIED,
                response_message="The catalog item could not be converted into a valid candidate cart.",
                selected_product=product,
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
            )
        elif decision.verdict is PolicyVerdict.DENY:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.DENIED,
                response_message=f"I cannot offer this cart: {decision.reasoning_summary}",
                cart=cart,
                policy_decision=decision,
                selected_product=product,
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
            )
        elif decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.NEEDS_HUMAN_APPROVAL,
                response_message=(
                    "This valid cart has been held for merchant approval before "
                    f"consent. Current cart total: {self._inr(cart.total_paise)}."
                ),
                cart=cart,
                policy_decision=decision,
                selected_product=product,
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
            )
        else:
            was_countered = state.get("countered", False)
            action = SellerAction.COUNTERED if was_countered else SellerAction.QUOTE_READY
            message = self._quote_message(cart, was_countered, buyer_offer_paise)
            if promotion is not None and promotion.applied_promotion_ids:
                message = (
                    f"{message} Eligible promotions save "
                    f"{self._inr(promotion.discount_total_paise)} on this cart."
                )
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=action,
                response_message=message,
                cart=cart,
                policy_decision=decision,
                selected_product=product,
                upsell_product=state.get("upsell_product"),
                tool_calls=state["tool_calls"],
                stage=SellerStage.RESPOND,
                recommendations=state.get("recommendations", []),
                promotion=promotion,
                persistent_cart_id=state.get("persistent_cart_id"),
            )
        self.tools._record(
            trace_id=result.trace_id,
            action="seller.response_ready",
            inputs={"tool_calls": result.tool_calls},
            output={"action": result.action, "cart_id": result.cart.mandate_id if result.cart else None},
            explanation="Produced a structured seller response from catalog and policy tool results.",
        )
        return {
            "result": self._phrase_if_llm(
                result, state["request"].message, state["request"].intent, state["trace_id"]
            )
        }

    @staticmethod
    def _inr(paise: int) -> str:
        return f"₹{paise / 100:,.2f}"

    def _quote_message(
        self, cart: CartMandate, was_countered: bool, buyer_offer_paise: int | None
    ) -> str:
        """Deterministic, price-bearing transcript text for a valid quote.

        Presentation only: every figure comes from the policy-validated cart,
        never from a model. The negotiation algorithm itself is untouched.
        """
        if buyer_offer_paise is None or not cart.items:
            return (
                f"{cart.items[0].sku} is {self._inr(cart.items[0].offered_price_paise)} "
                f"per unit — a policy-valid candidate cart."
            )
        item = cart.items[0]
        unit = self._inr(item.offered_price_paise)
        if was_countered:
            return (
                f"I can offer {item.sku} at {unit} per unit — that is the lowest "
                f"price I can offer within the merchant's pricing rules."
            )
        return (
            f"Accepted {unit} per unit for {item.sku} "
            f"(discount {self._inr(cart.discount_paise)})."
        )

    def _phrase_if_llm(
        self,
        result: SellerDecision,
        buyer_message: str,
        intent: IntentMandate,
        trace_id: str,
    ) -> SellerDecision:
        """Rephrase the response message in natural language when an LLM is wired.

        The LLM only rephrases the human-facing message from the structured,
        tool-grounded decision. It can never invent SKUs, prices, stock, or
        policy outcomes: it is handed the exact decision payload and asked to
        write a concise buyer-facing reply. The reply is validated against the
        known cart SKUs, and every money amount it mentions must exactly match
        an authoritative figure from the policy-validated cart or the buyer's
        intent budget — a reply that converts, rounds, reformats, or invents a
        price is rejected and the deterministic message is used instead. The
        outcome is ledgered so replay distinguishes LLM phrasing from the
        deterministic fallback. Any failure falls back to the deterministic
        message so the commerce flow never breaks.
        """
        if (self.gateway is None and self.llm is None) or result.cart is None:
            return result
        known_skus = {item.sku for item in result.cart.items}
        if result.upsell_product:
            known_skus.add(result.upsell_product.sku)
        known_skus.update(p.sku for p in result.recommendations)
        allowed_paise = self._authoritative_paise(result, intent)
        summary = self._decision_summary(result, buyer_message, intent)
        try:
            # Phrasing is cosmetic: bound it well below the provider default
            # so a slow model delays — but never hangs — the quote path.
            if self.gateway is not None:
                reply, _record = self.gateway.complete(
                    [
                        {
                            "role": "system",
                            "content": (
                                "You are SELLABLE's merchant seller assistant replying to an AI buyer. "
                                "Use ONLY the facts in the structured payload. Never invent SKUs, prices, "
                                "stock, discounts, or policy outcomes. Every money amount in your reply "
                                "must be copied exactly from the payload — never convert, round, "
                                "reformat, or compute amounts. Reply in 1-3 concise, friendly "
                                "sentences, addressing what the buyer asked."
                            ),
                        },
                        {
                            "role": "user",
                            "content": summary,
                        },
                    ],
                    timeout=10,
                    purpose="seller.response_phrased",
                )
                reply = reply.strip()
                llm_model = self.gateway.model
            else:
                reply = self.llm.complete(
                    [
                        {
                            "role": "system",
                            "content": (
                                "You are SELLABLE's merchant seller assistant replying to an AI buyer. "
                                "Use ONLY the facts in the structured payload. Never invent SKUs, prices, "
                                "stock, discounts, or policy outcomes. Every money amount in your reply "
                                "must be copied exactly from the payload — never convert, round, "
                                "reformat, or compute amounts. Reply in 1-3 concise, friendly "
                                "sentences, addressing what the buyer asked."
                            ),
                        },
                        {
                            "role": "user",
                            "content": summary,
                        },
                    ],
                    timeout=10,
                ).strip()
                llm_model = getattr(self.llm, "model", "unknown")
            if (
                reply
                and len(reply) <= 1_000
                and reply_skus_known(reply, known_skus)
                and reply_amounts_known(reply, allowed_paise)
            ):
                self.tools._record(
                    trace_id=trace_id,
                    action="seller.response_phrased",
                    inputs={"tool_calls": result.tool_calls},
                    output={"llm_used": True, "model": llm_model},
                    explanation="Rephrased the seller message with the LLM; SKUs and money amounts validated against the cart.",
                )
                return result.model_copy(update={"response_message": reply})
            if reply:
                logger.warning(
                    "seller rephrase rejected (length, unknown SKU, or non-authoritative amount); "
                    "using deterministic text"
                )
        except Exception as error:
            logger.warning("seller rephrase failed; using deterministic text: %s", error)
        self.tools._record(
            trace_id=trace_id,
            action="seller.response_phrased",
            inputs={"tool_calls": result.tool_calls},
            output={"llm_used": False},
            explanation="Kept the deterministic seller message.",
        )
        return result

    @staticmethod
    def _authoritative_paise(result: SellerDecision, intent: IntentMandate) -> set[int]:
        """Every paise value the reply is allowed to state.

        Built only from the policy-validated cart and the buyer's intent
        budget — the same figures the deterministic message renders — so the
        LLM can quote the deal in rupees or paise but can never introduce a
        different amount.
        """
        amounts: set[int] = {intent.budget_ceiling_paise}
        cart = result.cart
        if cart:
            for item in cart.items:
                amounts.update({item.unit_price_paise, item.offered_price_paise, item.line_total_paise})
            amounts.update({cart.subtotal_paise, cart.discount_paise, cart.total_paise})
        if result.promotion:
            amounts.add(result.promotion.discount_total_paise)
        return amounts

    def _decision_summary(
        self, result: SellerDecision, buyer_message: str, intent: IntentMandate
    ) -> str:
        cart = result.cart
        lines = [
            f"Buyer request: {buyer_message}",
            f"Buyer budget ceiling: {self._inr(intent.budget_ceiling_paise)} "
            f"({intent.budget_ceiling_paise} paise)",
            f"Action: {result.action}",
        ]
        if cart:
            for item in cart.items:
                lines.append(
                    f"- {item.sku} x{item.quantity} at {self._inr(item.offered_price_paise)} per unit "
                    f"({item.offered_price_paise} paise; list {self._inr(item.unit_price_paise)})"
                )
            lines.append(
                f"Cart total: {self._inr(cart.total_paise)} ({cart.total_paise} paise; "
                f"discount {self._inr(cart.discount_paise)})"
            )
            if cart.upsell_rationale:
                lines.append(f"Upsell rationale: {cart.upsell_rationale}")
        if result.promotion and result.promotion.applied_promotion_ids:
            lines.append(
                f"Eligible promotions: {', '.join(result.promotion.applied_promotion_ids)} "
                f"worth {self._inr(result.promotion.discount_total_paise)}"
            )
        if result.policy_decision:
            lines.append(f"Policy verdict: {result.policy_decision.verdict}")
            if result.policy_decision.reason_code:
                lines.append(f"Policy reason: {result.policy_decision.reason_code}")
            if result.policy_decision.reasoning_summary:
                lines.append(f"Policy reasoning: {result.policy_decision.reasoning_summary}")
        return "\n".join(lines)
