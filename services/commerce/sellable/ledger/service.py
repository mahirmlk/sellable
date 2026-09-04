"""Append-only ledger writes and trace replay queries."""

from __future__ import annotations

from collections.abc import Sequence

from datetime import datetime, timezone

from sqlalchemy import Engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sellable.contracts import LedgerEvent
from sellable.ledger.database import LedgerEventRecord, WebhookDeliveryRecord, make_engine


class LedgerRepository:
    def __init__(self, engine: Engine | None = None) -> None:
        self._engine = engine or make_engine()

    def append(self, event: LedgerEvent) -> LedgerEvent:
        record = LedgerEventRecord(
            merchant_id=event.merchant_id,
            event_id=event.event_id,
            trace_id=event.trace_id,
            timestamp=event.timestamp,
            actor=event.actor.value,
            action=event.action,
            inputs_json=event.inputs,
            output_json=event.output,
            reasoning_summary=event.reasoning_summary,
            policy_refs_json=event.policy_refs,
            outcome_effect_json=event.outcome_effect,
            provider_ref=event.provider_ref,
            flags_json=event.flags,
        )
        with Session(self._engine) as session:
            session.add(record)
            session.commit()
        return event

    def for_trace(
        self, trace_id: str, *, merchant_id: str | None = None
    ) -> Sequence[LedgerEventRecord]:
        """Ledger events for one trace, optionally tenant-scoped.

        Console callers must pass their merchant id: trace ids are
        client-influenced (regex-pinned but not unguessable across tenants),
        so the repository itself enforces the boundary instead of trusting
        every caller to pre-check order ownership.
        """
        with Session(self._engine) as session:
            query = select(LedgerEventRecord).where(
                LedgerEventRecord.trace_id == trace_id
            )
            if merchant_id is not None:
                query = query.where(LedgerEventRecord.merchant_id == merchant_id)
            return session.scalars(query.order_by(LedgerEventRecord.sequence)).all()

    def all_events(
        self, limit: int = 200, offset: int = 0, merchant_id: str | None = None
    ) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            query = select(LedgerEventRecord)
            if merchant_id is not None:
                query = query.where(LedgerEventRecord.merchant_id == merchant_id)
            query = query.order_by(LedgerEventRecord.sequence.desc()).offset(offset).limit(limit)
            return session.scalars(query).all()

    def count_events(self, merchant_id: str | None = None) -> int:
        with Session(self._engine) as session:
            query = select(func.count(LedgerEventRecord.sequence))
            if merchant_id is not None:
                query = query.where(LedgerEventRecord.merchant_id == merchant_id)
            return session.scalar(query) or 0

    def max_sequence(self) -> int:
        with Session(self._engine) as session:
            return session.scalar(select(func.max(LedgerEventRecord.sequence))) or 0

    def events_for_traces(
        self, trace_ids: Sequence[str], *, merchant_id: str | None = None
    ) -> dict[str, list[LedgerEventRecord]]:
        """All events for many traces in ONE query, grouped by trace.

        Replaces the per-order for_trace loop behind transaction lists and
        approval queues (N+1 round-trips, the slowest dashboard read).
        """
        grouped: dict[str, list[LedgerEventRecord]] = {t: [] for t in trace_ids}
        if not trace_ids:
            return grouped
        with Session(self._engine) as session:
            query = select(LedgerEventRecord).where(
                LedgerEventRecord.trace_id.in_(trace_ids)
            )
            if merchant_id is not None:
                query = query.where(LedgerEventRecord.merchant_id == merchant_id)
            rows = session.scalars(query.order_by(LedgerEventRecord.sequence)).all()
            for record in rows:
                grouped.setdefault(record.trace_id, []).append(record)
            return grouped

    def last_webhook_time(self) -> datetime | None:
        """Timestamp of the latest provider-webhook event (single row).

        The status endpoint used to scan the newest 500 events with full JSON
        payloads on every call; this reads one indexed row instead.
        """
        with Session(self._engine) as session:
            query = (
                select(LedgerEventRecord.timestamp)
                .where(
                    LedgerEventRecord.action.in_(
                        ("webhook.reconciled", "payment.captured", "payment.failed")
                    )
                )
                .order_by(LedgerEventRecord.sequence.desc())
                .limit(1)
            )
            value = session.scalar(query)
            if value is not None and value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value

    def last_provider_ref(self, trace_id: str, *, action: str = "order.paid") -> str | None:
        """Latest provider ref recorded for one trace/action pair.

        Lets post-restart duplicate deliveries answer with the real settled
        payment id instead of a blank rebuilt attempt.
        """
        with Session(self._engine) as session:
            query = (
                select(LedgerEventRecord.provider_ref)
                .where(LedgerEventRecord.trace_id == trace_id)
                .where(LedgerEventRecord.action == action)
                .where(LedgerEventRecord.provider_ref.is_not(None))
                .where(LedgerEventRecord.provider_ref != "")
                .order_by(LedgerEventRecord.sequence.desc())
                .limit(1)
            )
            return session.scalar(query)

    def count_actions(self, trace_id: str, action: str) -> int:
        """Count ledger events for one trace/action pair.

        Used for restart-proof budgets (e.g. bounded payment retries): the
        ledger, not process memory, is the source of truth.
        """
        with Session(self._engine) as session:
            query = (
                select(func.count(LedgerEventRecord.sequence))
                .where(LedgerEventRecord.trace_id == trace_id)
                .where(LedgerEventRecord.action == action)
            )
            return session.scalar(query) or 0

    def claim_delivery(self, delivery_key: str) -> bool:
        """Atomically claim a webhook delivery key.

        Returns True exactly once per key, across processes and replicas
        (the primary key enforces it). Duplicate deliveries return False and
        must not write new ledger rows.
        """
        with Session(self._engine) as session:
            session.add(
                WebhookDeliveryRecord(
                    delivery_key=delivery_key,
                    received_at=datetime.now(timezone.utc),
                )
            )
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                return False
            return True

    def events_after(
        self, sequence: int, limit: int = 200, merchant_id: str | None = None
    ) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            query = select(LedgerEventRecord).where(LedgerEventRecord.sequence > sequence)
            if merchant_id is not None:
                query = query.where(LedgerEventRecord.merchant_id == merchant_id)
            return session.scalars(query.order_by(LedgerEventRecord.sequence).limit(limit)).all()
