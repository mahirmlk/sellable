"""Canonical, transport-safe contracts for the commerce core and trust layer."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


Paise = Annotated[int, Field(ge=0, description="Integer paise; never a float.")]
PositivePaise = Annotated[int, Field(gt=0, description="Positive integer paise.")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PolicyVerdict(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    NEEDS_HUMAN_APPROVAL = "NEEDS_HUMAN_APPROVAL"


class OrderStatus(StrEnum):
    AWAITING_CONSENT = "AWAITING_CONSENT"
    CONSENTED = "CONSENTED"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    PAID = "PAID"
    FULFILLED = "FULFILLED"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    ABORTED = "ABORTED"
    REFUNDED = "REFUNDED"


class ConsentStatus(StrEnum):
    ISSUED = "ISSUED"
    USED = "USED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class PaymentStatus(StrEnum):
    PAYMENT_PENDING = "PAYMENT_PENDING"
    CAPTURED = "CAPTURED"
    FAILED = "FAILED"


class LedgerActor(StrEnum):
    BUYER_AGENT = "buyer_agent"
    SELLER_AGENT = "seller_agent"
    POLICY_ENGINE = "policy_engine"
    CONSENT_SERVICE = "consent_service"
    HUMAN = "human"
    RAZORPAY = "razorpay"
    COMMERCE_CORE = "commerce_core"


class Product(StrictModel):
    id: str = Field(default_factory=lambda: new_id("prd"))
    merchant_id: str
    sku: str = Field(min_length=1, max_length=64, pattern=r"^[A-Z0-9-]+$")
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=2_000)
    price_paise: PositivePaise
    floor_paise: PositivePaise
    stock: int = Field(ge=0)
    category: str = Field(min_length=1, max_length=64)
    attributes: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def floor_cannot_exceed_list_price(self) -> "Product":
        if self.floor_paise > self.price_paise:
            raise ValueError("floor_paise cannot exceed price_paise")
        return self


class MerchantPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=False)
    merchant_id: str
    currency: str = Field(default="INR", min_length=3, max_length=3)
    max_order_value_paise: PositivePaise
    max_single_item_value_paise: PositivePaise
    max_discount_percent: int = Field(ge=0, le=100)
    allowed_categories: list[str] = Field(min_length=1)
    max_negotiation_rounds: int = Field(ge=0, le=20)
    max_upsells_per_session: int = Field(ge=0, le=10)
    human_approval_threshold_paise: PositivePaise

    @model_validator(mode="after")
    def approval_threshold_cannot_exceed_order_limit(self) -> "MerchantPolicy":
        if self.human_approval_threshold_paise > self.max_order_value_paise:
            raise ValueError("human_approval_threshold_paise cannot exceed max_order_value_paise")
        return self


class IntentMandate(StrictModel):
    mandate_id: str = Field(default_factory=lambda: new_id("im"))
    buyer_agent_id: str
    budget_ceiling_paise: PositivePaise
    allowed_categories: list[str] = Field(min_length=1)
    purpose: str = Field(min_length=1, max_length=280)
    created_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime

    @model_validator(mode="after")
    def expiry_must_follow_creation(self) -> "IntentMandate":
        if self.expires_at <= self.created_at:
            raise ValueError("expires_at must be after created_at")
        return self


class CartItem(StrictModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    unit_price_paise: PositivePaise
    offered_price_paise: PositivePaise

    @model_validator(mode="after")
    def offer_cannot_exceed_list_price(self) -> "CartItem":
        if self.offered_price_paise > self.unit_price_paise:
            raise ValueError("offered_price_paise cannot exceed unit_price_paise")
        return self

    @property
    def line_total_paise(self) -> int:
        return self.quantity * self.offered_price_paise


class CartMandate(StrictModel):
    mandate_id: str = Field(default_factory=lambda: new_id("cart"))
    intent_ref: str
    items: list[CartItem] = Field(min_length=1)
    subtotal_paise: Paise
    discount_paise: Paise
    total_paise: PositivePaise
    upsell_offered: bool = False
    upsell_rationale: str | None = Field(default=None, max_length=500)
    negotiation_round: int = Field(ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    gate_verdict: PolicyVerdict | None = None
    gate_reason_code: str | None = Field(default=None, max_length=96)

    @model_validator(mode="after")
    def totals_must_match_items(self) -> "CartMandate":
        item_total = sum(item.quantity * item.unit_price_paise for item in self.items)
        offered_total = sum(item.line_total_paise for item in self.items)
        if self.subtotal_paise != item_total:
            raise ValueError("subtotal_paise must equal the sum of list-price item totals")
        if self.discount_paise != item_total - offered_total:
            raise ValueError("discount_paise must equal the calculated item discount")
        if self.total_paise != offered_total:
            raise ValueError("total_paise must equal the sum of offered item totals")
        return self


class Consent(StrictModel):
    consent_id: str = Field(default_factory=lambda: new_id("con"))
    # Owning merchant. Optional only for legacy rows; core-issued consents
    # always set it (it equals payee_id) so hydration can scope per tenant.
    merchant_id: str | None = Field(default=None, max_length=64)
    order_id: str
    amount_paise: PositivePaise
    payee_id: str
    purpose: str = Field(min_length=1, max_length=280)
    expires_at: datetime
    status: ConsentStatus = ConsentStatus.ISSUED
    approved_at: datetime | None = None
    single_use: bool = True


class ExecutionRecord(StrictModel):
    order_id: str
    idempotency_key: str = Field(min_length=16, max_length=256)
    razorpay_order_id: str | None = None
    razorpay_payment_id: str | None = None
    status: OrderStatus
    failure_reason: str | None = Field(default=None, max_length=500)
    executed_at: datetime | None = None


class PaymentAttempt(StrictModel):
    attempt_id: str = Field(default_factory=lambda: new_id("payatt"))
    order_id: str
    provider: str = "razorpay"
    provider_order_id: str
    provider_payment_id: str | None = None
    # Hosted Razorpay Payment Link URL — the browser only ever receives this
    # public link, never credentials. Settlement still happens exclusively
    # through the signature-verified webhook.
    payment_url: str | None = None
    status: PaymentStatus = PaymentStatus.PAYMENT_PENDING
    idempotency_key: str = Field(min_length=16, max_length=256)
    failure_reason: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utc_now)


class PaymentStartRequest(StrictModel):
    consent_id: str = Field(min_length=1, max_length=128)


class ConsentRequest(StrictModel):
    order_id: str = Field(min_length=1, max_length=128)


class OrderCreateRequest(StrictModel):
    intent: IntentMandate
    message: str = Field(min_length=1, max_length=1_000)
    idempotency_key: str = Field(min_length=16, max_length=256)
    request_upsell: bool = True
    # Client-supplied trace ids must match the server format exactly. A free-form
    # trace_id could collide with another merchant's trace and leak ledger
    # events into their console; server-generated ids are uuid4 (unguessable).
    trace_id: str | None = Field(
        default=None, max_length=128, pattern=r"^trc_[0-9a-f]{32}$"
    )
    requested_sku: str | None = Field(default=None, max_length=64)
    buyer_offer_paise: int | None = Field(default=None, gt=0)


class OrderStatusRequest(StrictModel):
    order_id: str = Field(min_length=1, max_length=128)


class RefundStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class CheckoutSessionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    ORDER_PLACED = "ORDER_PLACED"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"


class ChatMessage(StrictModel):
    role: str = Field(min_length=1, max_length=16)
    text: str = Field(min_length=1, max_length=2000)
    status: str | None = Field(default=None, max_length=16)
    # Tool chips shown under seller messages (e.g. catalog.search). Display
    # metadata only — restored verbatim, never re-executed.
    tool_calls: list[str] | None = Field(default=None, max_length=32)


class CheckoutSessionUpsert(StrictModel):
    session_id: str | None = Field(default=None, max_length=64)
    buyer_ref: str = Field(default="human_chat", min_length=1, max_length=128)
    budget_paise: int | None = Field(default=None, ge=0)
    message: str | None = Field(default=None, max_length=2000)
    trace_id: str | None = Field(
        default=None, max_length=128, pattern=r"^trc_[0-9a-f]{32}$"
    )
    cart: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None
    order_id: str | None = Field(default=None, max_length=128)
    messages: list[ChatMessage] | None = None
    status: CheckoutSessionStatus | None = None


class CheckoutSession(StrictModel):
    session_id: str = Field(default_factory=lambda: new_id("sess"))
    merchant_id: str
    buyer_ref: str = "human_chat"
    trace_id: str | None = None
    status: CheckoutSessionStatus = CheckoutSessionStatus.ACTIVE
    budget_paise: int | None = None
    message: str | None = None
    cart: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None
    order_id: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    # Chat-history label, derived deterministically server-side from the first
    # user message when absent (never LLM-generated). Merchants may override.
    title: str | None = Field(default=None, max_length=160)
    # Soft-archive flag: archived rows hide from the default history list but
    # are never hard-deleted.
    archived: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class CheckoutSessionPatch(StrictModel):
    """Ownership-checked partial update for one chat-history row.

    ``title=None`` means "not provided, leave unchanged"; an empty/blank
    title clears the label back to NULL. ``archived`` toggles soft-archive in
    either direction (unarchiving restores the row to the default list).
    """

    title: str | None = Field(default=None, max_length=160)
    archived: bool | None = None


class CheckoutSessionListItem(StrictModel):
    """Lightweight chat-history row: metadata only, never the transcript.

    No ``messages``/``cart``/``decision`` blobs — the console fetches the full
    session by id only when the merchant opens it. ``order_status`` and
    ``amount_paise`` come from the linked order via one batched lookup;
    ``approval_pending`` is a display hint (linked order requires approval and
    is still awaiting consent).
    """

    session_id: str
    title: str | None = None
    status: CheckoutSessionStatus = CheckoutSessionStatus.ACTIVE
    archived: bool = False
    created_at: datetime
    updated_at: datetime
    order_id: str | None = None
    trace_id: str | None = None
    budget_paise: int | None = None
    # Last buyer request text (real context for the history row, not a blob).
    message: str | None = None
    message_count: int = 0
    order_status: OrderStatus | None = None
    amount_paise: int | None = None
    approval_pending: bool = False


class RefundCreateRequest(StrictModel):
    order_id: str = Field(min_length=1, max_length=128)
    reason: str = Field(default="merchant_initiated", min_length=1, max_length=500)
    # Partial refunds keep the order PAID; a full refund settles it REFUNDED.
    amount_paise: int | None = Field(default=None, gt=0)
    # Client-supplied idempotency; when absent the server derives a
    # deterministic key per (order, amount) so retries never double-refund.
    idempotency_key: str | None = Field(default=None, min_length=16, max_length=256)


class Refund(StrictModel):
    refund_id: str = Field(default_factory=lambda: new_id("rfnd"))
    merchant_id: str
    order_id: str
    amount_paise: PositivePaise
    provider_payment_id: str | None = Field(default=None, max_length=128)
    provider_refund_id: str | None = Field(default=None, max_length=128)
    reason: str = Field(min_length=1, max_length=500)
    status: RefundStatus = RefundStatus.PENDING
    idempotency_key: str = Field(min_length=16, max_length=256)
    created_at: datetime = Field(default_factory=utc_now)


class CatalogSearchRequest(StrictModel):
    query: str = Field(default="", max_length=500)
    categories: list[str] = Field(default_factory=list)


class CatalogGetRequest(StrictModel):
    sku: str = Field(min_length=1, max_length=64)


class BuyerMission(StrictModel):
    buyer_agent_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=1_000)
    budget_ceiling_paise: PositivePaise
    allowed_categories: list[str] = Field(min_length=1)
    purpose: str = Field(min_length=1, max_length=280)
    expires_at: datetime
    request_upsell: bool = True
    # Targeted purchasing: without these the buyer can only send a free-text
    # message and never name a SKU, set a quantity, or make a first offer —
    # which made the A2A negotiation loop structurally impossible.
    requested_sku: str | None = Field(default=None, max_length=64)
    quantity: int = Field(default=1, ge=1, le=100)
    buyer_offer_paise: int | None = Field(default=None, gt=0)


class Order(StrictModel):
    order_id: str = Field(default_factory=lambda: new_id("ord"))
    trace_id: str = Field(min_length=1, max_length=128)
    quote_id: str
    buyer_agent_id: str
    merchant_id: str
    amount_paise: PositivePaise
    status: OrderStatus = OrderStatus.AWAITING_CONSENT
    idempotency_key: str = Field(min_length=16, max_length=256)
    requires_approval: bool = False
    approved_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    # Provider references — persisted so webhook settlement survives process
    # restarts (the provider order id is what payment.captured references).
    # The payment URL is persisted too so a rebuilt attempt (after a restart
    # or from a fresh service) still hands the buyer a payable link.
    provider_link_id: str | None = Field(default=None, max_length=256)
    provider_order_id: str | None = Field(default=None, max_length=256)
    provider_payment_url: str | None = Field(default=None, max_length=512)


class PolicyDecision(StrictModel):
    verdict: PolicyVerdict
    reason_code: str | None = Field(default=None, max_length=96)
    reasoning_summary: str = Field(min_length=1, max_length=500)
    policy_refs: list[str] = Field(default_factory=list)


class LedgerEvent(StrictModel):
    event_id: str = Field(default_factory=lambda: new_id("evt"))
    trace_id: str = Field(min_length=1, max_length=128)
    # Owning merchant (optional for compatibility with historical call sites).
    merchant_id: str | None = Field(default=None, max_length=64)
    timestamp: datetime = Field(default_factory=utc_now)
    actor: LedgerActor
    action: str = Field(min_length=1, max_length=128)
    inputs: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    reasoning_summary: str | None = Field(default=None, max_length=1_000)
    policy_refs: list[str] = Field(default_factory=list)
    outcome_effect: dict[str, Any] | None = None
    provider_ref: str | None = Field(default=None, max_length=256)
    flags: list[str] = Field(default_factory=list)


class ConsoleTransactionItem(StrictModel):
    order_id: str
    trace_id: str
    status: OrderStatus
    amount_paise: PositivePaise
    buyer_agent_id: str
    merchant_id: str
    quote_id: str
    idempotency_key: str
    created_at: datetime
    # Enrichment derived from the authoritative ledger (§9/§40)
    channel: str = "agent_to_agent"
    items: list[dict[str, object]] = Field(default_factory=list)
    policy_verdict: str | None = None
    policy_reason: str | None = None
    policy_refs: list[str] = Field(default_factory=list)
    policy_explanation: str | None = None
    buyer_budget_paise: int | None = None
    consent_id: str | None = None
    consent_status: str | None = None
    consent_expires_at: str | None = None
    payment_status: str | None = None
    payment_order_id: str | None = None
    payment_id: str | None = None
    payment_url: str | None = None


class ConsoleTransactionDetail(ConsoleTransactionItem):
    events: list[LedgerEvent] = Field(default_factory=list)


class ConsoleApprovalRequest(StrictModel):
    order_id: str
    buyer_agent_id: str
    amount_paise: PositivePaise
    reason: str
    requested_at: datetime
    status: str = "PENDING"


class ConsoleGrowthMetrics(StrictModel):
    revenue: int = 0
    agent_assisted_revenue: int = 0
    upsell_revenue: int = 0
    avg_order_value: int = 0
    total_orders: int = 0
    upsell_offers: int = 0
    upsell_accepted: int = 0
    negotiations: int = 0
    negotiated_accepted: int = 0
    countered: int = 0
    walked_away: int = 0


class ConsolePolicySettings(StrictModel):
    merchant_id: str
    currency: str
    max_order_value_paise: int
    max_single_item_value_paise: int
    max_discount_percent: int
    allowed_categories: list[str]
    max_negotiation_rounds: int
    max_upsells_per_session: int
    human_approval_threshold_paise: int


class ConsolePolicyUpdate(StrictModel):
    max_order_value_paise: PositivePaise | None = None
    max_single_item_value_paise: PositivePaise | None = None
    max_discount_percent: int | None = Field(default=None, ge=0, le=100)
    allowed_categories: list[str] | None = None
    max_negotiation_rounds: int | None = Field(default=None, ge=0, le=20)
    max_upsells_per_session: int | None = Field(default=None, ge=0, le=10)
    human_approval_threshold_paise: PositivePaise | None = None
