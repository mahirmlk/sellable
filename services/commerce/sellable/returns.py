"""Post-purchase return/exchange/refund-request seed (target §26, §38).

Full case management (messages, agent escalation, human handoff) arrives
with the Customer Service Agent in Phase 4; this module owns the
deterministic state core: return gating on settled orders, merchant
approval, exchange linkage with stock checks, and merchant-gated refund
asks that authorize (but do not themselves execute) provider refunds.
"""

from __future__ import annotations

from sellable.catalog import CatalogService
from sellable.contracts import (
    CartLine,
    ExchangeRequest,
    ExchangeStatus,
    Order,
    OrderStatus,
    RefundRequest,
    RefundRequestStatus,
    ReturnRequest,
    ReturnStatus,
    utc_now,
)


class ReturnError(ValueError):
    """The return/exchange/refund ask was refused."""


class ReturnNotFoundError(ReturnError, LookupError):
    """No such case for this merchant (foreign ids stay invisible)."""


_SETTLED_ORDER_STATUSES = frozenset({OrderStatus.PAID, OrderStatus.FULFILLED})


class ReturnService:
    def __init__(
        self,
        catalog: CatalogService,
        return_repo: object,
        order_repo: object,
        fulfillment_repo: object | None = None,
    ) -> None:
        self._catalog = catalog
        self._cases = return_repo
        self._orders = order_repo
        self._fulfillments = fulfillment_repo

    # ------------------------------------------------------------------
    # Returns
    # ------------------------------------------------------------------

    def get_return(self, return_id: str, merchant_id: str) -> ReturnRequest:
        case = self._cases.get_return(return_id, merchant_id)
        if case is None:
            raise ReturnNotFoundError(f"Unknown return: {return_id}")
        return case

    def get_refund_request(self, refund_request_id: str, merchant_id: str) -> RefundRequest:
        """Read one refund ask (CS refund.get)."""
        ask = self._cases.get_refund_request(refund_request_id, merchant_id)
        if ask is None:
            raise ReturnNotFoundError(f"Unknown refund request: {refund_request_id}")
        return ask

    def request_return(
        self,
        order_id: str,
        merchant_id: str,
        *,
        items: list[CartLine],
        reason: str,
        customer_id: str | None = None,
    ) -> ReturnRequest:
        order = self._settled_order(order_id, merchant_id)
        if not items:
            raise ReturnError("return must name at least one item")
        case = ReturnRequest(
            merchant_id=merchant_id,
            order_id=order.order_id,
            customer_id=customer_id,
            items=items,
            reason=reason,
        )
        self._cases.save_return(case)
        return case

    def approve_return(self, return_id: str, merchant_id: str) -> ReturnRequest:
        case = self._require_status(return_id, merchant_id, {ReturnStatus.REQUESTED})
        approved = self._update_return(case, ReturnStatus.APPROVED)
        self._fulfillment_best_effort(
            approved.order_id, merchant_id, action="return_requested"
        )
        return approved

    def reject_return(self, return_id: str, merchant_id: str) -> ReturnRequest:
        case = self._require_status(return_id, merchant_id, {ReturnStatus.REQUESTED})
        return self._update_return(case, ReturnStatus.REJECTED)

    def receive_return(self, return_id: str, merchant_id: str) -> ReturnRequest:
        case = self._require_status(return_id, merchant_id, {ReturnStatus.APPROVED})
        return self._update_return(case, ReturnStatus.RECEIVED)

    def complete_return(self, return_id: str, merchant_id: str) -> ReturnRequest:
        case = self._require_status(return_id, merchant_id, {ReturnStatus.RECEIVED})
        completed = self._update_return(case, ReturnStatus.COMPLETED)
        self._fulfillment_best_effort(
            completed.order_id, merchant_id, action="returned"
        )
        return completed

    # ------------------------------------------------------------------
    # Exchanges
    # ------------------------------------------------------------------

    def request_exchange(
        self,
        return_id: str,
        merchant_id: str,
        replacement_sku: str,
        replacement_quantity: int,
    ) -> ExchangeRequest:
        case = self._require_status(return_id, merchant_id, {ReturnStatus.APPROVED})
        product = self._catalog.get(replacement_sku)
        if replacement_quantity > product.stock:
            raise ReturnError(f"insufficient stock for {replacement_sku}")
        exchange = ExchangeRequest(
            merchant_id=merchant_id,
            return_id=case.return_id,
            replacement_sku=replacement_sku,
            replacement_quantity=replacement_quantity,
        )
        self._cases.save_exchange(exchange)
        return exchange

    def approve_exchange(self, exchange_id: str, merchant_id: str) -> ExchangeRequest:
        exchange = self._get_exchange(exchange_id, merchant_id)
        if exchange.status is not ExchangeStatus.REQUESTED:
            raise ReturnError(f"exchange is {exchange.status.value}")
        return self._update_exchange(exchange, ExchangeStatus.APPROVED)

    def reject_exchange(self, exchange_id: str, merchant_id: str) -> ExchangeRequest:
        exchange = self._get_exchange(exchange_id, merchant_id)
        if exchange.status is not ExchangeStatus.REQUESTED:
            raise ReturnError(f"exchange is {exchange.status.value}")
        return self._update_exchange(exchange, ExchangeStatus.REJECTED)

    def fulfill_exchange(self, exchange_id: str, merchant_id: str) -> ExchangeRequest:
        exchange = self._get_exchange(exchange_id, merchant_id)
        if exchange.status is not ExchangeStatus.APPROVED:
            raise ReturnError(f"exchange is {exchange.status.value}")
        return self._update_exchange(exchange, ExchangeStatus.FULFILLED)

    # ------------------------------------------------------------------
    # Refund asks (gate provider execution; Phase 4 executes)
    # ------------------------------------------------------------------

    def request_refund(
        self,
        order_id: str,
        merchant_id: str,
        amount_paise: int,
        reason: str,
        *,
        return_id: str | None = None,
    ) -> RefundRequest:
        order = self._settled_order(order_id, merchant_id)
        if amount_paise <= 0 or amount_paise > order.amount_paise:
            raise ReturnError("refund amount must be within the order total")
        if return_id is not None:
            self.get_return(return_id, merchant_id)
        ask = RefundRequest(
            merchant_id=merchant_id,
            order_id=order.order_id,
            return_id=return_id,
            amount_paise=amount_paise,
            reason=reason,
        )
        self._cases.save_refund_request(ask)
        return ask

    def decide_refund(
        self, refund_request_id: str, merchant_id: str, *, approve: bool, decided_by: str
    ) -> RefundRequest:
        ask = self._cases.get_refund_request(refund_request_id, merchant_id)
        if ask is None:
            raise ReturnNotFoundError(f"Unknown refund request: {refund_request_id}")
        if ask.status is not RefundRequestStatus.PENDING:
            raise ReturnError(f"refund request is {ask.status.value}")
        updated = ask.model_copy(
            update={
                "status": RefundRequestStatus.APPROVED
                if approve
                else RefundRequestStatus.DENIED,
                "decided_by": decided_by,
                "updated_at": utc_now(),
            }
        )
        self._cases.save_refund_request(updated)
        return updated

    def settle_refund(
        self, refund_request_id: str, merchant_id: str, *, provider_ref: str
    ) -> RefundRequest:
        """Record provider settlement (called after the refund rail settles)."""
        ask = self._cases.get_refund_request(refund_request_id, merchant_id)
        if ask is None:
            raise ReturnNotFoundError(f"Unknown refund request: {refund_request_id}")
        if ask.status is not RefundRequestStatus.APPROVED:
            raise ReturnError("only approved refund requests can settle")
        updated = ask.model_copy(
            update={
                "status": RefundRequestStatus.SETTLED,
                "provider_ref": provider_ref,
                "updated_at": utc_now(),
            }
        )
        self._cases.save_refund_request(updated)
        return updated

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _settled_order(self, order_id: str, merchant_id: str) -> Order:
        order = self._orders.get(order_id)
        if order is None or order.merchant_id != merchant_id:
            raise ReturnNotFoundError(f"Unknown order: {order_id}")
        if order.status not in _SETTLED_ORDER_STATUSES:
            raise ReturnError(
                f"returns require a settled order, found {order.status.value}"
            )
        return order

    def _require_status(
        self, return_id: str, merchant_id: str, allowed: set[ReturnStatus]
    ) -> ReturnRequest:
        case = self.get_return(return_id, merchant_id)
        if case.status not in allowed:
            raise ReturnError(f"return is {case.status.value}")
        return case

    def _update_return(self, case: ReturnRequest, status: ReturnStatus) -> ReturnRequest:
        updated = case.model_copy(update={"status": status, "updated_at": utc_now()})
        self._cases.save_return(updated)
        return updated

    def _get_exchange(self, exchange_id: str, merchant_id: str) -> ExchangeRequest:
        exchange = self._cases.get_exchange(exchange_id, merchant_id)
        if exchange is None:
            raise ReturnNotFoundError(f"Unknown exchange: {exchange_id}")
        return exchange

    def _update_exchange(
        self, exchange: ExchangeRequest, status: ExchangeStatus
    ) -> ExchangeRequest:
        updated = exchange.model_copy(update={"status": status, "updated_at": utc_now()})
        self._cases.save_exchange(updated)
        return updated

    def _fulfillment_best_effort(
        self, order_id: str, merchant_id: str, *, action: str
    ) -> None:
        """Mirror return progress onto fulfillment when one exists. Never
        breaks the return flow — fulfillment may legitimately be absent."""
        if self._fulfillments is None:  # pragma: no cover — wired in production
            return
        try:
            from sellable.shipping import FulfillmentService

            fulfillment = self._fulfillments.for_order(order_id, merchant_id)
            if fulfillment is None:
                return
            service = FulfillmentService(self._fulfillments)
            if action == "return_requested":
                service.mark_return_requested(fulfillment.fulfillment_id, merchant_id)
            elif action == "returned":
                service.mark_returned(fulfillment.fulfillment_id, merchant_id)
        except Exception:  # noqa: BLE001 — returns own their state
            pass
