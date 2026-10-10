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


class PaymentReceipt(StrictModel):
    """Normalized payment receipt (target §25.3): every successful payment
    produces one, binding provider state to authorization, risk, and trace
    evidence regardless of provider."""

    payment_id: str = Field(default_factory=lambda: new_id("pay"))
    order_id: str
    provider: str = Field(min_length=1, max_length=64)
    provider_reference: str | None = Field(default=None, max_length=256)
    amount_paise: PositivePaise
    currency: str = Field(min_length=3, max_length=3)
    timestamp: datetime = Field(default_factory=utc_now)
    authorization_reference: str | None = Field(default=None, max_length=128)
    risk_reference: str | None = Field(default=None, max_length=128)
    trace_id: str


class LedgerActor(StrEnum):
    BUYER_AGENT = "buyer_agent"
    SELLER_AGENT = "seller_agent"
    CUSTOMER_SERVICE_AGENT = "customer_service_agent"
    POLICY_ENGINE = "policy_engine"
    CONSENT_SERVICE = "consent_service"
    AUTHORIZATION_SERVICE = "authorization_service"
    RISK_ENGINE = "risk_engine"
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


class CartStatus(StrEnum):
    """Persistent cart lifecycle (target §39.2). A cart is mutable only in
    ACTIVE; CHECKOUT_STARTED locks it for the checkout transaction."""

    ACTIVE = "ACTIVE"
    CHECKOUT_STARTED = "CHECKOUT_STARTED"
    CONVERTED = "CONVERTED"
    EXPIRED = "EXPIRED"
    ABANDONED = "ABANDONED"


class CartLine(StrictModel):
    """One catalog-grounded line. Prices are server snapshots taken from the
    catalog at mutation time — callers send SKU + quantity only, never
    prices (target §18.2, §45: no invented prices reach commerce state)."""

    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    unit_price_paise: PositivePaise

    @property
    def line_total_paise(self) -> int:
        return self.quantity * self.unit_price_paise


class Cart(StrictModel):
    """A mutable, versioned cart (target §18.2), distinct from quote and
    order. Totals are derived server-side; promotion/tax/shipping snapshots
    are reserved for Phase 2b pricing services and default to zero."""

    cart_id: str = Field(default_factory=lambda: new_id("cart"))
    merchant_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=128)
    agent_session_id: str | None = Field(default=None, max_length=128)
    items: list[CartLine] = Field(default_factory=list)
    subtotal_paise: Paise = 0
    discount_total_paise: Paise = 0
    tax_total_paise: Paise = 0
    shipping_total_paise: Paise = 0
    grand_total_paise: Paise = 0
    status: CartStatus = CartStatus.ACTIVE
    version: int = Field(default=1, ge=1)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def totals_must_match_lines(self) -> "Cart":
        subtotal = sum(line.line_total_paise for line in self.items)
        if self.subtotal_paise != subtotal:
            raise ValueError("subtotal_paise must equal the sum of line totals")
        if self.discount_total_paise > subtotal:
            raise ValueError("discount_total_paise cannot exceed subtotal_paise")
        expected_grand = (
            subtotal
            - self.discount_total_paise
            + self.tax_total_paise
            + self.shipping_total_paise
        )
        if self.grand_total_paise != expected_grand:
            raise ValueError("grand_total_paise must equal subtotal - discount + tax + shipping")
        return self


class PromotionType(StrEnum):
    """Promotion primitives (target §20.3)."""

    COUPON = "coupon"
    PERCENTAGE_DISCOUNT = "percentage_discount"
    FIXED_DISCOUNT = "fixed_discount"
    BUNDLE = "bundle"
    BUY_X_GET_Y = "buy_x_get_y"
    VOLUME_DISCOUNT = "volume_discount"
    FREE_SHIPPING = "free_shipping"
    LIMITED_TIME_OFFER = "limited_time_offer"
    CUSTOMER_SEGMENT_OFFER = "customer_segment_offer"
    AGENT_CHANNEL_OFFER = "agent_channel_offer"


class PromotionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"


class StackingRule(StrEnum):
    STACKABLE = "STACKABLE"
    EXCLUSIVE = "EXCLUSIVE"


class Promotion(StrictModel):
    """One deterministic promotion definition (target §20.3). The LLM can
    explain a promotion but can never invent one — evaluation runs only
    over persisted rows of this shape."""

    promotion_id: str = Field(default_factory=lambda: new_id("promo"))
    merchant_id: str = Field(min_length=1, max_length=64)
    kind: PromotionType
    status: PromotionStatus = PromotionStatus.ACTIVE
    title: str = Field(min_length=1, max_length=160)
    start_at: datetime = Field(default_factory=utc_now)
    end_at: datetime | None = None
    coupon_code: str | None = Field(default=None, max_length=64)
    percent_bps: int = Field(default=0, ge=0, le=10_000)
    amount_paise: Paise = 0
    buy_sku: str | None = Field(default=None, max_length=64)
    buy_quantity: int = Field(default=0, ge=0)
    get_quantity: int = Field(default=0, ge=0)
    bundle_skus: list[str] = Field(default_factory=list)
    bundle_amount_paise: Paise = 0
    volume_sku: str | None = Field(default=None, max_length=64)
    volume_min_quantity: int = Field(default=0, ge=0)
    min_cart_total_paise: Paise = 0
    max_discount_paise: PositivePaise | None = None
    stacking: StackingRule = StackingRule.STACKABLE
    budget_limit_paise: PositivePaise | None = None
    redemption_limit: PositivePaise | None = None
    product_skus: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    customer_ids: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    free_shipping: bool = False
    priority: int = 0

    @model_validator(mode="after")
    def kind_fields_consistent(self) -> "Promotion":
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.kind == PromotionType.COUPON and not self.coupon_code:
            raise ValueError("coupon promotions require coupon_code")
        if self.kind == PromotionType.BUY_X_GET_Y and (
            not self.buy_sku or self.buy_quantity < 1 or self.get_quantity < 1
        ):
            raise ValueError("buy_x_get_y requires buy_sku, buy_quantity and get_quantity")
        if self.kind == PromotionType.BUNDLE and (
            len(self.bundle_skus) < 2 or self.bundle_amount_paise <= 0
        ):
            raise ValueError("bundle requires at least two bundle_skus and a bundle amount")
        if self.kind == PromotionType.VOLUME_DISCOUNT and (
            not self.volume_sku or self.volume_min_quantity < 2 or self.percent_bps <= 0
        ):
            raise ValueError("volume_discount requires volume_sku, volume_min_quantity and percent_bps")
        return self


class PromotionResult(StrictModel):
    """Deterministic evaluation outcome (target §20.4): the selected
    promotion set plus its price effect. Empty selection is valid."""

    applied_promotion_ids: list[str] = Field(default_factory=list)
    discount_total_paise: Paise = 0
    free_shipping: bool = False
    explanations: list[str] = Field(default_factory=list)
    #: Per-promotion discount split (sums to discount_total_paise). Used for
    #: redemption accounting at checkout completion.
    discount_by_promotion: dict[str, int] = Field(default_factory=dict)


class PriceLine(StrictModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    unit_price_paise: PositivePaise
    negotiated_unit_paise: PositivePaise | None = None
    line_subtotal_paise: Paise
    line_total_paise: Paise


class PriceBreakdown(StrictModel):
    """Authoritative, snapshotted price breakdown (target §20.1)."""

    lines: list[PriceLine] = Field(min_length=1)
    subtotal_paise: Paise
    negotiated_discount_paise: Paise = 0
    promotion_discount_paise: Paise = 0
    discount_total_paise: Paise = 0
    tax_total_paise: Paise = 0
    shipping_total_paise: Paise = 0
    grand_total_paise: PositivePaise
    priced_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def totals_consistent(self) -> "PriceBreakdown":
        subtotal = sum(line.line_subtotal_paise for line in self.lines)
        if self.subtotal_paise != subtotal:
            raise ValueError("subtotal_paise must equal the sum of line subtotals")
        if self.discount_total_paise != (
            self.negotiated_discount_paise + self.promotion_discount_paise
        ):
            raise ValueError("discount_total must equal negotiated + promotion discounts")
        expected = (
            subtotal
            - self.discount_total_paise
            + self.tax_total_paise
            + self.shipping_total_paise
        )
        if self.grand_total_paise != expected:
            raise ValueError("grand_total must equal subtotal - discount + tax + shipping")
        return self


class QuoteStatus(StrEnum):
    OPEN = "OPEN"
    ACCEPTED = "ACCEPTED"
    EXPIRED = "EXPIRED"


class QuoteNegotiationOutcome(StrEnum):
    ACCEPTED = "ACCEPTED"
    COUNTERED = "COUNTERED"
    DENIED = "DENIED"


class QuoteLine(StrictModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    base_unit_paise: PositivePaise
    negotiated_unit_paise: PositivePaise

    @model_validator(mode="after")
    def negotiated_cannot_exceed_base(self) -> "QuoteLine":
        if self.negotiated_unit_paise > self.base_unit_paise:
            raise ValueError("negotiated_unit_paise cannot exceed base_unit_paise")
        return self

    @property
    def line_base_paise(self) -> int:
        return self.quantity * self.base_unit_paise

    @property
    def line_negotiated_paise(self) -> int:
        return self.quantity * self.negotiated_unit_paise


class Quote(StrictModel):
    """A bounded commercial offer snapshotted from a cart (target §18.3):
    items, base prices, negotiated prices, promotions, expiration, and the
    round count that bounds negotiation (§20.2)."""

    quote_id: str = Field(default_factory=lambda: new_id("quo"))
    merchant_id: str = Field(min_length=1, max_length=64)
    cart_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=128)
    agent_session_id: str | None = Field(default=None, max_length=128)
    lines: list[QuoteLine] = Field(min_length=1)
    base_subtotal_paise: PositivePaise
    negotiated_subtotal_paise: PositivePaise
    applied_promotion_ids: list[str] = Field(default_factory=list)
    promotion_discount_paise: Paise = 0
    round_number: int = Field(default=0, ge=0)
    status: QuoteStatus = QuoteStatus.OPEN
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def subtotals_match_lines(self) -> "Quote":
        base = sum(line.line_base_paise for line in self.lines)
        negotiated = sum(line.line_negotiated_paise for line in self.lines)
        if self.base_subtotal_paise != base:
            raise ValueError("base_subtotal_paise must equal the sum of base lines")
        if self.negotiated_subtotal_paise != negotiated:
            raise ValueError("negotiated_subtotal_paise must equal the sum of negotiated lines")
        return self


class CheckoutStatus(StrEnum):
    """Transaction-preparation states (target §18.4, §39.3)."""

    CREATED = "CREATED"
    VALIDATED = "VALIDATED"
    PRICED = "PRICED"
    RISK_REVIEW = "RISK_REVIEW"
    AUTHORIZED = "AUTHORIZED"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"
    PAYMENT_FAILED = "PAYMENT_FAILED"


class CheckoutLine(StrictModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    unit_price_paise: PositivePaise


class Checkout(StrictModel):
    """First-class checkout session between cart/quote and order
    (target §18.4). Immutable once AUTHORIZED: any material change after
    that must cancel and restart (§14.5, §21.3)."""

    checkout_id: str = Field(default_factory=lambda: new_id("co"))
    merchant_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=128)
    agent_session_id: str | None = Field(default=None, max_length=128)
    cart_id: str = Field(min_length=1, max_length=64)
    cart_version: int = Field(ge=1)
    quote_id: str | None = Field(default=None, max_length=64)
    delegation_id: str | None = Field(default=None, max_length=64)
    lines: list[CheckoutLine] = Field(min_length=1)
    subtotal_paise: Paise = 0
    discount_total_paise: Paise = 0
    tax_total_paise: Paise = 0
    shipping_total_paise: Paise = 0
    grand_total_paise: PositivePaise = 1
    applied_promotion_ids: list[str] = Field(default_factory=list)
    #: Per-promotion discount split, persisted so completion records exact
    #: redemption amounts without re-running evaluation.
    promotion_discounts: dict[str, int] = Field(default_factory=dict)
    #: Whether the applied set grants free shipping (forces the standard
    #: shipping total to zero at price time).
    free_shipping_applied: bool = False
    status: CheckoutStatus = CheckoutStatus.CREATED
    risk_reference: str | None = Field(default=None, max_length=128)
    authorization_id: str | None = Field(default=None, max_length=64)
    price_hash: str | None = Field(default=None, max_length=64)
    order_id: str | None = Field(default=None, max_length=64)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TaxLine(StrictModel):
    """Deterministic GST line (target §22): intra-state splits CGST/SGST,
    inter-state uses IGST. Basis points keep every rate exact."""

    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100)
    taxable_paise: PositivePaise
    jurisdiction: str = Field(min_length=1, max_length=16)
    cgst_bps: int = Field(ge=0, le=28_00)
    sgst_bps: int = Field(ge=0, le=28_00)
    igst_bps: int = Field(ge=0, le=28_00)
    cgst_amount_paise: Paise = 0
    sgst_amount_paise: Paise = 0
    igst_amount_paise: Paise = 0

    @property
    def line_tax_paise(self) -> int:
        return self.cgst_amount_paise + self.sgst_amount_paise + self.igst_amount_paise


class TaxBreakdown(StrictModel):
    lines: list[TaxLine] = Field(min_length=1)
    jurisdiction: str = Field(min_length=1, max_length=16)
    cgst_total_paise: Paise = 0
    sgst_total_paise: Paise = 0
    igst_total_paise: Paise = 0
    tax_total_paise: Paise = 0
    calculation_reference: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def totals_match_lines(self) -> "TaxBreakdown":
        if self.cgst_total_paise != sum(l.cgst_amount_paise for l in self.lines):
            raise ValueError("cgst total must match lines")
        if self.sgst_total_paise != sum(l.sgst_amount_paise for l in self.lines):
            raise ValueError("sgst total must match lines")
        if self.igst_total_paise != sum(l.igst_amount_paise for l in self.lines):
            raise ValueError("igst total must match lines")
        if self.tax_total_paise != (
            self.cgst_total_paise + self.sgst_total_paise + self.igst_total_paise
        ):
            raise ValueError("tax total must equal cgst + sgst + igst")
        return self


class TaxRate(StrictModel):
    """Merchant-configured GST rate per product category (target §22).
    Same-state sales split CGST/SGST; cross-state sales use IGST."""

    merchant_id: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=64)
    cgst_bps: int = Field(ge=0, le=28_00)
    sgst_bps: int = Field(ge=0, le=28_00)
    igst_bps: int = Field(ge=0, le=28_00)


class ShippingMethod(StrEnum):
    STANDARD = "standard"
    EXPRESS = "express"
    PICKUP = "pickup"


class ShippingMethodConfig(StrictModel):
    """Merchant-configured shipping method (target §23.1). Empty
    pincode_prefixes means pan-India serviceability."""

    merchant_id: str = Field(min_length=1, max_length=64)
    method: ShippingMethod
    price_paise: Paise = 0
    eta_min_days: int = Field(ge=0, le=60)
    eta_max_days: int = Field(ge=0, le=60)
    pincode_prefixes: list[str] = Field(default_factory=list)
    active: bool = True

    @model_validator(mode="after")
    def eta_ordered(self) -> "ShippingMethodConfig":
        if self.eta_max_days < self.eta_min_days:
            raise ValueError("eta_max_days cannot precede eta_min_days")
        return self


class ShippingOption(StrictModel):
    method: ShippingMethod
    price_paise: Paise = 0
    eta_min_days: int = Field(ge=0)
    eta_max_days: int = Field(ge=0)
    serviceable: bool = True
    carrier: str | None = Field(default=None, max_length=64)


class FulfillmentStatus(StrEnum):
    """Basic fulfillment states (target §23.2) — intentionally small."""

    ORDER_CONFIRMED = "ORDER_CONFIRMED"
    FULFILLMENT_PENDING = "FULFILLMENT_PENDING"
    SHIPPED = "SHIPPED"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    DELIVERY_FAILED = "DELIVERY_FAILED"
    RETURN_REQUESTED = "RETURN_REQUESTED"
    RETURNED = "RETURNED"


class Fulfillment(StrictModel):
    fulfillment_id: str = Field(default_factory=lambda: new_id("ff"))
    merchant_id: str = Field(min_length=1, max_length=64)
    order_id: str = Field(min_length=1, max_length=64)
    method: ShippingMethod
    tracking_reference: str | None = Field(default=None, max_length=64)
    carrier: str | None = Field(default=None, max_length=64)
    status: FulfillmentStatus = FulfillmentStatus.FULFILLMENT_PENDING
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TrackingEvent(StrictModel):
    fulfillment_id: str = Field(min_length=1, max_length=64)
    status: FulfillmentStatus
    location: str | None = Field(default=None, max_length=160)
    occurred_at: datetime = Field(default_factory=utc_now)


class ReturnStatus(StrEnum):
    REQUESTED = "REQUESTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RECEIVED = "RECEIVED"
    COMPLETED = "COMPLETED"


class ReturnRequest(StrictModel):
    """Post-purchase return case seed (target §26, §38 returns). Full case
    management (messages, escalation) arrives with the Customer Service
    Agent in Phase 4."""

    return_id: str = Field(default_factory=lambda: new_id("ret"))
    merchant_id: str = Field(min_length=1, max_length=64)
    order_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=128)
    items: list[CartLine] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=500)
    status: ReturnStatus = ReturnStatus.REQUESTED
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ExchangeStatus(StrEnum):
    REQUESTED = "REQUESTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    FULFILLED = "FULFILLED"
    CANCELLED = "CANCELLED"


class ExchangeRequest(StrictModel):
    exchange_id: str = Field(default_factory=lambda: new_id("exc"))
    merchant_id: str = Field(min_length=1, max_length=64)
    return_id: str = Field(min_length=1, max_length=64)
    replacement_sku: str = Field(min_length=1, max_length=64)
    replacement_quantity: int = Field(ge=1, le=100)
    status: ExchangeStatus = ExchangeStatus.REQUESTED
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class RefundRequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    SETTLED = "SETTLED"


class RefundRequest(StrictModel):
    """Merchant-gated refund ask (§38 refund_requests). Approval here
    authorizes the provider refund call — executed by the refund rail in
    Phase 4, recorded here for audit continuity."""

    refund_request_id: str = Field(default_factory=lambda: new_id("rrq"))
    merchant_id: str = Field(min_length=1, max_length=64)
    order_id: str = Field(min_length=1, max_length=64)
    return_id: str | None = Field(default=None, max_length=64)
    amount_paise: PositivePaise
    reason: str = Field(min_length=1, max_length=500)
    status: RefundRequestStatus = RefundRequestStatus.PENDING
    decided_by: str | None = Field(default=None, max_length=128)
    provider_ref: str | None = Field(default=None, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class RiskLevel(StrEnum):
    """Risk decisions (target §24.3). Policy answers allowed?, risk
    answers how risky?, fraud answers is this abuse?"""

    ALLOW = "ALLOW"
    LOW_RISK_REVIEW = "LOW_RISK_REVIEW"
    STEP_UP_AUTH = "STEP_UP_AUTH"
    REQUIRE_CUSTOMER = "REQUIRE_CUSTOMER"
    REQUIRE_HUMAN = "REQUIRE_HUMAN"
    BLOCK = "BLOCK"


class RiskAssessment(StrictModel):
    decision_id: str = Field(default_factory=lambda: new_id("rsk"))
    merchant_id: str = Field(min_length=1, max_length=64)
    level: RiskLevel = RiskLevel.ALLOW
    score_bps: int = Field(default=0, ge=0, le=10_000)
    reasons: list[str] = Field(default_factory=list)
    subject_type: str | None = Field(default=None, max_length=64)
    subject_id: str | None = Field(default=None, max_length=128)
    trace_id: str | None = Field(default=None, pattern=r"^trc_[0-9a-f]{32}$")
    created_at: datetime = Field(default_factory=utc_now)


class FraudKind(StrEnum):
    """Agentic-commerce fraud controls (target §24.4)."""

    VELOCITY_ABUSE = "velocity_abuse"
    FAILED_AUTH_BURST = "failed_auth_burst"
    PAYMENT_TESTING = "payment_testing"
    CREDENTIAL_ABUSE = "credential_abuse"
    PROMOTION_ABUSE = "promotion_abuse"
    BOT_BEHAVIOR = "bot_behavior"


class FraudEvent(StrictModel):
    event_id: str = Field(default_factory=lambda: new_id("frd"))
    merchant_id: str = Field(min_length=1, max_length=64)
    kind: FraudKind
    subject_type: str = Field(min_length=1, max_length=64)
    subject_id: str = Field(min_length=1, max_length=128)
    detail: dict[str, object] = Field(default_factory=dict)
    trace_id: str | None = Field(default=None, pattern=r"^trc_[0-9a-f]{32}$")
    created_at: datetime = Field(default_factory=utc_now)


class TrustTier(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    NEW = "NEW"
    ESTABLISHED = "ESTABLISHED"
    TRUSTED = "TRUSTED"
    FLAGGED = "FLAGGED"
    UNDER_REVIEW = "UNDER_REVIEW"
    PROVISIONAL = "PROVISIONAL"


class TrustAssessment(StrictModel):
    subject_type: str = Field(min_length=1, max_length=64)
    subject_id: str = Field(min_length=1, max_length=128)
    tier: TrustTier
    signals: list[str] = Field(default_factory=list)
    assessed_at: datetime = Field(default_factory=utc_now)


class SupportCategory(StrEnum):
    """Support categories (target §26.2)."""

    ORDER_STATUS = "order_status"
    SHIPPING = "shipping"
    LATE_DELIVERY = "late_delivery"
    RETURN = "return"
    EXCHANGE = "exchange"
    REFUND = "refund"
    PRODUCT_QUESTION = "product_question"
    BILLING = "billing"
    ACCOUNT = "account"
    PROMOTION = "promotion"
    TECHNICAL_ISSUE = "technical_issue"
    OTHER = "other"


class SupportCaseStatus(StrEnum):
    """Support case lifecycle (target §39.5)."""

    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    ESCALATED = "ESCALATED"
    WAITING_FOR_CUSTOMER = "WAITING_FOR_CUSTOMER"


class SupportCasePriority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"


class SupportCase(StrictModel):
    """Customer-service case seed (target §26.1, §38 support_cases)."""

    case_id: str = Field(default_factory=lambda: new_id("case"))
    merchant_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=128)
    agent_id: str | None = Field(default=None, max_length=128)
    order_id: str | None = Field(default=None, max_length=64)
    checkout_id: str | None = Field(default=None, max_length=64)
    category: SupportCategory = SupportCategory.OTHER
    priority: SupportCasePriority = SupportCasePriority.MEDIUM
    status: SupportCaseStatus = SupportCaseStatus.OPEN
    summary: str = Field(min_length=1, max_length=2_000)
    context: dict[str, object] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class EscalationPayload(StrictModel):
    """Human-escalation handoff (target §26.3): everything a support
    employee needs without reconstructing the conversation."""

    customer_summary: str = Field(min_length=1, max_length=2_000)
    issue_classification: str = Field(min_length=1, max_length=128)
    order_context: dict[str, object] = Field(default_factory=dict)
    actions_attempted: list[str] = Field(default_factory=list)
    policy_constraints: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    recommended_next_action: str = Field(min_length=1, max_length=1_000)
    trace_id: str | None = Field(default=None, pattern=r"^trc_[0-9a-f]{32}$")


class CapabilityStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DEPRECATED = "DEPRECATED"
    DISABLED = "DISABLED"


class Capability(StrictModel):
    """One negotiable commerce capability (target §15.1)."""

    capability_id: str = Field(min_length=1, max_length=64)
    version: str = Field(default="1", max_length=16)
    transport: str = Field(default="rest", max_length=16)
    endpoint: str = Field(min_length=1, max_length=128)
    required_scopes: list[str] = Field(default_factory=list)
    auth_mode: str = Field(default="agent_key", max_length=32)
    limits: dict[str, object] = Field(default_factory=dict)
    status: CapabilityStatus = CapabilityStatus.ACTIVE


class MerchantCapabilityProfile(StrictModel):
    """Machine-readable merchant capability declaration (target §15.1)."""

    merchant_id: str = Field(min_length=1, max_length=64)
    protocol_version: str = Field(default="1", max_length=16)
    capabilities: list[Capability] = Field(default_factory=list)
    protocols: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)


class AgentProfile(StrictModel):
    """External agent capability declaration for negotiation (§15.2)."""

    agent_id: str = Field(min_length=1, max_length=128)
    protocol: str = Field(default="rest", max_length=16)
    protocol_version: str = Field(default="1", max_length=16)
    capabilities: list[str] = Field(default_factory=list)
    identity: dict[str, object] = Field(default_factory=dict)


class ProtocolSessionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class ProtocolSession(StrictModel):
    """Negotiated protocol session (target §15.3): the active capability
    set for one agent × merchant × protocol pairing."""

    session_id: str = Field(default_factory=lambda: new_id("psess"))
    agent_id: str = Field(min_length=1, max_length=128)
    merchant_id: str = Field(min_length=1, max_length=64)
    protocol: str = Field(default="rest", max_length=16)
    protocol_version: str = Field(default="1", max_length=16)
    active_capabilities: list[str] = Field(default_factory=list)
    auth_context: dict[str, object] = Field(default_factory=dict)
    delegation_id: str | None = Field(default=None, max_length=64)
    status: ProtocolSessionStatus = ProtocolSessionStatus.ACTIVE
    created_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime


class IdentityLinkStatus(StrEnum):
    PENDING = "PENDING"
    LINKED = "LINKED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class IdentityLink(StrictModel):
    """Customer identity link (target §12, UCP identity-linking): separates
    public/agent-authenticated access from user-authenticated access. A
    LINKED identity upgrades customer context to authenticated."""

    link_id: str = Field(default_factory=lambda: new_id("idlink"))
    merchant_id: str = Field(min_length=1, max_length=64)
    customer_id: str = Field(min_length=1, max_length=128)
    agent_id: str | None = Field(default=None, max_length=128)
    protocol: str = Field(default="rest", max_length=16)
    scopes: list[str] = Field(default_factory=list)
    status: IdentityLinkStatus = IdentityLinkStatus.PENDING
    link_code_hash: str = Field(min_length=1, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime


class NotificationUrgency(StrEnum):
    NORMAL = "NORMAL"
    URGENT = "URGENT"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    READ = "READ"
    FAILED = "FAILED"


class Notification(StrictModel):
    notification_id: str = Field(default_factory=lambda: new_id("ntf"))
    merchant_id: str = Field(min_length=1, max_length=64)
    channel: str = Field(default="inapp", max_length=32)
    event_type: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=280)
    body: str = Field(default="", max_length=2000)
    urgency: NotificationUrgency = NotificationUrgency.NORMAL
    status: NotificationStatus = NotificationStatus.PENDING
    trace_id: str | None = Field(default=None, pattern=r"^trc_[0-9a-f]{32}$")
    created_at: datetime = Field(default_factory=utc_now)


class WebhookSubscription(StrictModel):
    subscription_id: str = Field(default_factory=lambda: new_id("whs"))
    merchant_id: str = Field(min_length=1, max_length=64)
    url: str = Field(min_length=1, max_length=2000)
    events: list[str] = Field(default_factory=list)
    active: bool = True
    created_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def url_must_be_http(self) -> "WebhookSubscription":
        if not (self.url.startswith("https://") or self.url.startswith("http://")):
            raise ValueError("subscription url must be http(s)")
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
    # Checkout must re-evaluate the SAME negotiated quote the seller returned:
    # without quantity the order path silently requotes at quantity 1 / list
    # price and the persisted order diverges from the displayed cart.
    quantity: int = Field(default=1, ge=1, le=100)


class OrderStatusRequest(StrictModel):
    order_id: str = Field(min_length=1, max_length=128)


class RefundStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class BuyerMissionState(StrEnum):
    """Resumable buyer-mission lifecycle (a POINTER to the order, never a
    second financial state machine — the order stays authoritative).

    NEEDS_HUMAN_APPROVAL → APPROVED → CONSENT_READY → PAYMENT_PENDING
        → PAID → VERIFIED, with PAYMENT_FAILED / ABORTED / REFUNDED as the
    explicit failure branches derived from the order's own status.
    """

    NEEDS_HUMAN_APPROVAL = "NEEDS_HUMAN_APPROVAL"
    APPROVED = "APPROVED"
    CONSENT_READY = "CONSENT_READY"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    PAID = "PAID"
    VERIFIED = "VERIFIED"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    ABORTED = "ABORTED"
    REFUNDED = "REFUNDED"
    DENIED = "DENIED"


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


class ConsoleBuyerMission(StrictModel):
    """Merchant-console view of a persisted buyer mission.

    ``state`` is re-derived from the AUTHORITATIVE order on every read —
    the persisted ``current_state`` column is only a pointer/last-known
    value, never trusted over the order row and ledger.
    """

    mission_id: str
    merchant_id: str
    trace_id: str
    buyer_agent_id: str
    # None for DENIED missions (policy refused before any order existed).
    order_id: str | None = None
    state: BuyerMissionState
    required_action: str = "none"
    order_status: OrderStatus | None = None
    consent_id: str | None = None
    mission_message: str = ""
    budget_paise: int | None = None
    requested_sku: str | None = None
    quantity: int = 1
    buyer_offer_paise: int | None = None
    negotiated_amount_paise: int | None = None
    payment_url: str | None = None
    created_at: datetime
    updated_at: datetime


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
