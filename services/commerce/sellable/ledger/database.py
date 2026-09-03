"""Minimal persistence layer for Phase 0's append-only ledger contract."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, create_engine
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
    merchant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(256), nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ConsentRecord(Base):
    __tablename__ = "consents"

    consent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    payee_id: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(280), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    single_use: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


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


def _migrate(engine) -> None:
    """Add columns introduced after the initial schema without dropping data."""
    from sqlalchemy import text

    if engine.dialect.name == "sqlite":
        return  # SQLite dev databases are always created fresh from the models

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


def initialise_database(config: Settings = settings) -> None:
    engine = make_engine(config)
    Base.metadata.create_all(engine)
    _migrate(engine)
