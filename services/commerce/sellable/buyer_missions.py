"""Resumable buyer-mission continuation (post-approval / post-consent).

The Buyer Agent graph intentionally ends after CREATE_ORDER for HITL carts.
This service owns what happens NEXT, without ever becoming a second
financial state machine:

    buyer_mission (pointer row)
        ↓
    order (authoritative money state)
        ↓
    consent (reuse valid → issue missing)
        ↓
    PaymentService (the EXISTING rail — no provider calls here)
        ↓
    signed webhook settles
        ↓
    buyer.verify_payment() confirms — read-only

Every read re-derives the mission state from the authoritative order row
and the trace's ledger events; the persisted ``current_state`` column is a
last-known pointer, never trusted over the order.
"""

from __future__ import annotations

from agents.buyer.agent import BuyerResult
from sellable.contracts import (
    BuyerMission,
    BuyerMissionState,
    ConsoleBuyerMission,
    Order,
    OrderStatus,
)
from sellable.core import CommerceCore
from sellable.payments.service import PaymentService
from sellable.repositories import BuyerMissionRepository


#: The PAID-family order statuses the buyer can verify against.
_PAID_STATUSES = (OrderStatus.PAID, OrderStatus.FULFILLED)


class UnknownBuyerMissionError(LookupError):
    """The mission row (or its order) does not exist for this merchant."""


class BuyerMissionService:
    def __init__(self, engine: object | None = None) -> None:
        self._repo = BuyerMissionRepository(engine=engine)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def record_run(
        self, *, merchant_id: str, mission: BuyerMission, result: BuyerResult
    ) -> str | None:
        """Persist a mission pointer after a buyer run that created an order.

        Runs that never produced an order (DENIED / NO_MATCH) have nothing
        to continue, so they are not persisted. Repeated runs under the same
        trace update the same row (idempotent — never a second mission).
        """
        if not result.order_id:
            return None
        cart = result.seller_decision.cart if result.seller_decision else None
        negotiated = cart.total_paise if cart is not None else None
        state = (
            BuyerMissionState.NEEDS_HUMAN_APPROVAL
            if result.action == "NEEDS_HUMAN_APPROVAL"
            else BuyerMissionState.CONSENT_READY
        )
        record = self._repo.save(
            mission_id=result.trace_id.replace("trc_", "bmiss_", 1),
            merchant_id=merchant_id,
            trace_id=result.trace_id,
            buyer_agent_id=mission.buyer_agent_id,
            order_id=result.order_id,
            consent_id=result.consent_id,
            current_state=state.value,
            mission_message=mission.message[:1000],
            budget_paise=mission.budget_ceiling_paise,
            requested_sku=mission.requested_sku,
            quantity=mission.quantity,
            buyer_offer_paise=mission.buyer_offer_paise,
            negotiated_amount_paise=negotiated,
        )
        return record.mission_id

    def note_approval(
        self, *, merchant_id: str, order_id: str, consent_id: str | None
    ) -> None:
        """Best-effort pointer refresh after a merchant approval.

        The approval itself lives on the order (requires_approval/approved_at)
        and the ledger; this only keeps the mission row's pointer current so
        a restart-visible row reflects CONSENT_READY without a read.
        """
        record = self._repo.for_order(merchant_id, order_id)
        if record is None:
            return
        self._repo.touch(
            record.mission_id,
            merchant_id,
            current_state=BuyerMissionState.CONSENT_READY.value,
            consent_id=consent_id,
        )

    # ------------------------------------------------------------------
    # Derived state (order is the source of truth)
    # ------------------------------------------------------------------

    def _owned(self, mission_id: str, merchant_id: str):
        record = self._repo.get(mission_id, merchant_id)
        if record is None:
            raise UnknownBuyerMissionError(f"Buyer mission not found: {mission_id}")
        return record

    @staticmethod
    def _order_for(core: CommerceCore, record) -> Order:
        try:
            order = core.get_order(record.order_id)
        except (ValueError, TypeError) as error:
            raise UnknownBuyerMissionError(
                f"The order linked to mission {record.mission_id} no longer exists"
            ) from error
        if order.trace_id != record.trace_id:
            raise ValueError(
                "Buyer mission order trace mismatch — refusing to continue a forked audit trail"
            )
        return order

    @staticmethod
    def _payment_verified(core: CommerceCore, order: Order) -> bool:
        """True when the buyer already verified this order as PAID.

        Checks the event's recorded status, not just its existence: an old
        verification taken while the order was still AWAITING_CONSENT must
        never mark a later mission VERIFIED.
        """
        for event in core.ledger.for_trace(order.trace_id, merchant_id=core.merchant_scope):
            if event.action != "buyer.payment_verified":
                continue
            output = event.output_json or {}
            if output.get("order_id") == order.order_id and output.get("status") in (
                OrderStatus.PAID.value,
                OrderStatus.FULFILLED.value,
            ):
                return True
        return False

    @staticmethod
    def _derive(
        core: CommerceCore, order: Order, *, verified: bool
    ) -> tuple[BuyerMissionState, str]:
        """Map the AUTHORITATIVE order state onto the mission lifecycle."""
        status = order.status
        if status in _PAID_STATUSES:
            if verified:
                return BuyerMissionState.VERIFIED, "none"
            return BuyerMissionState.PAID, "verify_payment"
        if status in (OrderStatus.PAYMENT_PENDING, OrderStatus.CONSENTED):
            # CONSENTED is the transient in-flight state inside
            # start_payment; payment is already being attempted.
            return BuyerMissionState.PAYMENT_PENDING, "await_webhook"
        if status is OrderStatus.PAYMENT_FAILED:
            retries = core.ledger.count_actions(order.trace_id, "retry.started")
            if retries < PaymentService.MAX_RETRIES:
                return BuyerMissionState.PAYMENT_FAILED, "retry_payment"
            return BuyerMissionState.PAYMENT_FAILED, "none"
        if status in (OrderStatus.ABORTED, OrderStatus.REFUNDED):
            state = (
                BuyerMissionState.ABORTED
                if status is OrderStatus.ABORTED
                else BuyerMissionState.REFUNDED
            )
            return state, "none"
        # AWAITING_CONSENT (the only remaining startable state)
        if order.requires_approval:
            return BuyerMissionState.NEEDS_HUMAN_APPROVAL, "merchant_approval"
        if core.consent_service.active_for_order(order.order_id) is not None:
            return BuyerMissionState.CONSENT_READY, "start_payment"
        if order.approved_at is not None:
            # Approved, but the consent expired or was never issued — the
            # consent service refuses duplicates, so re-issue is safe.
            return BuyerMissionState.APPROVED, "issue_consent"
        return BuyerMissionState.NEEDS_HUMAN_APPROVAL, "merchant_approval"

    def _payload(
        self,
        record,
        order: Order,
        state: BuyerMissionState,
        required_action: str,
    ) -> ConsoleBuyerMission:
        return ConsoleBuyerMission(
            mission_id=record.mission_id,
            merchant_id=record.merchant_id,
            trace_id=record.trace_id,
            buyer_agent_id=record.buyer_agent_id,
            order_id=record.order_id,
            state=state,
            required_action=required_action,
            order_status=order.status,
            consent_id=record.consent_id,
            mission_message=record.mission_message,
            budget_paise=record.budget_paise,
            requested_sku=record.requested_sku,
            quantity=record.quantity,
            buyer_offer_paise=record.buyer_offer_paise,
            negotiated_amount_paise=record.negotiated_amount_paise,
            payment_url=order.provider_payment_url,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def _refresh_pointer(
        self, record, *, state: BuyerMissionState, consent_id: str | None = None
    ) -> None:
        self._repo.touch(
            record.mission_id,
            record.merchant_id,
            current_state=state.value,
            consent_id=consent_id,
        )

    # ------------------------------------------------------------------
    # Read model
    # ------------------------------------------------------------------

    def snapshot(
        self,
        *,
        core: CommerceCore,
        mission_id: str,
        merchant_id: str,
        buyer_agent=None,
    ) -> ConsoleBuyerMission:
        """Authoritative mission state, verifying a PAID order when needed.

        When the order reached PAID through the signed webhook and the buyer
        has not yet verified it, this performs the read-only
        ``verify_payment()`` check exactly once (guarded by the ledger) and
        reports VERIFIED.
        """
        record = self._owned(mission_id, merchant_id)
        order = self._order_for(core, record)
        verified = self._payment_verified(core, order)
        if not verified and order.status in _PAID_STATUSES and buyer_agent is not None:
            buyer_agent.verify_payment(order.order_id, trace_id=order.trace_id)
            verified = True
        state, required_action = self._derive(core, order, verified=verified)
        self._refresh_pointer(record, state=state)
        return self._payload(record, order, state, required_action)

    def list_snapshots(
        self,
        *,
        core: CommerceCore,
        merchant_id: str,
        buyer_agent=None,
        limit: int = 20,
    ) -> list[ConsoleBuyerMission]:
        out: list[ConsoleBuyerMission] = []
        for record in self._repo.list_for_merchant(merchant_id, limit=limit):
            try:
                out.append(
                    self.snapshot(
                        core=core,
                        mission_id=record.mission_id,
                        merchant_id=merchant_id,
                        buyer_agent=buyer_agent,
                    )
                )
            except UnknownBuyerMissionError:
                # The linked order vanished (should not happen) — skip the
                # row instead of failing the whole list.
                continue
        return out

    # ------------------------------------------------------------------
    # Continuation
    # ------------------------------------------------------------------

    def continue_mission(
        self,
        *,
        core: CommerceCore,
        payments: PaymentService,
        mission_id: str,
        merchant_id: str,
        buyer_agent=None,
    ) -> ConsoleBuyerMission:
        """Resume the SAME order's lifecycle from its true current state.

        Guards before any money-adjacent action (spec §20): the order must
        exist for this merchant, carry the mission's own trace, not be
        terminal, and have no prior successful payment. Consent is reused
        when valid, issued when missing/expired, and consumed by the
        EXISTING PaymentService — which is itself idempotent per order.
        """
        record = self._owned(mission_id, merchant_id)
        order = self._order_for(core, record)
        verified = self._payment_verified(core, order)
        state, required_action = self._derive(core, order, verified=verified)

        if state is BuyerMissionState.PAID and buyer_agent is not None:
            buyer_agent.verify_payment(order.order_id, trace_id=order.trace_id)
            verified = True
            state, required_action = BuyerMissionState.VERIFIED, "none"

        if state in (BuyerMissionState.CONSENT_READY, BuyerMissionState.APPROVED):
            active = core.consent_service.active_for_order(order.order_id)
            consent = active if active is not None else core.issue_consent(order.order_id)
            consent_id = consent.consent_id
            # The existing payment service re-checks consent, consumes it
            # exactly once, transitions the order, and reuses any live
            # provider link — repeated calls cannot duplicate a payment.
            attempt = payments.start_payment(
                order_id=order.order_id, consent_id=consent_id, commerce=core
            )
            order = core.get_order(order.order_id)
            state = BuyerMissionState.PAYMENT_PENDING
            required_action = "await_webhook"
            self._refresh_pointer(record, state=state, consent_id=consent_id)
            payload = self._payload(record, order, state, required_action)
            payload = payload.model_copy(update={"payment_url": attempt.payment_url})
            return payload

        self._refresh_pointer(record, state=state, consent_id=record.consent_id)
        return self._payload(record, order, state, required_action)
