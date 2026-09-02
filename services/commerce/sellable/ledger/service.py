"""Append-only ledger writes and trace replay queries."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from sellable.contracts import LedgerEvent
from sellable.ledger.database import LedgerEventRecord, make_engine


class LedgerRepository:
    def __init__(self, engine: Engine | None = None) -> None:
        self._engine = engine or make_engine()

    def append(self, event: LedgerEvent) -> LedgerEvent:
        record = LedgerEventRecord(
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

    def for_trace(self, trace_id: str) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            return session.scalars(
                select(LedgerEventRecord)
                .where(LedgerEventRecord.trace_id == trace_id)
                .order_by(LedgerEventRecord.sequence)
            ).all()

    def all_events(
        self, limit: int = 200, offset: int = 0, trace_ids: Sequence[str] | None = None
    ) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            query = select(LedgerEventRecord)
            if trace_ids is not None:
                if not trace_ids:
                    return []
                query = query.where(LedgerEventRecord.trace_id.in_(list(trace_ids)))
            query = query.order_by(LedgerEventRecord.sequence.desc()).offset(offset).limit(limit)
            return session.scalars(query).all()

    def count_events(self, trace_ids: Sequence[str] | None = None) -> int:
        with Session(self._engine) as session:
            query = select(func.count(LedgerEventRecord.sequence))
            if trace_ids is not None:
                if not trace_ids:
                    return 0
                query = query.where(LedgerEventRecord.trace_id.in_(list(trace_ids)))
            return session.scalar(query) or 0

    def max_sequence(self) -> int:
        with Session(self._engine) as session:
            return session.scalar(select(func.max(LedgerEventRecord.sequence))) or 0

    def events_after(
        self, sequence: int, limit: int = 200, trace_ids: Sequence[str] | None = None
    ) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            query = select(LedgerEventRecord).where(LedgerEventRecord.sequence > sequence)
            if trace_ids is not None:
                if not trace_ids:
                    return []
                query = query.where(LedgerEventRecord.trace_id.in_(list(trace_ids)))
            return session.scalars(query.order_by(LedgerEventRecord.sequence).limit(limit)).all()
