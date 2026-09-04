"""Buyer agent tools for discovery, research, quote requests, ordering, and consent."""

from __future__ import annotations

from sellable.catalog import UnknownSkuError
from sellable.contracts import (
    CatalogSearchRequest,
    Consent,
    IntentMandate,
    LedgerActor,
    LedgerEvent,
    Order,
    PolicyVerdict,
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
        self,
        *,
        message: str,
        allowed_categories: list[str],
        trace_id: str,
        requested_sku: str | None = None,
    ) -> list[str]:
        # A requested SKU bypasses free-text search but is still verified
        # against the authoritative catalog — only real SKUs are returned.
        if requested_sku:
            try:
                product = self.gateway.get_catalog_item(requested_sku)
            except UnknownSkuError:
                self._record(
                    trace_id=trace_id,
                    action="buyer.catalog_researched",
                    output={"requested_sku": requested_sku, "matching_skus": []},
                    explanation="The requested SKU does not exist in the merchant catalog.",
                )
                return []
            self._record(
                trace_id=trace_id,
                action="buyer.catalog_researched",
                output={"requested_sku": requested_sku, "matching_skus": [product.sku]},
                explanation="Verified the requested SKU in the authoritative merchant catalog.",
            )
            return [product.sku]
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
        requested_sku: str | None = None,
        quantity: int = 1,
        buyer_offer_paise: int | None = None,
    ) -> object:
        from agents.seller.agent import SellerRequest

        decision = self.gateway.create_quote(
            SellerRequest(
                message=message,
                intent=intent,
                requested_sku=requested_sku,
                quantity=quantity,
                buyer_offer_paise=buyer_offer_paise,
                request_upsell=request_upsell,
            ),
            trace_id=trace_id,
        )
        return decision

    def create_order(
        self, *, decision: object, intent: IntentMandate, trace_id: str
    ) -> Order:
        """Create the authoritative order for a policy-valid cart.

        ALLOW carts proceed to consent directly. NEEDS_HUMAN_APPROVAL carts
        are still policy-valid: the order is created in the held state
        (requires_approval=True, no consent possible) so the merchant's
        Approvals queue has the real order to act on, and the flow can
        continue later from that exact order without any duplicate.
        """
        cart = decision.cart
        if cart is None:
            raise ValueError("Cannot create an order without a candidate cart")
        verdict = decision.policy_decision.verdict if decision.policy_decision else None
        if verdict is None or verdict is PolicyVerdict.DENY:
            raise ValueError(
                f"Buyer tool refuses to order a policy-rejected cart (verdict={verdict})"
            )
        held = verdict is PolicyVerdict.NEEDS_HUMAN_APPROVAL
        idempotency_key = f"idem_buyer_{trace_id}"
        order = self.gateway.commerce.create_order(
            cart=cart,
            intent=intent,
            trace_id=trace_id,
            idempotency_key=idempotency_key,
        )
        self._record(
            trace_id=trace_id,
            action="buyer.order_held" if held else "buyer.order_requested",
            output={
                "order_id": order.order_id,
                "amount_paise": order.amount_paise,
                "requires_approval": order.requires_approval,
            },
            explanation=(
                "Requested an order in the held state: above the human-approval "
                "threshold it waits for explicit merchant approval before consent."
                if held
                else (
                    "Requested an order for the policy-valid cart using a deterministic "
                    "idempotency key derived from the trace."
                )
            ),
        )
        return order

    def request_consent(self, *, order_id: str, trace_id: str) -> Consent:
        order = self.gateway.commerce.get_order(order_id)
        if order.trace_id != trace_id:
            raise ValueError(
                "Consent request trace does not match the order trace; "
                "refusing to fork the audit trail"
            )
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
                merchant_id=self.gateway.commerce.merchant_scope,
                actor=LedgerActor.BUYER_AGENT,
                action=action,
                output=output,
                reasoning_summary=explanation,
            )
        )
