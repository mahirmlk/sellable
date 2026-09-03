"""Repository for persisting and loading orders, consents, merchants, and catalog."""

from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import Engine, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sellable.contracts import (
    Consent,
    ConsentStatus,
    Order,
    OrderStatus,
    Product,
    Refund,
    RefundStatus,
)
from sellable.ledger.database import (
    AgentNonceRecord,
    CatalogProductRecord,
    ConsentRecord,
    MerchantRecord,
    OrderRecord,
    RefundRecord,
    make_engine,
)


def _as_aware_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; Postgres returns aware ones.

    Normalize at the repository boundary so business code can always compare
    against ``utc_now()`` without naive/aware TypeErrors.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class MerchantRepository:
    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    def get(self, merchant_id: str) -> MerchantRecord | None:
        with Session(self._engine) as session:
            return session.get(MerchantRecord, merchant_id)

    def name_of(self, merchant_id: str) -> str | None:
        record = self.get(merchant_id)
        return record.name if record else None

    def create(self, merchant_id: str, name: str) -> MerchantRecord:
        with Session(self._engine) as session:
            record = MerchantRecord(
                merchant_id=merchant_id,
                name=name,
                created_at=datetime.now(timezone.utc),
            )
            session.add(record)
            session.commit()
            return record


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
                existing.provider_link_id = order.provider_link_id
                existing.provider_order_id = order.provider_order_id
                existing.provider_payment_url = order.provider_payment_url
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
                    provider_link_id=order.provider_link_id,
                    provider_order_id=order.provider_order_id,
                    provider_payment_url=order.provider_payment_url,
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
                    provider_link_id=record.provider_link_id,
                    provider_order_id=record.provider_order_id,
                    provider_payment_url=record.provider_payment_url,
                    created_at=record.created_at,
            )

    def for_idempotency_key(self, merchant_id: str, idempotency_key: str) -> Order | None:
        """Find an order by its (merchant, idempotency_key) pair.

        DB-backed counterpart of the in-memory idempotency map, so replay
        detection and race resolution work across processes and restarts.
        """
        with Session(self._engine) as session:
            query = (
                select(OrderRecord)
                .where(OrderRecord.merchant_id == merchant_id)
                .where(OrderRecord.idempotency_key == idempotency_key)
            )
            record = session.scalars(query.limit(1)).first()
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
                    provider_link_id=record.provider_link_id,
                    provider_order_id=record.provider_order_id,
                    provider_payment_url=record.provider_payment_url,
                    created_at=record.created_at,
            )

    def for_provider(
        self,
        *,
        link_id: str | None = None,
        provider_order_id: str | None = None,
    ) -> Order | None:
        """Find an order by its persisted Razorpay reference (webhook path)."""
        with Session(self._engine) as session:
            query = select(OrderRecord)
            if link_id is not None:
                query = query.where(OrderRecord.provider_link_id == link_id)
            elif provider_order_id is not None:
                query = query.where(OrderRecord.provider_order_id == provider_order_id)
            else:
                return None
            record = session.scalars(query.limit(1)).first()
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
                    provider_link_id=record.provider_link_id,
                    provider_order_id=record.provider_order_id,
                    provider_payment_url=record.provider_payment_url,
                    created_at=record.created_at,
            )

    def all(self, merchant_id: str | None = None) -> list[Order]:
        with Session(self._engine) as session:
            query = select(OrderRecord)
            if merchant_id is not None:
                query = query.where(OrderRecord.merchant_id == merchant_id)
            records = session.scalars(query).all()
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
                    provider_link_id=r.provider_link_id,
                    provider_order_id=r.provider_order_id,
                    created_at=r.created_at,
                )
                for r in records
            ]


class RefundRepository:
    """Persists provider refund attempts; idempotency-keyed per merchant."""

    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    @staticmethod
    def _to_refund(record: RefundRecord) -> Refund:
        return Refund(
            refund_id=record.refund_id,
            merchant_id=record.merchant_id,
            order_id=record.order_id,
            amount_paise=record.amount_paise,
            provider_payment_id=record.provider_payment_id,
            provider_refund_id=record.provider_refund_id,
            reason=record.reason,
            status=RefundStatus(record.status),
            idempotency_key=record.idempotency_key,
            created_at=_as_aware_utc(record.created_at),
        )

    def save(self, refund: Refund) -> None:
        with Session(self._engine) as session:
            existing = session.get(RefundRecord, refund.refund_id)
            if existing:
                existing.provider_payment_id = refund.provider_payment_id
                existing.provider_refund_id = refund.provider_refund_id
                existing.status = refund.status.value
            else:
                session.add(
                    RefundRecord(
                        refund_id=refund.refund_id,
                        merchant_id=refund.merchant_id,
                        order_id=refund.order_id,
                        amount_paise=refund.amount_paise,
                        provider_payment_id=refund.provider_payment_id,
                        provider_refund_id=refund.provider_refund_id,
                        reason=refund.reason,
                        status=refund.status.value,
                        idempotency_key=refund.idempotency_key,
                        created_at=refund.created_at,
                    )
                )
            session.commit()

    def for_idempotency_key(self, merchant_id: str, idempotency_key: str) -> Refund | None:
        with Session(self._engine) as session:
            query = (
                select(RefundRecord)
                .where(RefundRecord.merchant_id == merchant_id)
                .where(RefundRecord.idempotency_key == idempotency_key)
            )
            record = session.scalars(query.limit(1)).first()
            return self._to_refund(record) if record else None

    def for_order(self, merchant_id: str, order_id: str) -> list[Refund]:
        with Session(self._engine) as session:
            query = (
                select(RefundRecord)
                .where(RefundRecord.merchant_id == merchant_id)
                .where(RefundRecord.order_id == order_id)
                .order_by(RefundRecord.created_at)
            )
            return [self._to_refund(r) for r in session.scalars(query).all()]


class NonceRepository:
    """Persistent HMAC nonce store for agent-request replay protection."""

    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    def claim(self, agent_id: str, nonce: str, *, ttl_seconds: int = 600) -> bool:
        """Return True exactly once per (agent, nonce) pair.

        Stale rows (older than the timestamp window) are pruned on each
        claim so the table stays tiny.
        """
        now = int(time.time())
        with Session(self._engine) as session:
            session.execute(
                delete(AgentNonceRecord).where(
                    AgentNonceRecord.seen_at < now - ttl_seconds
                )
            )
            session.add(
                AgentNonceRecord(agent_id=agent_id, nonce=nonce, seen_at=now)
            )
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                return False
            return True


class CatalogRepository:
    """DB-backed, per-merchant product catalog (the real source of truth)."""

    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    @staticmethod
    def _row_id(merchant_id: str, sku: str) -> str:
        return f"{merchant_id}:{sku}"

    def list(self, merchant_id: str) -> list[Product]:
        with Session(self._engine) as session:
            records = session.scalars(
                select(CatalogProductRecord).where(
                    CatalogProductRecord.merchant_id == merchant_id
                )
            ).all()
            return [
                Product(
                    id=r.id,
                    merchant_id=r.merchant_id,
                    sku=r.sku,
                    title=r.title,
                    description=r.description,
                    price_paise=r.price_paise,
                    floor_paise=r.floor_paise,
                    stock=r.stock,
                    category=r.category,
                    attributes=r.attributes or {},
                )
                for r in records
            ]

    def add(self, product: Product) -> Product:
        with Session(self._engine) as session:
            row_id = self._row_id(product.merchant_id, product.sku)
            existing = session.get(CatalogProductRecord, row_id)
            if existing:
                raise ValueError(f"SKU already exists: {product.sku}")
            session.add(
                CatalogProductRecord(
                    id=row_id,
                    merchant_id=product.merchant_id,
                    sku=product.sku,
                    title=product.title,
                    description=product.description,
                    price_paise=product.price_paise,
                    floor_paise=product.floor_paise,
                    stock=product.stock,
                    category=product.category,
                    attributes=product.attributes,
                )
            )
            session.commit()
        return product

    def add_many(self, products: list[Product]) -> None:
        """Bulk insert used for seeding; skips SKUs that already exist."""
        with Session(self._engine) as session:
            for product in products:
                row_id = self._row_id(product.merchant_id, product.sku)
                if session.get(CatalogProductRecord, row_id) is None:
                    session.add(
                        CatalogProductRecord(
                            id=row_id,
                            merchant_id=product.merchant_id,
                            sku=product.sku,
                            title=product.title,
                            description=product.description,
                            price_paise=product.price_paise,
                            floor_paise=product.floor_paise,
                            stock=product.stock,
                            category=product.category,
                            attributes=product.attributes,
                        )
                    )
            session.commit()


class ConsentRepository:
    def __init__(self, engine: object | None = None) -> None:
        from sqlalchemy import Engine
        self._engine = engine or make_engine()

    def save(self, consent: Consent) -> None:
        with Session(self._engine) as session:
            existing = session.get(ConsentRecord, consent.consent_id)
            if existing:
                existing.merchant_id = consent.merchant_id
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
                    merchant_id=consent.merchant_id,
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
                merchant_id=record.merchant_id,
                order_id=record.order_id,
                amount_paise=record.amount_paise,
                payee_id=record.payee_id,
                purpose=record.purpose,
                expires_at=_as_aware_utc(record.expires_at),
                status=ConsentStatus(record.status),
                single_use=bool(record.single_use),
            )

    def all(self, merchant_id: str | None = None) -> list[Consent]:
        with Session(self._engine) as session:
            query = select(ConsentRecord)
            if merchant_id is not None:
                # Legacy rows have merchant_id NULL; they remain visible only
                # to the tenant named by their payee_id (which always equals
                # the issuing merchant for core-issued consents).
                query = query.where(
                    (ConsentRecord.merchant_id == merchant_id)
                    | (
                        ConsentRecord.merchant_id.is_(None)
                        & (ConsentRecord.payee_id == merchant_id)
                    )
                )
            records = session.scalars(query).all()
            return [
                Consent(
                    consent_id=r.consent_id,
                    merchant_id=r.merchant_id,
                    order_id=r.order_id,
                    amount_paise=r.amount_paise,
                    payee_id=r.payee_id,
                    purpose=r.purpose,
                    expires_at=_as_aware_utc(r.expires_at),
                    status=ConsentStatus(r.status),
                    single_use=bool(r.single_use),
                )
                for r in records
            ]
