"""Customer Service Agent (§7.3): authenticated post-purchase support.

State machine: INTAKE → AUTHENTICATE → LOAD_CONTEXT → CLASSIFY → EXECUTE
→ CONFIRM → CLOSE, with escalation out of EXECUTE when authority,
identity, or policy requires a human. The agent requests — never
executes — refunds, exchanges, and returns; merchant-gated services and
human escalation own every consequential outcome.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import NotRequired, TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from pydantic import Field

from agents.customer_service.tools import (
    AuthResult,
    CustomerAuthTier,
    CustomerServiceTools,
)
from agents.runtime import guardrails as guards
from agents.runtime.guardrails import GuardrailContext, GuardrailRecorder
from agents.runtime.model_gateway import ModelGateway
from agents.runtime.recorder import AgentRunRecorder
from agents.runtime.versions import (
    CUSTOMER_SERVICE_AGENT_ID,
    AgentVersion,
    VersionRegistry,
    policy_bundle_version,
    seed_registry,
)
from sellable.contracts import (
    Order,
    StrictModel,
    SupportCasePriority,
    SupportCategory,
)
from sellable.core import CommerceCore


logger = logging.getLogger("sellable.agents.customer_service")

GRAPH_RECURSION_LIMIT = 16


class CSActionHint(StrEnum):
    ORDER_STATUS = "ORDER_STATUS"
    SHIPPING_STATUS = "SHIPPING_STATUS"
    REQUEST_RETURN = "REQUEST_RETURN"
    REQUEST_EXCHANGE = "REQUEST_EXCHANGE"
    REQUEST_REFUND = "REQUEST_REFUND"
    POLICY_QUESTION = "POLICY_QUESTION"
    ESCALATE = "ESCALATE"
    GENERAL = "GENERAL"


class CSAction(StrEnum):
    ANSWERED = "ANSWERED"
    RETURN_CREATED = "RETURN_CREATED"
    EXCHANGE_CREATED = "EXCHANGE_CREATED"
    REFUND_REQUESTED = "REFUND_REQUESTED"
    CASE_ESCALATED = "CASE_ESCALATED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    NEEDS_INFO = "NEEDS_INFO"
    DENIED = "DENIED"


class CSStage(StrEnum):
    INTAKE = "INTAKE"
    AUTHENTICATE = "AUTHENTICATE"
    LOAD_CONTEXT = "LOAD_CONTEXT"
    CLASSIFY = "CLASSIFY"
    EXECUTE = "EXECUTE"
    CONFIRM = "CONFIRM"
    CLOSE = "CLOSE"


class CSRequest(StrictModel):
    message: str = Field(min_length=1, max_length=1_000)
    customer_id: str | None = Field(default=None, max_length=128)
    order_id: str | None = Field(default=None, max_length=64)
    return_id: str | None = Field(default=None, max_length=64)
    action_hint: CSActionHint | None = None
    items: list[dict[str, object]] = Field(default_factory=list)
    replacement_sku: str | None = Field(default=None, max_length=64)
    replacement_quantity: int = Field(default=1, ge=1, le=100)
    amount_paise: int | None = Field(default=None, gt=0)
    reason: str | None = Field(default=None, max_length=500)


class CSDecision(StrictModel):
    trace_id: str
    action: CSAction
    response_message: str = Field(min_length=1, max_length=1_000)
    case_id: str | None = None
    order_status: str | None = None
    tool_calls: list[str] = Field(default_factory=list)
    stage: CSStage = CSStage.CLOSE
    agent_id: str = ""
    agent_version: str = ""
    prompt_version: str = ""
    guardrail_blocks: list[str] = Field(default_factory=list)


class CSGraphState(TypedDict):
    request: CSRequest
    trace_id: str
    auth_tier: NotRequired[str]
    hint: NotRequired[str]
    category: NotRequired[str]
    order: NotRequired[dict[str, object] | None]
    case_id: NotRequired[str | None]
    action: NotRequired[str]
    message: NotRequired[str]
    tool_calls: NotRequired[list[str]]
    result: NotRequired[CSDecision]


# Keyword fallback when the caller supplies no explicit action hint.
_HINT_KEYWORDS: tuple[tuple[CSActionHint, tuple[str, ...]], ...] = (
    (CSActionHint.SHIPPING_STATUS, ("ship", "deliver", "track", "arrive", "late", "courier")),
    (CSActionHint.REQUEST_RETURN, ("return", "send back")),
    (CSActionHint.REQUEST_EXCHANGE, ("exchange", "replace", "swap", "wrong size")),
    (CSActionHint.REQUEST_REFUND, ("refund", "money back", "charged twice", "chargeback")),
    (CSActionHint.ORDER_STATUS, ("order", "status", "receipt", "paid", "payment")),
    (CSActionHint.POLICY_QUESTION, ("policy", "rule", "allowed", "warranty")),
    (CSActionHint.ESCALATE, ("human", "agent please", "manager", "complaint", "escalate")),
)

_HINT_CATEGORY = {
    CSActionHint.ORDER_STATUS: SupportCategory.ORDER_STATUS,
    CSActionHint.SHIPPING_STATUS: SupportCategory.SHIPPING,
    CSActionHint.REQUEST_RETURN: SupportCategory.RETURN,
    CSActionHint.REQUEST_EXCHANGE: SupportCategory.EXCHANGE,
    CSActionHint.REQUEST_REFUND: SupportCategory.REFUND,
    CSActionHint.POLICY_QUESTION: SupportCategory.PRODUCT_QUESTION,
    CSActionHint.ESCALATE: SupportCategory.OTHER,
    CSActionHint.GENERAL: SupportCategory.OTHER,
}


class CustomerServiceAgent:
    def __init__(
        self,
        commerce: CommerceCore,
        llm=None,
        *,
        versions: AgentVersion | None = None,
        registry: VersionRegistry | None = None,
        guardrails_enabled: bool = True,
        recorder: AgentRunRecorder | None = None,
        model_gateway: ModelGateway | None = None,
        max_direct_refund_paise: int | None = None,
    ) -> None:
        self.commerce = commerce
        self.llm = llm
        if versions is None:
            registry = registry or seed_registry(VersionRegistry(), commerce.policy)
            versions = registry.require(CUSTOMER_SERVICE_AGENT_ID)
        self.versions = versions
        self.guardrails_enabled = guardrails_enabled
        self.recorder = recorder or AgentRunRecorder(
            merchant_id=commerce.merchant_scope, agent_id=versions.agent_id
        )
        self.recorder.merchant_id = commerce.merchant_scope
        self.gateway = model_gateway
        if self.gateway is None and llm is not None:
            self.gateway = ModelGateway(llm, recorder=self.recorder.record_model)
        self.tools = CustomerServiceTools(commerce, recorder=self.recorder)
        self.max_direct_refund_paise = (
            max_direct_refund_paise
            if max_direct_refund_paise is not None
            else commerce.policy.human_approval_threshold_paise
        )
        self._checkpointer = MemorySaver()
        self._graph = self._build_graph()

    # ------------------------------------------------------------------
    # Entry point.
    # ------------------------------------------------------------------

    def respond(self, request: CSRequest, *, trace_id: str | None = None) -> CSDecision:
        resolved_trace = trace_id or f"trc_{uuid4().hex}"
        guard_recorder = GuardrailRecorder()
        if self.guardrails_enabled:
            blocked, results = guards.run_guards(
                GuardrailContext(
                    agent_id=self.versions.agent_id,
                    agent_type="SELLABLE_INTERNAL_AGENT",
                    merchant_id=self.commerce.merchant_scope,
                    customer_id=request.customer_id,
                    session_id=resolved_trace,
                    trace_id=resolved_trace,
                    input_text=request.message,
                    allowed_tools=self._tool_allowlist(),
                )
            )
            guard_recorder.extend(results)
            if blocked:
                return self._denied_by_guardrail(request, resolved_trace, guard_recorder)
        self.recorder.open_run(
            trace_id=resolved_trace,
            versions=self.versions,
            model_version=self.gateway.model if self.gateway else "",
            customer_id=request.customer_id,
        )
        try:
            result = self._graph.invoke(
                {"request": request, "trace_id": resolved_trace},
                config={
                    "recursion_limit": GRAPH_RECURSION_LIMIT,
                    "configurable": {"thread_id": resolved_trace},
                },
            )["result"]
        except Exception as error:  # noqa: BLE001 — agents degrade safely
            logger.warning("customer-service run failed safely: %s", error)
            result = CSDecision(
                trace_id=resolved_trace,
                action=CSAction.DENIED,
                response_message="I could not complete that request safely. A support case was not opened.",
                tool_calls=[],
                stage=CSStage.CLOSE,
                guardrail_blocks=["RUN_FAILED_SAFE"],
            )
            self.recorder.close_run(status="ERROR", outcome="DENIED", error=str(error)[:300])
            return self._stamped(result)
        result = result.model_copy(
            update={"guardrail_blocks": guard_recorder.blocks}
        )
        self.recorder.close_run(status="COMPLETED", outcome=result.action.value)
        self._publish_run_completed(result)
        return self._stamped(result)

    def _stamped(self, decision: CSDecision) -> CSDecision:
        return decision.model_copy(
            update={
                "agent_id": self.versions.agent_id,
                "agent_version": self.versions.agent_version,
                "prompt_version": self.versions.prompt_version,
            }
        )

    def _publish_run_completed(self, result: CSDecision) -> None:
        """Fan agent telemetry into the event bus (§29 + §34.2).
        Best-effort — the ledger run rows are already durable."""
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

    @staticmethod
    def _tool_allowlist() -> tuple[str, ...]:
        # Note: customer.orders is intentionally absent — orders carry no
        # customer attribution yet (customers table follow-up); the agent
        # works from explicit order ids under authenticated context.
        return (
            "customer.authenticate_context",
            "customer.profile",
            "customer.permissions",
            "order.get",
            "order.timeline",
            "shipping.track",
            "shipping.estimate",
            "return.create",
            "return.get",
            "exchange.create",
            "refund.request",
            "refund.get",
            "policy.lookup",
            "support.case.create",
            "support.case.update",
            "support.case.escalate",
        )

    def _denied_by_guardrail(
        self, request: CSRequest, trace_id: str, guard_recorder: GuardrailRecorder
    ) -> CSDecision:
        self.recorder.open_run(trace_id=trace_id, versions=self.versions)
        self.recorder.close_run(status="BLOCKED", outcome="DENIED")
        return CSDecision(
            trace_id=trace_id,
            action=CSAction.DENIED,
            response_message="That request cannot be handled safely.",
            tool_calls=[],
            stage=CSStage.INTAKE,
            agent_id=self.versions.agent_id,
            agent_version=self.versions.agent_version,
            prompt_version=self.versions.prompt_version,
            guardrail_blocks=guard_recorder.blocks,
        )

    # ------------------------------------------------------------------
    # Staged graph (§7.3).
    # ------------------------------------------------------------------

    def _build_graph(self):
        graph = StateGraph(CSGraphState)
        graph.add_node("intake", self._intake)
        graph.add_node("authenticate", self._authenticate)
        graph.add_node("load_context", self._load_context)
        graph.add_node("classify", self._classify)
        graph.add_node("execute", self._execute)
        graph.add_node("confirm", self._confirm)
        graph.add_node("close", self._close)
        graph.add_edge(START, "intake")
        graph.add_edge("intake", "authenticate")
        graph.add_edge("authenticate", "load_context")
        graph.add_edge("load_context", "classify")
        graph.add_edge("classify", "execute")
        graph.add_edge("execute", "confirm")
        graph.add_edge("confirm", "close")
        graph.add_edge("close", END)
        return graph.compile(checkpointer=self._checkpointer)

    def _intake(self, state: CSGraphState) -> dict[str, object]:
        return {"tool_calls": []}

    def _authenticate(self, state: CSGraphState) -> dict[str, object]:
        request = state["request"]
        auth = self.tools.customer_authenticate(
            customer_id=request.customer_id, trace_id=state["trace_id"]
        )
        return {
            "auth_tier": auth.tier.value,
            "tool_calls": [*state["tool_calls"], "customer.authenticate_context"],
        }

    def _load_context(self, state: CSGraphState) -> dict[str, object]:
        request = state["request"]
        if not request.order_id:
            return {"order": None}
        auth = AuthResult(request.customer_id, CustomerAuthTier(state["auth_tier"]), "graph")
        try:
            order = self.tools.order_get(
                order_id=request.order_id, auth=auth, trace_id=state["trace_id"]
            )
        except PermissionError:
            return {"order": None}
        if order is None:
            return {"order": None}
        return {
            "order": {"order_id": order.order_id, "status": order.status.value,
                      "amount_paise": order.amount_paise},
            "tool_calls": [*state["tool_calls"], "order.get"],
        }

    def _classify(self, state: CSGraphState) -> dict[str, object]:
        request = state["request"]
        hint = request.action_hint
        if hint is None:
            hint = self._classify_message(request.message)
        return {"hint": hint.value, "category": _HINT_CATEGORY[hint].value}

    @staticmethod
    def _classify_message(message: str) -> CSActionHint:
        lowered = message.lower()
        for hint, keywords in _HINT_KEYWORDS:
            if any(keyword in lowered for keyword in keywords):
                return hint
        return CSActionHint.GENERAL

    def _execute(self, state: CSGraphState) -> dict[str, object]:
        request = state["request"]
        hint = CSActionHint(state["hint"])
        auth = AuthResult(
            request.customer_id, CustomerAuthTier(state["auth_tier"]), "graph"
        )
        trace_id = state["trace_id"]
        tool_calls = list(state["tool_calls"])
        try:
            if hint in (
                CSActionHint.ORDER_STATUS,
                CSActionHint.SHIPPING_STATUS,
                CSActionHint.POLICY_QUESTION,
                CSActionHint.GENERAL,
            ):
                return self._answer(state, auth, hint, tool_calls)
            if hint is CSActionHint.REQUEST_RETURN:
                return self._do_return(state, auth, tool_calls)
            if hint is CSActionHint.REQUEST_EXCHANGE:
                return self._do_exchange(state, auth, tool_calls)
            if hint is CSActionHint.REQUEST_REFUND:
                return self._do_refund(state, auth, tool_calls)
            return self._escalate(
                state, auth, tool_calls,
                classification="explicit_escalation",
                recommendation="Route to a human support specialist.",
            )
        except PermissionError as error:
            if "authenticated" in str(error):
                return {
                    "action": CSAction.AUTH_REQUIRED.value,
                    "message": (
                        "I need to verify your identity before I can help with "
                        "that. Please link your customer identity and try again."
                    ),
                    "tool_calls": tool_calls,
                }
            return {
                "action": CSAction.DENIED.value,
                "message": str(error)[:500],
                "tool_calls": tool_calls,
            }
        except Exception as error:  # noqa: BLE001 — domain errors become answers
            return {
                "action": CSAction.NEEDS_INFO.value,
                "message": f"I could not complete that: {error}"[:500],
                "tool_calls": tool_calls,
            }

    def _answer(
        self, state: CSGraphState, auth: AuthResult, hint: CSActionHint, tool_calls: list[str]
    ) -> dict[str, object]:
        request = state["request"]
        trace_id = state["trace_id"]
        if hint is CSActionHint.ORDER_STATUS:
            order = state.get("order")
            if order is None:
                if auth.tier is not CustomerAuthTier.AUTHENTICATED:
                    raise PermissionError("order.get requires an authenticated customer")
                return {
                    "action": CSAction.NEEDS_INFO.value,
                    "message": "I could not find that order. Please check the order id.",
                    "tool_calls": tool_calls,
                }
            timeline = self.tools.order_timeline(
                order_id=request.order_id or "", auth=auth, trace_id=trace_id
            )
            tool_calls.append("order.timeline")
            steps = "; ".join(e["action"] for e in timeline[-5:])
            return {
                "action": CSAction.ANSWERED.value,
                "message": (
                    f"Order {order['order_id']} is {order['status']}. "
                    f"Recent history: {steps or 'no events yet'}."
                )[:900],
                "tool_calls": tool_calls,
            }
        if hint is CSActionHint.SHIPPING_STATUS:
            if request.order_id is None:
                return {
                    "action": CSAction.NEEDS_INFO.value,
                    "message": "Please share the order id so I can track the shipment.",
                    "tool_calls": tool_calls,
                }
            tracked = self.tools.shipping_track(
                order_id=request.order_id, auth=auth, trace_id=trace_id
            )
            tool_calls.append("shipping.track")
            return {
                "action": CSAction.ANSWERED.value,
                "message": (
                    f"Shipment status: {tracked.get('status')}. "
                    f"Tracking: {tracked.get('tracking_reference') or 'not yet assigned'}."
                )[:900],
                "tool_calls": tool_calls,
            }
        if hint is CSActionHint.POLICY_QUESTION:
            info = self.tools.policy_lookup(topic=request.message[:120], trace_id=trace_id)
            tool_calls.append("policy.lookup")
            return {
                "action": CSAction.ANSWERED.value,
                "message": (
                    f"Merchant policy: up to {info['max_discount_percent']}% off, "
                    f"orders up to ₹{info['max_order_value_paise'] / 100:,.0f}, "
                    f"human review above ₹{info['human_approval_threshold_paise'] / 100:,.0f}."
                )[:900],
                "tool_calls": tool_calls,
            }
        return {
            "action": CSAction.ANSWERED.value,
            "message": (
                "Thanks for reaching out. Share your order id for order help, "
                "or describe a return, exchange, or refund request."
            ),
            "tool_calls": tool_calls,
        }

    def _do_return(
        self, state: CSGraphState, auth: AuthResult, tool_calls: list[str]
    ) -> dict[str, object]:
        request = state["request"]
        if not request.order_id or not request.items or not request.reason:
            return {
                "action": CSAction.NEEDS_INFO.value,
                "message": "To start a return I need the order id, the items, and the reason.",
                "tool_calls": tool_calls,
            }
        case = self.tools.return_create(
            order_id=request.order_id,
            items=request.items,
            reason=request.reason,
            auth=auth,
            trace_id=state["trace_id"],
        )
        tool_calls.append("return.create")
        return {
            "action": CSAction.RETURN_CREATED.value,
            "message": (
                f"Return {case.return_id} opened for order {request.order_id}. "
                "The merchant will review it next."
            ),
            "tool_calls": tool_calls,
        }

    def _do_exchange(
        self, state: CSGraphState, auth: AuthResult, tool_calls: list[str]
    ) -> dict[str, object]:
        request = state["request"]
        if not request.return_id or not request.replacement_sku:
            return {
                "action": CSAction.NEEDS_INFO.value,
                "message": "To request an exchange I need the return id and the replacement SKU.",
                "tool_calls": tool_calls,
            }
        try:
            exchange = self.tools.exchange_create(
                return_id=request.return_id,
                replacement_sku=request.replacement_sku,
                replacement_quantity=request.replacement_quantity,
                auth=auth,
                trace_id=state["trace_id"],
            )
        except Exception as error:  # noqa: BLE001 — unapproved returns escalate
            return self._escalate(
                state, auth, tool_calls,
                classification="exchange_blocked",
                recommendation=f"Review return {request.return_id} for exchange: {error}",
            )
        tool_calls.append("exchange.create")
        return {
            "action": CSAction.EXCHANGE_CREATED.value,
            "message": f"Exchange {exchange.exchange_id} requested for approval.",
            "tool_calls": tool_calls,
        }

    def _do_refund(
        self, state: CSGraphState, auth: AuthResult, tool_calls: list[str]
    ) -> dict[str, object]:
        request = state["request"]
        if not request.order_id or not request.amount_paise:
            return {
                "action": CSAction.NEEDS_INFO.value,
                "message": "To request a refund I need the order id and the amount.",
                "tool_calls": tool_calls,
            }
        if request.amount_paise > self.max_direct_refund_paise:
            return self._escalate(
                state, auth, tool_calls,
                classification="refund_over_authority",
                recommendation=(
                    f"Refund of {request.amount_paise} paise exceeds "
                    f"customer-service authority; human approval required."
                ),
            )
        ask = self.tools.refund_request(
            order_id=request.order_id,
            amount_paise=request.amount_paise,
            reason=request.reason or "customer request",
            auth=auth,
            trace_id=state["trace_id"],
            max_direct_refund_paise=self.max_direct_refund_paise,
        )
        tool_calls.append("refund.request")
        return {
            "action": CSAction.REFUND_REQUESTED.value,
            "message": (
                f"Refund request {ask.refund_request_id} opened for "
                f"{request.amount_paise} paise. The merchant approves it next."
            ),
            "tool_calls": tool_calls,
        }

    def _escalate(
        self, state: CSGraphState, auth: AuthResult, tool_calls: list[str],
        *, classification: str, recommendation: str,
    ) -> dict[str, object]:
        request = state["request"]
        trace_id = state["trace_id"]
        case = self.tools.case_create(
            summary=request.message[:300],
            trace_id=trace_id,
            customer_id=request.customer_id,
            order_id=request.order_id,
            category=SupportCategory(_HINT_CATEGORY[CSActionHint(state["hint"])]),
        )
        tool_calls.append("support.case.create")
        self.tools.case_escalate(
            case_id=case.case_id,
            trace_id=trace_id,
            customer_summary=request.message[:500],
            issue_classification=classification,
            recommended_next_action=recommendation,
            order_id=request.order_id,
        )
        tool_calls.append("support.case.escalate")
        _ = auth
        return {
            "action": CSAction.CASE_ESCALATED.value,
            "message": (
                f"I have escalated this to human support as case {case.case_id} "
                "with full context. They will follow up shortly."
            ),
            "case_id": case.case_id,
            "tool_calls": tool_calls,
        }

    def _confirm(self, state: CSGraphState) -> dict[str, object]:
        return {
            "message": state.get(
                "message",
                "Thanks — let me know if you need anything else.",
            )
        }

    def _close(self, state: CSGraphState) -> dict[str, object]:
        request = state["request"]
        trace_id = state["trace_id"]
        action = CSAction(state.get("action", CSAction.ANSWERED.value))
        case_id = state.get("case_id")
        order = state.get("order")
        # Every interaction leaves a managed case: answers resolve
        # immediately, mutations and escalations keep theirs.
        if case_id is None and action in (
            CSAction.ANSWERED, CSAction.NEEDS_INFO, CSAction.AUTH_REQUIRED,
        ):
            try:
                case = self.tools.case_create(
                    summary=request.message[:300],
                    trace_id=trace_id,
                    customer_id=request.customer_id,
                    order_id=request.order_id,
                    category=SupportCategory(_HINT_CATEGORY[CSActionHint(state["hint"])]),
                )
                case_id = case.case_id
                state = {**state, "tool_calls": [*state["tool_calls"], "support.case.create"]}
                try:
                    self.commerce.case_service.resolve(case_id, self.commerce.merchant_scope)
                except Exception:  # noqa: BLE001 — resolution is additive
                    pass
            except Exception:  # noqa: BLE001 — cases never break answers
                pass
        result = CSDecision(
            trace_id=trace_id,
            action=action,
            response_message=state.get("message", "")[:1000]
            or "Thanks — let me know if you need anything else.",
            case_id=case_id,
            order_status=(order or {}).get("status") if isinstance(order, dict) else None,
            tool_calls=state["tool_calls"],
            stage=CSStage.CLOSE,
        )
        self.tools._note_tool("support.case.close")
        return {"result": result}
