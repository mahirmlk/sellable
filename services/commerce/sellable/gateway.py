"""Machine-facing gateway that presents one merchant to AI buyers."""

from __future__ import annotations

from agents.seller.agent import SellerAgent, SellerDecision, SellerRequest
from sellable.catalog import UnknownSkuError
from sellable.contracts import CatalogSearchRequest, Product
from sellable.core import CommerceCore
from sellable.repositories import MerchantRepository


class AgentGateway:
    def __init__(self, commerce: CommerceCore, seller_agent: SellerAgent) -> None:
        self.commerce = commerce
        self.seller_agent = seller_agent

    @property
    def merchant_name(self) -> str:
        """Real merchant name from the merchants table; never fabricated."""
        name = MerchantRepository().name_of(self.commerce.policy.merchant_id)
        return name or self.commerce.policy.merchant_id

    def discovery_manifest(self) -> dict[str, object]:
        return {
            "name": self.merchant_name,
            "merchant_id": self.commerce.policy.merchant_id,
            "protocol_version": "0.1",
            "capabilities": [
                "catalog.search",
                "catalog.get",
                "quote.create",
                "quote.negotiate",
                "consent.request",
                "orders.create",
                "orders.status",
            ],
            "discovery": {
                "catalog": "/catalog.ai.json",
                "instructions": "/llms.txt",
            },
            "transaction_endpoints": {
                "catalog_search": "/agent/catalog.search",
                "catalog_get": "/agent/catalog.get",
                "quote_create": "/agent/quotes.create",
                "quote_negotiate": "/agent/quotes.negotiate",
                "payment": "/orders/{order_id}/payment",
            },
            "payment": {
                "provider": "razorpay",
                "mode": "test",
                "settlement_authority": "signed_webhook",
            },
        }

    def llms_instructions(self) -> str:
        return (
            "# SELLABLE Merchant\n\n"
            "Use the agent catalog endpoints to retrieve products. All prices are integer paise. "
            "Create only catalog-grounded candidate carts. A deterministic policy engine, "
            "transaction-bound consent, and signed Razorpay webhooks control payment.\n"
        )

    def catalog_document(self) -> dict[str, object]:
        return {
            "merchant_id": self.commerce.policy.merchant_id,
            "currency": self.commerce.policy.currency,
            "products": [product.model_dump(mode="json") for product in self.commerce.catalog.all()],
        }

    def search_catalog(self, request: CatalogSearchRequest) -> list[Product]:
        return self.commerce.catalog.search(request.query, set(request.categories))

    def get_catalog_item(self, sku: str) -> Product:
        return self.commerce.catalog.get(sku)

    def create_quote(self, request: SellerRequest, *, trace_id: str | None = None) -> SellerDecision:
        return self.seller_agent.respond(request, trace_id=trace_id)
