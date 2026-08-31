"""Bounded Seller Agent orchestration built on a small LangGraph state machine.

This module intentionally has no model client. A future LLM may choose which
grounded tool to call or phrase a response, but this agent's data and candidate
cart always originate from deterministic catalog and policy tools.
"""

from __future__ import annotations

from enum import StrEnum
from typing import NotRequired, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import Field

from agents.seller.tools import SellerTools
from sellable.catalog import UnknownSkuError
from sellable.contracts import (
    CartItem,
    CartMandate,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    PolicyDecision,
    PolicyVerdict,
    Product,
    StrictModel,
)
from sellable.core import CommerceCore


class SellerAction(StrEnum):
    QUOTE_READY = "QUOTE_READY"
    COUNTERED = "COUNTERED"
    NEEDS_HUMAN_APPROVAL = "NEEDS_HUMAN_APPROVAL"
    DENIED = "DENIED"
    NO_MATCH = "NO_MATCH"


class SellerRequest(StrictModel):
    message: str = Field(min_length=1, max_length=1_000)
    intent: IntentMandate
    requested_sku: str | None = Field(default=None, max_length=64)
    quantity: int = Field(default=1, ge=1, le=100)
    buyer_offer_paise: int | None = Field(default=None, gt=0)
    request_upsell: bool = True


class SellerDecision(StrictModel):
    trace_id: str
    action: SellerAction
    response_message: str = Field(min_length=1, max_length=1_000)
    cart: CartMandate | None = None
    policy_decision: PolicyDecision | None = None
    selected_product: Product | None = None
    upsell_product: Product | None = None
    tool_calls: list[str] = Field(default_factory=list)


class SellerGraphState(TypedDict):
    request: SellerRequest
    trace_id: str
    search_results: NotRequired[list[Product]]
    selected_product: NotRequired[Product | None]
    candidate_cart: NotRequired[CartMandate | None]
    policy_decision: NotRequired[PolicyDecision | None]
    upsell_product: NotRequired[Product | None]
    countered: NotRequired[bool]
    tool_calls: NotRequired[list[str]]
    result: NotRequired[SellerDecision]


class SellerAgent:
    def __init__(self, commerce: CommerceCore) -> None:
        self.commerce = commerce
        self.tools = SellerTools(commerce)
        self._graph = self._build_graph()

    def respond(self, request: SellerRequest, *, trace_id: str | None = None) -> SellerDecision:
        result = self._graph.invoke(
            {"request": request, "trace_id": trace_id or f"trc_{uuid4().hex}"}
        )
        return result["result"]

    def _build_graph(self):
        graph = StateGraph(SellerGraphState)
        graph.add_node("search_catalog", self._search_catalog)
        graph.add_node("create_quote", self._create_quote)
        graph.add_node("consider_upsell", self._consider_upsell)
        graph.add_node("format_response", self._format_response)
        graph.add_edge(START, "search_catalog")
        graph.add_edge("search_catalog", "create_quote")
        graph.add_edge("create_quote", "consider_upsell")
        graph.add_edge("consider_upsell", "format_response")
        graph.add_edge("format_response", END)
        return graph.compile()

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
            results = self.tools.catalog_search(query=request.message, trace_id=trace_id)
            selected = results[0] if results else None
        return {
            "search_results": results,
            "selected_product": selected,
            "tool_calls": tool_calls,
        }

    def _create_quote(self, state: SellerGraphState) -> dict[str, object]:
        product = state.get("selected_product")
        if product is None:
            return {"candidate_cart": None, "policy_decision": None}
        request = state["request"]
        cart, countered = self.tools.quote_create(
            product=product,
            quantity=request.quantity,
            buyer_offer_paise=request.buyer_offer_paise,
            intent_ref=request.intent.mandate_id,
            trace_id=state["trace_id"],
        )
        decision = self.commerce.evaluate_quote(
            cart=cart, intent=request.intent, trace_id=state["trace_id"]
        )
        return {
            "candidate_cart": cart,
            "policy_decision": decision,
            "countered": countered,
            "tool_calls": [
                *state["tool_calls"],
                "quotes.negotiate" if countered else "quotes.create",
                "policy.evaluate",
            ],
        }

    def _consider_upsell(self, state: SellerGraphState) -> dict[str, object]:
        request = state["request"]
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        if (
            cart is None
            or decision is None
            or decision.verdict is not PolicyVerdict.ALLOW
            or not request.request_upsell
        ):
            return {"upsell_product": None}
        enriched, upsell = self.tools.upsell_suggest(cart=cart, trace_id=state["trace_id"])
        if upsell is None:
            return {"upsell_product": None}
        enriched_decision = self.commerce.evaluate_quote(
            cart=enriched, intent=request.intent, trace_id=state["trace_id"]
        )
        if enriched_decision.verdict is PolicyVerdict.ALLOW:
            return {
                "candidate_cart": enriched,
                "policy_decision": enriched_decision,
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

    def _format_response(self, state: SellerGraphState) -> dict[str, object]:
        product = state.get("selected_product")
        cart = state.get("candidate_cart")
        decision = state.get("policy_decision")
        if product is None:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.NO_MATCH,
                response_message="I could not find a matching catalog item, so no quote was created.",
                tool_calls=state["tool_calls"],
            )
        elif decision is None or cart is None:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.DENIED,
                response_message="The catalog item could not be converted into a valid candidate cart.",
                selected_product=product,
                tool_calls=state["tool_calls"],
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
            )
        elif decision.verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL:
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=SellerAction.NEEDS_HUMAN_APPROVAL,
                response_message="This valid cart has been held for merchant approval before consent.",
                cart=cart,
                policy_decision=decision,
                selected_product=product,
                tool_calls=state["tool_calls"],
            )
        else:
            was_countered = state.get("countered", False)
            action = SellerAction.COUNTERED if was_countered else SellerAction.QUOTE_READY
            result = SellerDecision(
                trace_id=state["trace_id"],
                action=action,
                response_message=(
                    "Here is the lowest policy-valid counter-offer."
                    if was_countered
                    else "Here is a policy-valid candidate cart."
                ),
                cart=cart,
                policy_decision=decision,
                selected_product=product,
                upsell_product=state.get("upsell_product"),
                tool_calls=state["tool_calls"],
            )
        self.tools._record(
            trace_id=result.trace_id,
            action="seller.response_ready",
            inputs={"tool_calls": result.tool_calls},
            output={"action": result.action, "cart_id": result.cart.mandate_id if result.cart else None},
            explanation="Produced a structured seller response from catalog and policy tool results.",
        )
        return {"result": result}
