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

    def all_events(self, limit: int = 200, offset: int = 0) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            return session.scalars(
                select(LedgerEventRecord)
                .order_by(LedgerEventRecord.sequence.desc())
                .offset(offset)
                .limit(limit)
            ).all()

    def count_events(self) -> int:
        with Session(self._engine) as session:
            return session.scalar(select(func.count(LedgerEventRecord.sequence))) or 0

    def max_sequence(self) -> int:
        with Session(self._engine) as session:
            return session.scalar(select(func.max(LedgerEventRecord.sequence))) or 0

    def events_after(self, sequence: int, limit: int = 200) -> Sequence[LedgerEventRecord]:
        with Session(self._engine) as session:
            return session.scalars(
                select(LedgerEventRecord)
                .where(LedgerEventRecord.sequence > sequence)
                .order_by(LedgerEventRecord.sequence)
                .limit(limit)
            ).all()
