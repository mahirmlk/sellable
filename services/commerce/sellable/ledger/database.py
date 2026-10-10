"""Minimal persistence layer for Phase 0's append-only ledger contract."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import threading

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from sellable.config import Settings, settings

# One shared engine per database URL: repositories and auth helpers call
# make_engine() per request, and every fresh Engine builds its own pool
# (TCP/TLS handshakes on Postgres). In-memory SQLite URLs are never shared
# — each caller keeps an isolated database.
_engine_cache: dict[str, object] = {}
_engine_cache_lock = threading.Lock()


class Base(DeclarativeBase):
    pass


class LedgerEventRecord(Base):
    __tablename__ = "ledger_events"

    sequence: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    # Owning merchant — written by the commerce core so console activity can
    # be scoped in SQL. Nullable only for legacy rows (backfilled from orders).
    merchant_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    inputs_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    output_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    reasoning_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    policy_refs_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    outcome_effect_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    provider_ref: Mapped[str | None] = mapped_column(String(256), nullable=True)
    flags_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class OrderRecord(Base):
    __tablename__ = "orders"

    order_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    quote_id: Mapped[str] = mapped_column(String(128), nullable=False)
    buyer_agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(256), nullable=False)
    __table_args__ = (
        # Cross-worker backstop for the in-memory idempotency guard in
        # CommerceCore.create_order: the same merchant can never insert two
        # orders under one key, even from concurrent processes.
        UniqueConstraint("merchant_id", "idempotency_key", name="uq_orders_merchant_idempotency"),
    )
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Provider references for restart-proof webhook settlement
    provider_link_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    provider_order_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    provider_payment_url: Mapped[str | None] = mapped_column(String(512), nullable=True)


class ConsentRecord(Base):
    __tablename__ = "consents"

    consent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Owning merchant. Nullable only for legacy rows (backfilled from
    # payee_id, which always equals the merchant for core-issued consents).
    merchant_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    payee_id: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(280), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    single_use: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class WebhookDeliveryRecord(Base):
    """Restart-proof record of processed webhook deliveries.

    The delivery key ``{event}:{provider_payment_id}`` is the primary key, so
    claiming a key is atomic across processes and replicas: concurrent or
    redelivered webhooks cannot both pass. Replaces the old in-memory
    ``_processed_delivery_keys`` set, which was lost on every restart.
    """

    __tablename__ = "webhook_deliveries"

    delivery_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RefundRecord(Base):
    """One provider refund attempt per row; (merchant, idempotency_key) is
    unique so retried refund requests return the existing record instead of
    moving money twice."""

    __tablename__ = "refunds"

    refund_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    provider_payment_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_refund_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "merchant_id", "idempotency_key", name="uq_refunds_merchant_idempotency"
        ),
    )


class AgentNonceRecord(Base):
    """Seen HMAC nonces for agent-request replay protection.

    The primary key makes claiming atomic across processes and replicas
    (unlike the old in-memory set, which was lost on every restart).
    ``seen_at`` is epoch seconds (integer, timezone-free by construction);
    rows older than the timestamp window are pruned on each claim.
    """

    __tablename__ = "agent_nonces"

    agent_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    nonce: Mapped[str] = mapped_column(String(128), primary_key=True)
    seen_at: Mapped[int] = mapped_column(Integer, nullable=False)


class AgentApiKeyRecord(Base):
    """Merchant-issued agent API keys for external AI buyers.

    Only the SHA-256 hash is stored — the plaintext is returned exactly once
    at creation/rotation and can never be recovered. ``key_prefix`` lets the
    merchant console display which key is which without exposing secrets.
    Revocation is soft (``revoked_at``) so historical transactions stay
    attributable to the key that made them.
    """

    __tablename__ = "agent_api_keys"

    key_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    buyer_agent_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CheckoutSessionRecord(Base):
    """Durable checkout sessions (chat continuity across reload/navigation).

    The session row is a *pointer*, not a second state machine: money state
    always comes from the linked order, approval state from the order's
    requires_approval/status, policy from the policy row. The row persists
    the conversation transcript, the last backend-issued quote snapshot, the
    applied session budget, and the active order link so the console can
    restore exactly where the merchant left off.

    At most one ACTIVE session per (merchant, buyer_ref): enforced by a
    partial unique index so concurrent creates collapse to one row instead
    of forking the conversation.
    """

    __tablename__ = "checkout_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    buyer_ref: Mapped[str] = mapped_column(String(128), nullable=False, default="human_chat")
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    budget_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    cart_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    decision_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    messages_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    # Human-readable chat-history label, derived deterministically server-side
    # from the first user message (never LLM-generated). NULL until a user
    # message exists or the merchant sets one explicitly.
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Soft-archive flag for chat history. Archived rows are hidden from the
    # default list but never hard-deleted (orders/ledger/consents untouched).
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        # Partial unique index (supported by both SQLite and Postgres):
        # only one ACTIVE row per merchant+buyer can exist.
        Index(
            "uq_active_checkout_session",
            "merchant_id",
            "buyer_ref",
            unique=True,
            sqlite_where=(status == "ACTIVE"),
            postgresql_where=(status == "ACTIVE"),
        ),
    )


class PolicyRecord(Base):
    __tablename__ = "policy"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    policy_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class BuyerMissionRecord(Base):
    """Durable buyer-mission state (AI Buyer HITL resume).

    The row is a POINTER to the authoritative order (and through it to
    consent/payment/webhook state) — never a second financial state
    machine. ``current_state`` stores the last derived value so the console
    can show progression after restarts; every read re-derives the truth
    from the order row and the trace's ledger events.
    """

    __tablename__ = "buyer_missions"

    mission_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    buyer_agent_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    consent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_state: Mapped[str] = mapped_column(String(32), nullable=False, default="NEEDS_HUMAN_APPROVAL")
    mission_message: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    budget_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    buyer_offer_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    negotiated_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        # One mission per trace: a repeated buyer run with the same trace is
        # a retry of the SAME mission, never a forked one.
        UniqueConstraint("merchant_id", "trace_id", name="uq_buyer_missions_merchant_trace"),
    )


class MerchantUserRecord(Base):
    __tablename__ = "merchant_users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    auth_user_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="owner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MerchantRecord(Base):
    __tablename__ = "merchants"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CatalogProductRecord(Base):
    __tablename__ = "catalog_products"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    price_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    floor_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class DelegationRecord(Base):
    """Bounded customer→agent delegation grants (target §14.2).

    The authorization service resolves these into explicit decisions; a
    revoked or expired grant invalidates future actions. Scope lists and
    category lists are stored as JSON arrays of the canonical scope names.
    """

    __tablename__ = "delegations"

    delegation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    principal_customer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    subject_agent_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    operation_scopes_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    category_scopes_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    amount_limit_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    frequency_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approval_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="AUTO")
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentIdentityRecord(Base):
    """First-class agent registry rows (target §13)."""

    __tablename__ = "agents"

    agent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_type: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False)
    issuer: Mapped[str] = mapped_column(String(256), nullable=False)
    client_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    credential_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    credential_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    capability_profile: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentReputationRecord(Base):
    """Behavioral reputation counters per agent (target §13.3)."""

    __tablename__ = "agent_reputations"

    agent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    successful_transactions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_transactions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    policy_denials: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fraud_flags: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    abuse_flags: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    authorization_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    average_order_value_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    support_incidents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    merchant_acceptance_rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    customer_complaints: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reputation_score_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score_confidence_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MerchantOnboardingRecord(Base):
    """Per-merchant onboarding pointer (target §10). One row per merchant;
    the row tracks the lifecycle stage, never commerce state."""

    __tablename__ = "merchant_onboarding"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    completed_checks_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OutboxEventRecord(Base):
    """Transactional-outbox rows for the future Event Bus (target §27).

    Domain services publish envelopes here; Phase 6 consumers will claim
    unpublished rows. The ledger stays the durable evidence layer — this
    table is a delivery queue, never queried as audit truth. ``published_at``
    marks handoff to the bus; publishers write best-effort so a queue
    failure can never break commerce (shared-transaction atomicity arrives
    with the Phase 6 bus implementation).
    """

    __tablename__ = "outbox_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    event_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bus delivery state (§27 retry policy + dead-letter queue). Attempts
    # count failed consumer deliveries; dead_lettered rows stop retrying and
    # surface in merchant operations for manual replay.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dead_lettered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CartRecord(Base):
    """Persistent cart header (target §18.2). Money truth lives in the
    item rows + server-derived totals; promotion/tax/shipping snapshot
    columns are reserved for the Phase 2b pricing services."""

    __tablename__ = "carts"

    cart_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    agent_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    subtotal_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discount_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tax_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    shipping_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grand_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CartItemRecord(Base):
    """One cart line: SKU + quantity + server-snapshotted unit price."""

    __tablename__ = "cart_items"

    cart_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_paise: Mapped[int] = mapped_column(Integer, nullable=False)


class PromotionCampaignRecord(Base):
    """Persisted promotion definitions (target §20.3, §38
    promotion_campaigns). Evaluation reads ACTIVE rows only."""

    __tablename__ = "promotion_campaigns"

    promotion_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    coupon_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    percent_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buy_sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    buy_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    get_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bundle_skus_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    bundle_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume_sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    volume_min_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_cart_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_discount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stacking: Mapped[str] = mapped_column(String(32), nullable=False, default="STACKABLE")
    budget_limit_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redemption_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    product_skus_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    categories_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    customer_ids_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    channels_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    free_shipping: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PromotionRedemptionRecord(Base):
    """One counted promotion application (§38 promotion_redemptions, §20.4
    budget/cap engine input). Written when a checkout completes."""

    __tablename__ = "promotion_redemptions"

    redemption_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    promotion_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    checkout_id: Mapped[str] = mapped_column(String(64), nullable=False)
    discount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RiskDecisionRecord(Base):
    """Persisted risk decisions (target §24.3, §38 risk_decisions)."""

    __tablename__ = "risk_decisions"

    decision_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    score_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reasons_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    subject_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FraudEventRecord(Base):
    """Abuse/fraud signals (target §24.4, §38 fraud_events)."""

    __tablename__ = "fraud_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_type: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    detail_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentTrustEventRecord(Base):
    """Append-only agent trust history (§38 agent_trust_events)."""

    __tablename__ = "agent_trust_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SupportCaseRecord(Base):
    """Customer-service cases (target §26.1, §38 support_cases)."""

    __tablename__ = "support_cases"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    checkout_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="other")
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="MEDIUM")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    summary: Mapped[str] = mapped_column(String(2000), nullable=False)
    context_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class QuoteRecord(Base):
    """Bounded commercial-offer snapshots (target §18.3, §38 quotes)."""

    __tablename__ = "quotes"

    quote_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    cart_id: Mapped[str] = mapped_column(String(64), nullable=False)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    base_subtotal_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    negotiated_subtotal_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_promotion_ids_json: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    promotion_discount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class QuoteItemRecord(Base):
    """Quote lines: base snapshot + negotiated offer per SKU."""

    __tablename__ = "quote_items"

    quote_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    base_unit_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    negotiated_unit_paise: Mapped[int] = mapped_column(Integer, nullable=False)


class CheckoutRecord(Base):
    """First-class checkout sessions (target §18.4, §38 checkouts). Money
    truth still settles through orders; the checkout is the validated,
    priced, authorized preparation state."""

    __tablename__ = "checkouts"

    checkout_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cart_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    cart_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quote_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    delegation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subtotal_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discount_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tax_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    shipping_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grand_total_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    applied_promotion_ids_json: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    promotion_discounts_json: Mapped[dict[str, int]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    free_shipping_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    risk_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    authorization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    price_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CheckoutLineRecord(Base):
    """Checkout price snapshot lines (target §38 checkout line state)."""

    __tablename__ = "checkout_lines"

    checkout_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_paise: Mapped[int] = mapped_column(Integer, nullable=False)


class CheckoutEventRecord(Base):
    """Append-only checkout transition log (§38 checkout_events)."""

    __tablename__ = "checkout_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    checkout_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TaxRateRecord(Base):
    """Merchant GST rates per category (target §22, §38 price_rules
    family). Missing categories fall back to the standard 18% split."""

    __tablename__ = "tax_rates"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category: Mapped[str] = mapped_column(String(64), primary_key=True)
    cgst_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    sgst_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    igst_bps: Mapped[int] = mapped_column(Integer, nullable=False)


class ShippingMethodRecord(Base):
    """Merchant shipping methods (target §23.1, §38 shipping_methods)."""

    __tablename__ = "shipping_methods"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    method: Mapped[str] = mapped_column(String(32), primary_key=True)
    price_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    eta_min_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    eta_max_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pincode_prefixes_json: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class FulfillmentRecord(Base):
    """Basic fulfillment rows (target §23.2, §38 fulfillments)."""

    __tablename__ = "fulfillments"

    fulfillment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    tracking_reference: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    carrier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="FULFILLMENT_PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TrackingEventRecord(Base):
    """Carrier/shipping status ingestion log (§38 tracking_events)."""

    __tablename__ = "tracking_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fulfillment_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    location: Mapped[str | None] = mapped_column(String(160), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ReturnRecord(Base):
    """Post-purchase return cases (target §26, §38 returns)."""

    __tablename__ = "returns"

    return_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    items_json: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="REQUESTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ExchangeRecord(Base):
    """Replacement-shipment asks linked to a return (§38 exchanges)."""

    __tablename__ = "exchanges"

    exchange_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    return_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    replacement_sku: Mapped[str] = mapped_column(String(64), nullable=False)
    replacement_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="REQUESTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RefundRequestRecord(Base):
    """Merchant-gated refund asks (§38 refund_requests)."""

    __tablename__ = "refund_requests"

    refund_request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    return_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    decided_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentRunRecord(Base):
    """Agent execution runs (target §29.1 run level, §38 agent_runs)."""

    __tablename__ = "agent_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    agent_version: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    policy_bundle_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    tool_registry_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model_version: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RUNNING")
    outcome: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentModelCallRecord(Base):
    """Model-level telemetry (target §29.1, §38 model_calls)."""

    __tablename__ = "model_calls"

    call_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(nullable=False, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    finish_reason: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fallback_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentToolCallRecord(Base):
    """Tool-level telemetry (target §29.1, §38 tool_calls)."""

    __tablename__ = "tool_calls"

    tool_call_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_version: Mapped[str] = mapped_column(String(32), nullable=False, default="1")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OK")
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    policy_decision_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    risk_decision_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    authorization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ProtocolSessionRecord(Base):
    """Negotiated capability sessions (target §15.3, §38 agent_sessions
    family). One row per agent × merchant × protocol pairing."""

    __tablename__ = "protocol_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    protocol: Mapped[str] = mapped_column(String(16), nullable=False, default="rest")
    protocol_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1")
    active_capabilities_json: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list
    )
    auth_context_json: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    delegation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class IdentityLinkRecord(Base):
    """Customer identity links (target §12, §38 customer_identities family).
    Only the link-code hash is stored; the code itself is shown once."""

    __tablename__ = "identity_links"

    link_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    protocol: Mapped[str] = mapped_column(String(16), nullable=False, default="rest")
    scopes_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    link_code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AnalyticsEventRecord(Base):
    """Normalized analytical facts (target §34, §38 analytics_events)."""

    __tablename__ = "analytics_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NotificationRecord(Base):
    """Merchant notifications (target §35, §38 notifications). Written by
    the notification consumer, read by the console feed."""

    __tablename__ = "notifications"

    notification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="inapp")
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(280), nullable=False)
    body: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    urgency: Mapped[str] = mapped_column(String(32), nullable=False, default="NORMAL")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WebhookSubscriptionRecord(Base):
    """Outbound webhook subscriptions (target §36.2). Secrets are stored
    in clear (needed for signing) behind the deny-by-default RLS posture;
    per-merchant carrier secrets arrive in Phase 8."""

    __tablename__ = "webhook_subscriptions"

    subscription_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    events_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    secret: Mapped[str] = mapped_column(String(128), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WebhookDispatchRecord(Base):
    """Outbound delivery log: one row per (subscription, event) with
    attempt accounting for operations triage."""

    __tablename__ = "webhook_dispatches"

    dispatch_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    subscription_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EvaluationSuiteRecord(Base):
    """Versioned evaluation suites (target §30.2, §38 evaluation_suites)."""

    __tablename__ = "evaluation_suites"

    suite_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")
    description: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EvaluationCaseRecord(Base):
    """Versioned scenario cases (target §30.2, §38 evaluation_cases).
    Inputs and expectations are inline JSON so datasets are self-contained
    and replayable without code changes."""

    __tablename__ = "evaluation_cases"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    suite_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="P1")
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    expects_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EvaluationRunRecord(Base):
    """Suite executions (target §30, §38 evaluation_runs)."""

    __tablename__ = "evaluation_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    suite_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    agent_version: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RUNNING")
    passed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvaluationResultRecord(Base):
    """Per-case outcomes (target §30, §38 evaluation_results)."""

    __tablename__ = "evaluation_results"

    result_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    case_id: Mapped[str] = mapped_column(String(64), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    score_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SandboxRunRecord(Base):
    """Sandbox workflow runs (target §31.2): stage-gated agent onboarding
    from registration through conformance to production approval."""

    __tablename__ = "sandbox_runs"

    sandbox_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="REGISTERED")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MerchantConnectorRecord(Base):
    """Merchant source-system connectors (target §38 merchant_connectors).
    Config holds non-secret mapping only; secrets live in env/secret
    manager and are referenced by name."""

    __tablename__ = "merchant_connectors"

    connector_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="commerce")
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="custom_rest")
    base_url: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    products_path: Mapped[str] = mapped_column(String(512), nullable=False, default="/products")
    field_map_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    headers_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="NEW")
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def make_engine(config: Settings = settings):
    url = config.database_url
    if ":memory:" not in url:
        with _engine_cache_lock:
            cached = _engine_cache.get(url)
            if cached is None:
                cached = _build_engine(config)
                _engine_cache[url] = cached
            return cached
    return _build_engine(config)


def _build_engine(config: Settings = settings):
    if config.database_url.startswith("sqlite"):
        # A file-backed SQLite URL fails with "unable to open database file"
        # when the parent directory does not exist (fresh CI checkouts, new
        # containers — data/ is gitignored). Create it, never for :memory:.
        if ":memory:" not in config.database_url:
            db_path = config.database_url.split("///", 1)[-1].split("?", 1)[0]
            parent = Path(db_path).parent
            if str(parent) not in ("", "."):
                Path(parent).mkdir(parents=True, exist_ok=True)
        connect_args: dict[str, object] = {"check_same_thread": False}
    elif "pooler.supabase.com" in config.database_url or "pgbouncer=true" in config.database_url:
        # Supabase pooler (PgBouncer transaction mode) does not support prepared statements
        connect_args = {"prepare_threshold": None}
    else:
        connect_args = {}
    return create_engine(config.database_url, connect_args=connect_args, pool_pre_ping=True)


def _migrate_sqlite(engine) -> None:
    """Bring long-lived SQLite dev databases up to the current models."""
    import logging

    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError

    log = logging.getLogger("sellable.migrate")
    with engine.begin() as connection:
        tables = {
            row[0]
            for row in connection.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
        }
        if "consents" in tables:
            cols = {
                row[1] for row in connection.execute(text("PRAGMA table_info(consents)"))
            }
            if "merchant_id" not in cols:
                connection.execute(text("ALTER TABLE consents ADD COLUMN merchant_id VARCHAR(64)"))
                connection.execute(
                    text("UPDATE consents SET merchant_id = payee_id WHERE merchant_id IS NULL")
                )
        if "orders" in tables:
            order_cols = {
                row[1] for row in connection.execute(text("PRAGMA table_info(orders)"))
            }
            if "provider_payment_url" not in order_cols:
                connection.execute(
                    text("ALTER TABLE orders ADD COLUMN provider_payment_url VARCHAR(512)")
                )
            # Tolerant: pre-existing duplicate keys keep the old behavior
            # (core guard) instead of crashing startup.
            try:
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_merchant_idempotency "
                        "ON orders (merchant_id, idempotency_key)"
                    )
                )
            except OperationalError as error:
                log.warning("Skipping orders idempotency unique index: %s", error)
        if "checkout_sessions" in tables:
            session_cols = {
                row[1] for row in connection.execute(text("PRAGMA table_info(checkout_sessions)"))
            }
            if "title" not in session_cols:
                connection.execute(text("ALTER TABLE checkout_sessions ADD COLUMN title VARCHAR(160)"))
            if "archived" not in session_cols:
                connection.execute(
                    text("ALTER TABLE checkout_sessions ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE")
                )
            # Partial unique index: exactly one ACTIVE row per merchant+buyer.
            # Tolerant like the orders index above — legacy duplicates keep
            # the application-level guard instead of crashing startup.
            try:
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_checkout_session "
                        "ON checkout_sessions (merchant_id, buyer_ref) "
                        "WHERE status = 'ACTIVE'"
                    )
                )
            except OperationalError as error:
                log.warning("Skipping active-session unique index: %s", error)
        if "checkouts" in tables:
            checkout_cols = {
                row[1] for row in connection.execute(text("PRAGMA table_info(checkouts)"))
            }
            if "promotion_discounts_json" not in checkout_cols:
                connection.execute(text("ALTER TABLE checkouts ADD COLUMN promotion_discounts_json JSON NOT NULL DEFAULT '{}'"))
            if "free_shipping_applied" not in checkout_cols:
                connection.execute(
                    text("ALTER TABLE checkouts ADD COLUMN free_shipping_applied BOOLEAN NOT NULL DEFAULT FALSE")
                )
        if "outbox_events" in tables:
            outbox_cols = {
                row[1] for row in connection.execute(text("PRAGMA table_info(outbox_events)"))
            }
            if "attempts" not in outbox_cols:
                connection.execute(
                    text("ALTER TABLE outbox_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
                )
            if "last_error" not in outbox_cols:
                connection.execute(text("ALTER TABLE outbox_events ADD COLUMN last_error VARCHAR(500)"))
            if "dead_lettered" not in outbox_cols:
                connection.execute(
                    text("ALTER TABLE outbox_events ADD COLUMN dead_lettered BOOLEAN NOT NULL DEFAULT FALSE")
                )


def _migrate(engine) -> None:
    """Add columns introduced after the initial schema without dropping data."""
    import logging

    from sqlalchemy import text

    if engine.dialect.name == "sqlite":
        _migrate_sqlite(engine)
        return

    # Use a raw connection without prepared statements for PgBouncer compatibility
    with engine.begin() as connection:
        # Check if orders table exists via information_schema (avoids inspector prepared statements)
        exists = connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders')")
        ).scalar()
        sessions_exists = connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checkout_sessions')")
        ).scalar()
        if sessions_exists:
            session_cols = {
                row[0]
                for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'checkout_sessions'"))
            }
            if "title" not in session_cols:
                connection.execute(text("ALTER TABLE checkout_sessions ADD COLUMN title VARCHAR(160)"))
            if "archived" not in session_cols:
                connection.execute(
                    text("ALTER TABLE checkout_sessions ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE")
                )
        checkouts_exists = connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checkouts')")
        ).scalar()
        if checkouts_exists:
            checkout_cols = {
                row[0]
                for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'checkouts'"))
            }
            if "promotion_discounts_json" not in checkout_cols:
                connection.execute(
                    text("ALTER TABLE checkouts ADD COLUMN promotion_discounts_json JSONB NOT NULL DEFAULT '{}'")
                )
            if "free_shipping_applied" not in checkout_cols:
                connection.execute(
                    text("ALTER TABLE checkouts ADD COLUMN free_shipping_applied BOOLEAN NOT NULL DEFAULT FALSE")
                )
        outbox_exists = connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outbox_events')")
        ).scalar()
        if outbox_exists:
            outbox_cols = {
                row[0]
                for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'outbox_events'"))
            }
            if "attempts" not in outbox_cols:
                connection.execute(
                    text("ALTER TABLE outbox_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
                )
            if "last_error" not in outbox_cols:
                connection.execute(text("ALTER TABLE outbox_events ADD COLUMN last_error VARCHAR(500)"))
            if "dead_lettered" not in outbox_cols:
                connection.execute(
                    text("ALTER TABLE outbox_events ADD COLUMN dead_lettered BOOLEAN NOT NULL DEFAULT FALSE")
                )
        if not exists:
            return
        cols = {
            row[0]
            for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'"))
        }
        if "requires_approval" not in cols:
            connection.execute(
                text("ALTER TABLE orders ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT FALSE")
            )
        if "approved_at" not in cols:
            connection.execute(
                text("ALTER TABLE orders ADD COLUMN approved_at TIMESTAMPTZ NULL")
            )
        if "provider_link_id" not in cols:
            connection.execute(text("ALTER TABLE orders ADD COLUMN provider_link_id VARCHAR(256)"))
        if "provider_order_id" not in cols:
            connection.execute(text("ALTER TABLE orders ADD COLUMN provider_order_id VARCHAR(256)"))
        if "provider_payment_url" not in cols:
            connection.execute(text("ALTER TABLE orders ADD COLUMN provider_payment_url VARCHAR(512)"))
        tables = {
            row[0]
            for row in connection.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_name IN ('consents', 'orders')")
            )
        }
        if "consents" in tables:
            consent_cols = {
                row[0]
                for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'consents'"))
            }
            if "merchant_id" not in consent_cols:
                connection.execute(text("ALTER TABLE consents ADD COLUMN merchant_id VARCHAR(64)"))
                connection.execute(
                    text("UPDATE consents SET merchant_id = payee_id WHERE merchant_id IS NULL")
                )
                connection.execute(text("CREATE INDEX ix_consents_merchant_id ON consents (merchant_id)"))
        ledger_cols = {
            row[0]
            for row in connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'ledger_events'"))
        }
        if "merchant_id" not in ledger_cols:
            connection.execute(text("ALTER TABLE ledger_events ADD COLUMN merchant_id VARCHAR(64)"))
            connection.execute(text("CREATE INDEX ix_ledger_events_merchant_id ON ledger_events (merchant_id)"))
            # Backfill from the owning order where one exists; legacy system
            # traces (policy/catalog updates) belong to the demo store.
            connection.execute(text(
                "UPDATE ledger_events SET merchant_id = ("
                " SELECT o.merchant_id FROM orders o WHERE o.trace_id = ledger_events.trace_id)"
                " WHERE merchant_id IS NULL"
            ))
            connection.execute(text(
                "UPDATE ledger_events SET merchant_id = 'mrc_demo_store' WHERE merchant_id IS NULL"
            ))

    # Separate transaction: pre-existing duplicate keys must not roll back
    # the column migrations above — worst case the core in-memory guard
    # remains the only protection and a warning is logged.
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_merchant_idempotency "
                "ON orders (merchant_id, idempotency_key)"
            ))
    except Exception as error:  # noqa: BLE001 — startup must survive legacy data
        logging.getLogger("sellable.migrate").warning(
            "Skipping orders idempotency unique index: %s", error
        )

    # Same tolerance for the single-ACTIVE-session invariant.
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_checkout_session "
                "ON checkout_sessions (merchant_id, buyer_ref) "
                "WHERE status = 'ACTIVE'"
            ))
    except Exception as error:  # noqa: BLE001 — startup must survive legacy data
        logging.getLogger("sellable.migrate").warning(
            "Skipping active-session unique index: %s", error
        )


def initialise_database(config: Settings = settings) -> None:
    engine = make_engine(config)
    Base.metadata.create_all(engine)
    _migrate(engine)
