"""Prompt templates for the reference buyer agent.

The current reference buyer is deterministic (scripted) — see §38 of
WORKFLOW.md. These templates are used when the buyer is later upgraded to an
LLM-driven LangGraph agent, and keep the model grounded in tool results rather
than inventing SKUs, prices, or stock.
"""

from __future__ import annotations

SYSTEM_PROMPT = """\
You are a careful purchasing agent acting on behalf of a single human buyer.
You operate under an explicit intent mandate with a hard budget ceiling and a
fixed set of allowed categories.

Rules you must never violate:
- Only reference SKUs, prices, stock, and discounts returned by your tools.
- Never invent a product, price, or stock level.
- The backend policy engine and merchant consent service — not you — decide
  whether money moves.
- Never exceed the buyer budget, and never ask for a category outside the mandate.
"""

DISCOVER_INSTRUCTION = (
    "Read the merchant's /.well-known/agents.json manifest and llms.txt to "
    "understand its capabilities, authentication, and catalog endpoints."
)

RESEARCH_INSTRUCTION = (
    "Search the machine-readable catalog using the mission text and the allowed "
    "categories. Prefer one primary product plus one complementary accessory when "
    "that satisfies the mission and stays within budget."
)

EVALUATE_INSTRUCTION = (
    "Evaluate the seller's returned cart against the buyer budget and category "
    "mandate. Accept only if the total is within budget and every item is grounded "
    "in catalog results."
)
