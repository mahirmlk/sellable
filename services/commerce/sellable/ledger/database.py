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


def make_engine(config: Settings = settings):
    connect_args = {"check_same_thread": False} if config.database_url.startswith("sqlite") else {}
    return create_engine(config.database_url, connect_args=connect_args, pool_pre_ping=True)


def _migrate(engine) -> None:
    """Add columns introduced after the initial schema without dropping data."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if not inspector.has_table("orders"):
        return
    order_columns = {column["name"] for column in inspector.get_columns("orders")}
    with engine.begin() as connection:
        if "requires_approval" not in order_columns:
            connection.execute(
                text("ALTER TABLE orders ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT 0")
            )
        if "approved_at" not in order_columns:
            connection.execute(
                text("ALTER TABLE orders ADD COLUMN approved_at TIMESTAMP NULL")
            )


def initialise_database(config: Settings = settings) -> None:
    engine = make_engine(config)
    Base.metadata.create_all(engine)
    _migrate(engine)
