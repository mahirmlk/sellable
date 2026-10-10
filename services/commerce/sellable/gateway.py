"""Machine-facing gateway that presents one merchant to AI buyers."""

from __future__ import annotations

from agents.seller.agent import SellerAgent, SellerDecision, SellerRequest
from sellable.catalog import UnknownSkuError
from sellable.contracts import CatalogSearchRequest, Product
from sellable.core import CommerceCore
from sellable.delegations import AuthorizationDecision, OperationScope
from sellable.repositories import MerchantRepository


class DelegationDeniedError(ValueError):
    """A presented delegation is invalid for this action (HTTP 403)."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(f"Delegation denied: {reason_code}")
        self.reason_code = reason_code


class DelegationHoldError(ValueError):
    """A presented delegation needs customer/human approval first (HTTP 409)."""

    def __init__(self, outcome: str, reason_code: str) -> None:
        super().__init__(f"Delegation held: {outcome} ({reason_code})")
        self.outcome = outcome
        self.reason_code = reason_code


def enforce_delegation(
    commerce: CommerceCore,
    *,
    delegation_id: str | None,
    scope: OperationScope,
    amount_paise: int | None = None,
    trace_id: str | None = None,
    route: str = "",
) -> AuthorizationDecision | None:
    """Resolve an optional delegation header at the gateway (target §14).

    No header → None (legacy callers flow unchanged). Presented delegations
    are resolved through the authorization service with full ledger
    attribution: DENY raises (403), REQUIRE_* raises a hold (409), ALLOW
    returns the decision. Amount binding stays at the commerce layer, which
    re-resolves with the exact totals.
    """
    from sellable.delegations import AuthorizationOutcome

    if not delegation_id:
        return None
    decision = commerce.authorization_service.authorize(
        delegation_id=delegation_id,
        scope=scope,
        merchant_id=commerce.merchant_scope,
        amount_paise=amount_paise,
    )
    if trace_id is not None:
        commerce.log_gateway_authorization(
            trace_id=trace_id, decision=decision, route=route or scope.value
        )
    if decision.outcome is AuthorizationOutcome.DENY:
        raise DelegationDeniedError(decision.reason_code)
    if decision.outcome is not AuthorizationOutcome.ALLOW:
        raise DelegationHoldError(decision.outcome.value, decision.reason_code)
    return decision


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
            "delegation": {
                "header": "X-Delegation-Id",
                "required": False,
                "note": (
                    "Customer delegation is optional on read/quote routes and "
                    "enforced when presented; order and consent routes bind "
                    "it to exact totals. Revoked or expired delegations are "
                    "rejected."
                ),
            },
            "payment": {
                "provider": "razorpay",
                "mode": "test",
                "settlement_authority": "signed_webhook",
            },
            "api_versions": ["v1"],
            "versioning": {
                "note": "Every route is served unversioned and under /v1/* identically.",
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
