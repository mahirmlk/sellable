"""Buyer agent tools for discovery, research, quote requests, ordering, and consent."""

from __future__ import annotations

from sellable.contracts import (
    CatalogSearchRequest,
    Consent,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    Order,
)
from sellable.gateway import AgentGateway


class BuyerTools:
    """Deterministic tools used by the buyer agent."""

    def __init__(self, gateway: AgentGateway) -> None:
        self.gateway = gateway

    def discover_merchant(self, *, trace_id: str) -> dict[str, object]:
        manifest = self.gateway.discovery_manifest()
        self._record(
            trace_id=trace_id,
            action="buyer.discovered_merchant",
            output={"merchant_id": manifest["merchant_id"]},
            explanation="Read the merchant's machine-readable capability manifest.",
        )
        return manifest

    def research_catalog(
        self, *, message: str, allowed_categories: list[str], trace_id: str
    ) -> list[str]:
        products = self.gateway.search_catalog(
            CatalogSearchRequest(query=message, categories=allowed_categories)
        )
        skus = [product.sku for product in products]
        self._record(
            trace_id=trace_id,
            action="buyer.catalog_researched",
            output={"matching_skus": skus},
            explanation="Searched the merchant catalog using the buyer mission and allowed categories.",
        )
        return skus

    def request_quote(
        self,
        *,
        message: str,
        intent: IntentMandate,
        request_upsell: bool,
        trace_id: str,
    ) -> object:
        from agents.seller.agent import SellerRequest

        decision = self.gateway.create_quote(
            SellerRequest(
                message=message,
                intent=intent,
                request_upsell=request_upsell,
            ),
            trace_id=trace_id,
        )
        return decision

    def create_order(
        self, *, decision: object, intent: IntentMandate, trace_id: str
    ) -> Order:
        """Create the authoritative order only for a policy-ALLOW cart."""
        cart = decision.cart
        if cart is None:
            raise ValueError("Cannot create an order without a candidate cart")
        idempotency_key = f"idem_buyer_{trace_id}"
        order = self.gateway.commerce.create_order(
            cart=cart,
            intent=intent,
            trace_id=trace_id,
            idempotency_key=idempotency_key,
        )
        self._record(
            trace_id=trace_id,
            action="buyer.order_requested",
            output={"order_id": order.order_id, "amount_paise": order.amount_paise},
            explanation=(
                "Requested an order for the policy-valid cart using a deterministic "
                "idempotency key derived from the trace."
            ),
        )
        return order

    def request_consent(self, *, order_id: str, trace_id: str) -> Consent:
        consent = self.gateway.commerce.issue_consent(order_id)
        self._record(
            trace_id=trace_id,
            action="buyer.consent_requested",
            output={"consent_id": consent.consent_id, "order_id": order_id},
            explanation="Requested single-use, transaction-bound consent for the order.",
        )
        return consent

    def _record(
        self,
        *,
        trace_id: str,
        action: str,
        output: dict[str, object],
        explanation: str,
    ) -> None:
        self.gateway.commerce.ledger.append(
            LedgerEvent(
                trace_id=trace_id,
                actor=LedgerActor.BUYER_AGENT,
                action=action,
                output=output,
                reasoning_summary=explanation,
            )
        )
