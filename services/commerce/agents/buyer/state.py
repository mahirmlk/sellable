"""Explicit buyer-agent state with financial guardrails as first-class fields.

This matches §9 of WORKFLOW.md: critical budget/category/round constraints are
explicit fields rather than being buried in free-form chat messages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sellable.contracts import Product


@dataclass(slots=True)
class BuyerState:
    """Structured buyer state for one purchase mission."""

    trace_id: str
    buyer_agent_id: str
    budget_ceiling_paise: int
    allowed_categories: list[str]
    mission: str
    purpose: str
    merchant_id: str | None = None
    discovered_products: list[Product] = field(default_factory=list)
    selected_items: list[dict[str, object]] = field(default_factory=list)
    quote_id: str | None = None
    negotiation_round: int = 0
    max_negotiation_rounds: int = 5
    upsell_offered: bool = False
    upsell_accepted: bool = False
    consent_id: str | None = None
    payment_id: str | None = None
    order_id: str | None = None
    status: str = "DISCOVER"
