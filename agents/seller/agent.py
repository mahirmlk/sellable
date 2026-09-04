"""Bounded Seller Agent orchestration built on a small LangGraph state machine.

This module intentionally has no model client. A future LLM may choose which
grounded tool to call or phrase a response, but this agent's data and candidate
cart always originate from deterministic catalog and policy tools.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import NotRequired, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import Field

from agents.llm.adapters.base import LLMAdapter, reply_skus_known
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
    StrictModel,
)
from sellable.core import CommerceCore


logger = logging.getLogger("sellable.agents.seller")


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
    def __init__(
        self,
        commerce: CommerceCore,
        llm: "LLMAdapter | None" = None,
    ) -> None:
        self.commerce = commerce
        self.llm = llm
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
        # Single-shot respond(): at most one upsell per session here, so the
        # session count is 0 and the merchant cap is enforced both in the
        # tool (max == 0 disables upsells) and in the policy evaluation.
        enriched, upsell = self.tools.upsell_suggest(
            cart=cart, trace_id=state["trace_id"], session_upsells=0
        )
        if upsell is None:
            return {"upsell_product": None}
        enriched_decision = self.commerce.evaluate_quote(
            cart=enriched,
            intent=request.intent,
            trace_id=state["trace_id"],
            upsells_in_session=0,
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
        buyer_offer_paise = state["request"].buyer_offer_paise
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
                response_message=(
                    "This valid cart has been held for merchant approval before "
                    f"consent. Current cart total: {self._inr(cart.total_paise)}."
                ),
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
                response_message=self._quote_message(
                    cart, was_countered, buyer_offer_paise
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
        return {
            "result": self._phrase_if_llm(result, state["request"].message, state["trace_id"])
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
            return "Here is a policy-valid candidate cart."
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
        self, result: SellerDecision, buyer_message: str, trace_id: str
    ) -> SellerDecision:
        """Rephrase the response message in natural language when an LLM is wired.

        The LLM only rephrases the human-facing message from the structured,
        tool-grounded decision. It can never invent SKUs, prices, stock, or
        policy outcomes: it is handed the exact decision payload and asked to
        write a concise buyer-facing reply. The reply is validated against the
        known cart SKUs — a reply naming an unknown SKU is rejected — and the
        outcome is ledgered so replay distinguishes LLM phrasing from the
        deterministic fallback. Any failure falls back to the deterministic
        message so the commerce flow never breaks.
        """
        if self.llm is None or result.cart is None:
            return result
        known_skus = {item.sku for item in result.cart.items}
        summary = self._decision_summary(result, buyer_message)
        try:
            # Phrasing is cosmetic: bound it well below the provider default
            # so a slow model delays — but never hangs — the quote path.
            reply = self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are SELLABLE's merchant seller assistant replying to an AI buyer. "
                            "Use ONLY the facts in the structured payload. Never invent SKUs, prices, "
                            "stock, discounts, or policy outcomes. Reply in 1-3 concise, friendly "
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
            if reply and len(reply) <= 1_000 and reply_skus_known(reply, known_skus):
                self.tools._record(
                    trace_id=trace_id,
                    action="seller.response_phrased",
                    inputs={"tool_calls": result.tool_calls},
                    output={"llm_used": True, "model": getattr(self.llm, "model", "unknown")},
                    explanation="Rephrased the seller message with the LLM; SKUs validated against the cart.",
                )
                return result.model_copy(update={"response_message": reply})
            if reply:
                logger.warning(
                    "seller rephrase rejected (length or unknown SKU); using deterministic text"
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

    def _decision_summary(self, result: SellerDecision, buyer_message: str) -> str:
        cart = result.cart
        lines = [
            f"Buyer request: {buyer_message}",
            f"Action: {result.action}",
        ]
        if cart:
            for item in cart.items:
                lines.append(
                    f"- {item.sku} x{item.quantity} at {item.offered_price_paise} paise "
                    f"(unit {item.unit_price_paise} paise)"
                )
            lines.append(f"Cart total: {cart.total_paise} paise")
            if cart.upsell_rationale:
                lines.append(f"Upsell rationale: {cart.upsell_rationale}")
        if result.policy_decision:
            lines.append(f"Policy verdict: {result.policy_decision.verdict}")
            if result.policy_decision.reason_code:
                lines.append(f"Policy reason: {result.policy_decision.reason_code}")
            if result.policy_decision.reasoning_summary:
                lines.append(f"Policy reasoning: {result.policy_decision.reasoning_summary}")
        return "\n".join(lines)
