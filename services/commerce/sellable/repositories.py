"""Repository for persisting and loading orders, consents, merchants, and catalog."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from sellable.contracts import Consent, ConsentStatus, Order, OrderStatus, Product
from sellable.ledger.database import (
    CatalogProductRecord,
    ConsentRecord,
    MerchantRecord,
    OrderRecord,
    make_engine,
)


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
