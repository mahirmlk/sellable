"""Repository for persisting and loading orders and consents."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from sellable.contracts import Consent, ConsentStatus, Order, OrderStatus
from sellable.ledger.database import ConsentRecord, OrderRecord, make_engine


class OrderRepository:
    def __init__(self, engine: object | None = None) -> None:
        from sqlalchemy import Engine
        self._engine = engine or make_engine()

    def save(self, order: Order) -> None:
        with Session(self._engine) as session:
            existing = session.get(OrderRecord, order.order_id)
            if existing:
                existing.trace_id = order.trace_id
                existing.quote_id = order.quote_id
                existing.buyer_agent_id = order.buyer_agent_id
                existing.merchant_id = order.merchant_id
                existing.amount_paise = order.amount_paise
                existing.status = order.status.value
                existing.idempotency_key = order.idempotency_key
                existing.requires_approval = order.requires_approval
                existing.approved_at = order.approved_at
                existing.created_at = order.created_at
            else:
                record = OrderRecord(
                    order_id=order.order_id,
                    trace_id=order.trace_id,
                    quote_id=order.quote_id,
                    buyer_agent_id=order.buyer_agent_id,
                    merchant_id=order.merchant_id,
                    amount_paise=order.amount_paise,
                    status=order.status.value,
                    idempotency_key=order.idempotency_key,
                    requires_approval=order.requires_approval,
                    approved_at=order.approved_at,
                    created_at=order.created_at,
                )
                session.add(record)
            session.commit()

    def get(self, order_id: str) -> Order | None:
        with Session(self._engine) as session:
            record = session.get(OrderRecord, order_id)
            if not record:
                return None
            return Order(
                order_id=record.order_id,
                trace_id=record.trace_id,
                quote_id=record.quote_id,
                buyer_agent_id=record.buyer_agent_id,
                merchant_id=record.merchant_id,
                amount_paise=record.amount_paise,
                status=OrderStatus(record.status),
                idempotency_key=record.idempotency_key,
                requires_approval=record.requires_approval,
                approved_at=record.approved_at,
                created_at=record.created_at,
            )

    def all(self) -> list[Order]:
        with Session(self._engine) as session:
            records = session.scalars(select(OrderRecord)).all()
            return [
                Order(
                    order_id=r.order_id,
                    trace_id=r.trace_id,
                    quote_id=r.quote_id,
                    buyer_agent_id=r.buyer_agent_id,
                    merchant_id=r.merchant_id,
                    amount_paise=r.amount_paise,
                    status=OrderStatus(r.status),
                    idempotency_key=r.idempotency_key,
                    requires_approval=r.requires_approval,
                    approved_at=r.approved_at,
                    created_at=r.created_at,
                )
                for r in records
            ]


class ConsentRepository:
    def __init__(self, engine: object | None = None) -> None:
        from sqlalchemy import Engine
        self._engine = engine or make_engine()

    def save(self, consent: Consent) -> None:
        with Session(self._engine) as session:
            existing = session.get(ConsentRecord, consent.consent_id)
            if existing:
                existing.order_id = consent.order_id
                existing.amount_paise = consent.amount_paise
                existing.payee_id = consent.payee_id
                existing.purpose = consent.purpose
                existing.expires_at = consent.expires_at
                existing.status = consent.status.value
                existing.single_use = consent.single_use
            else:
                record = ConsentRecord(
                    consent_id=consent.consent_id,
                    order_id=consent.order_id,
                    amount_paise=consent.amount_paise,
                    payee_id=consent.payee_id,
                    purpose=consent.purpose,
                    expires_at=consent.expires_at,
                    status=consent.status.value,
                    single_use=consent.single_use,
                )
                session.add(record)
            session.commit()

    def get(self, consent_id: str) -> Consent | None:
        with Session(self._engine) as session:
            record = session.get(ConsentRecord, consent_id)
            if not record:
                return None
            return Consent(
                consent_id=record.consent_id,
                order_id=record.order_id,
                amount_paise=record.amount_paise,
                payee_id=record.payee_id,
                purpose=record.purpose,
                expires_at=record.expires_at,
                status=ConsentStatus(record.status),
                single_use=bool(record.single_use),
            )

    def all(self) -> list[Consent]:
        with Session(self._engine) as session:
            records = session.scalars(select(ConsentRecord)).all()
            return [
                Consent(
                    consent_id=r.consent_id,
                    order_id=r.order_id,
                    amount_paise=r.amount_paise,
                    payee_id=r.payee_id,
                    purpose=r.purpose,
                    expires_at=r.expires_at,
                    status=ConsentStatus(r.status),
                    single_use=bool(r.single_use),
                )
                for r in records
            ]
