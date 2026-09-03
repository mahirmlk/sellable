"""Minimal persistence layer for Phase 0's append-only ledger contract."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from sellable.config import Settings, settings


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


class PolicyRecord(Base):
    __tablename__ = "policy"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    policy_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


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


def make_engine(config: Settings = settings):
    if config.database_url.startswith("sqlite"):
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


def initialise_database(config: Settings = settings) -> None:
    engine = make_engine(config)
    Base.metadata.create_all(engine)
    _migrate(engine)
