"""Buyer-agent LangGraph layout.

The purchasing lifecycle is declared here and is the single source of the
transition topology::

    DISCOVER -> RESEARCH -> REQUEST_QUOTE -> EVALUATE
       (READY_FOR_CONSENT) -> CREATE_ORDER -> REQUEST_CONSENT -> END
       (NEEDS_HUMAN_APPROVAL) -> CREATE_ORDER (held) -> END  (awaiting merchant)
       (otherwise)                                          -> END
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

def build_buyer_graph(agent: Any, state_schema: Any) -> Any:
    """Wire the buyer agent's node methods into a LangGraph state machine."""
    graph = StateGraph(state_schema)
    graph.add_node("discover", agent._discover)
    graph.add_node("research", agent._research)
    graph.add_node("request_quote", agent._request_quote)
    graph.add_node("evaluate", agent._evaluate)
    graph.add_node("create_order", agent._create_order)
    graph.add_node("request_consent", agent._request_consent)

    graph.add_edge(START, "discover")
    graph.add_edge("discover", "research")
    graph.add_edge("research", "request_quote")
    graph.add_edge("request_quote", "evaluate")
    graph.add_conditional_edges(
        "evaluate",
        agent._route_after_evaluate,
        {"order": "create_order", "end": END},
    )
    graph.add_conditional_edges(
        "create_order",
        agent._route_after_order,
        {"consent": "request_consent", "end": END},
    )
    graph.add_edge("request_consent", END)
    return graph.compile()