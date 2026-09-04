"""Repository for persisting and loading orders, consents, merchants, and catalog."""

from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Engine, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sellable.contracts import (
    ChatMessage,
    CheckoutSession,
    CheckoutSessionListItem,
    CheckoutSessionStatus,
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
    CheckoutSessionRecord,
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


class AgentApiKeyRepository:
    """Merchant-issued agent API keys (hash-only storage, soft revoke)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import AgentApiKeyRecord

        self._record_cls = AgentApiKeyRecord
        self._engine = engine or make_engine()

    def create(
        self,
        *,
        key_id: str,
        merchant_id: str,
        key_hash: str,
        key_prefix: str,
        label: str,
        buyer_agent_id: str,
    ) -> Any:
        # expire_on_commit=False: the console serializes the record after the
        # session closes, and a committed instance's expired attributes would
        # raise DetachedInstanceError.
        with Session(self._engine, expire_on_commit=False) as session:
            record = self._record_cls(
                key_id=key_id,
                merchant_id=merchant_id,
                key_hash=key_hash,
                key_prefix=key_prefix,
                label=label,
                buyer_agent_id=buyer_agent_id,
                created_at=datetime.now(timezone.utc),
            )
            session.add(record)
            session.commit()
            return record

    def list_for_merchant(self, merchant_id: str) -> list[Any]:
        with Session(self._engine) as session:
            return (
                session.query(self._record_cls)
                .filter(self._record_cls.merchant_id == merchant_id)
                .order_by(self._record_cls.created_at.desc())
                .all()
            )

    def get(self, key_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, key_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return record

    def get_active_by_hash(self, key_hash: str) -> Any | None:
        with Session(self._engine) as session:
            record = (
                session.query(self._record_cls)
                .filter(self._record_cls.key_hash == key_hash)
                .first()
            )
            if record is None or record.revoked_at is not None:
                return None
            return record

    def touch_last_used(self, key_id: str) -> None:
        try:
            with Session(self._engine) as session:
                record = session.get(self._record_cls, key_id)
                if record is not None:
                    record.last_used_at = datetime.now(timezone.utc)
                    session.commit()
        except Exception:
            # Usage metadata is best-effort; auth must never fail because of it.
            pass

    def revoke(self, key_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine, expire_on_commit=False) as session:
            record = session.get(self._record_cls, key_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            if record.revoked_at is None:
                record.revoked_at = datetime.now(timezone.utc)
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

    def all(self, merchant_id: str | None = None, *, limit: int = 500) -> list[Order]:
        """Newest-first orders, bounded so dashboards never full-scan history."""
        with Session(self._engine) as session:
            query = select(OrderRecord).order_by(OrderRecord.created_at.desc())
            if merchant_id is not None:
                query = query.where(OrderRecord.merchant_id == merchant_id)
            records = session.scalars(query.limit(max(1, limit))).all()
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
                    provider_payment_url=r.provider_payment_url,
                    created_at=r.created_at,
                )
                for r in records
            ]

    def status_counts(self, merchant_id: str | None = None) -> dict[str, int]:
        """Count orders per status in ONE grouped query.

        The status endpoint needs totals, not rows — loading every order to
        count them was its slowest read.
        """
        from sqlalchemy import func

        with Session(self._engine) as session:
            query = select(OrderRecord.status, func.count(OrderRecord.order_id))
            if merchant_id is not None:
                query = query.where(OrderRecord.merchant_id == merchant_id)
            query = query.group_by(OrderRecord.status)
            return {status: count for status, count in session.execute(query).all()}

    @staticmethod
    def _to_order(record: OrderRecord) -> Order:
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

    def get_many(
        self, order_ids: Sequence[str], merchant_id: str | None = None
    ) -> dict[str, Order]:
        """Fetch several orders in ONE query (chat-history enrichment path).

        Keys are de-duplicated and blanks dropped before the query. When
        ``merchant_id`` is given, foreign orders are excluded so a caller can
        never enrich another tenant's sessions.
        """
        ids = [oid for oid in dict.fromkeys(order_ids) if oid]
        if not ids:
            return {}
        with Session(self._engine) as session:
            query = select(OrderRecord).where(OrderRecord.order_id.in_(ids))
            if merchant_id is not None:
                query = query.where(OrderRecord.merchant_id == merchant_id)
            return {r.order_id: self._to_order(r) for r in session.scalars(query).all()}


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


class CheckoutSessionRepository:
    """Persists checkout sessions; at most one ACTIVE per (merchant, buyer)."""

    MAX_MESSAGES = 200
    #: Chat-history titles derive from the first user message, truncated here.
    TITLE_MAX_CHARS = 48

    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    @staticmethod
    def derive_title(messages: Sequence[ChatMessage | dict[str, Any]]) -> str | None:
        """Deterministic chat-history label: first user message, stripped,
        truncated to ~48 chars. No LLM, no hardcoding — pure transcript text."""
        for message in messages:
            if isinstance(message, ChatMessage):
                role, text = message.role, message.text
            else:
                role, text = message.get("role"), message.get("text", "")
            if role == "user" and text and text.strip():
                return text.strip()[:CheckoutSessionRepository.TITLE_MAX_CHARS] or None
        return None

    @staticmethod
    def _to_session(record: CheckoutSessionRecord) -> CheckoutSession:
        return CheckoutSession(
            session_id=record.session_id,
            merchant_id=record.merchant_id,
            buyer_ref=record.buyer_ref,
            trace_id=record.trace_id,
            status=CheckoutSessionStatus(record.status),
            budget_paise=record.budget_paise,
            message=record.message,
            cart=record.cart_json,
            decision=record.decision_json,
            order_id=record.order_id,
            messages=[ChatMessage.model_validate(m) for m in (record.messages_json or [])],
            title=record.title,
            archived=bool(record.archived),
            created_at=_as_aware_utc(record.created_at),
            updated_at=_as_aware_utc(record.updated_at),
        )

    def get(self, session_id: str) -> CheckoutSession | None:
        with Session(self._engine) as session:
            record = session.get(CheckoutSessionRecord, session_id)
            return self._to_session(record) if record else None

    def active_for(self, merchant_id: str, buyer_ref: str) -> CheckoutSession | None:
        """Newest visible ACTIVE session for this merchant+buyer, if any.

        Archived rows are excluded: archiving abandons the row (see
        set_archived), so an archived session never answers the active
        lookup and never blocks a fresh session via the partial index.
        """
        with Session(self._engine) as session:
            query = (
                select(CheckoutSessionRecord)
                .where(CheckoutSessionRecord.merchant_id == merchant_id)
                .where(CheckoutSessionRecord.buyer_ref == buyer_ref)
                .where(CheckoutSessionRecord.status == CheckoutSessionStatus.ACTIVE.value)
                .where(CheckoutSessionRecord.archived.is_(False))
                .order_by(CheckoutSessionRecord.updated_at.desc())
                .limit(1)
            )
            record = session.scalars(query).first()
            return self._to_session(record) if record else None

    @staticmethod
    def _is_unique_violation(error: IntegrityError) -> bool:
        """True only for unique-constraint violations (never mask other DB errors)."""
        orig = error.orig
        if getattr(orig, "pgcode", None) == "23505":
            return True
        message = str(orig if orig is not None else error).lower()
        return "unique constraint failed" in message or "duplicate key" in message

    def save(self, data: CheckoutSession, *, derive_title: bool = True) -> CheckoutSession:
        """Insert or update. A concurrent second ACTIVE collapses onto the
        existing one via the partial unique index (no forked sessions).

        Titles derive only for brand-new rows: updates never resurrect a
        PATCH-cleared title. An explicit merchant title is preserved as-is.
        Pass ``derive_title=False`` for explicit merchant edits (PATCH).
        """
        with Session(self._engine) as session:
            existing = session.get(CheckoutSessionRecord, data.session_id)
            if existing is None and derive_title and not (data.title and data.title.strip()):
                derived = self.derive_title(data.messages)
                if derived:
                    data = data.model_copy(update={"title": derived})
            if existing:
                existing.trace_id = data.trace_id
                existing.status = data.status.value
                existing.budget_paise = data.budget_paise
                existing.message = data.message
                existing.cart_json = data.cart
                existing.decision_json = data.decision
                existing.order_id = data.order_id
                existing.messages_json = [m.model_dump() for m in data.messages[-self.MAX_MESSAGES:]]
                existing.title = data.title
                existing.archived = data.archived
                existing.updated_at = data.updated_at
            else:
                session.add(
                    CheckoutSessionRecord(
                        session_id=data.session_id,
                        merchant_id=data.merchant_id,
                        buyer_ref=data.buyer_ref,
                        trace_id=data.trace_id,
                        status=data.status.value,
                        budget_paise=data.budget_paise,
                        message=data.message,
                        cart_json=data.cart,
                        decision_json=data.decision,
                        order_id=data.order_id,
                        messages_json=[m.model_dump() for m in data.messages[-self.MAX_MESSAGES:]],
                        title=data.title,
                        archived=data.archived,
                        created_at=data.created_at,
                        updated_at=data.updated_at,
                    )
                )
            try:
                session.commit()
            except IntegrityError as error:
                # Lost a race: another request created the ACTIVE row first.
                # Fall through to return the winner instead of forking — but
                # only for unique violations; any other DB error re-raises.
                session.rollback()
                if not self._is_unique_violation(error):
                    raise
                winner = self.active_for(data.merchant_id, data.buyer_ref)
                if winner is not None:
                    return winner
                raise
            return data

    def close(self, session_id: str, merchant_id: str) -> CheckoutSession | None:
        """Mark a session ABANDONED. Foreign ids return None (404 upstream)."""
        with Session(self._engine) as session:
            record = session.get(CheckoutSessionRecord, session_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            if record.status == CheckoutSessionStatus.COMPLETED.value:
                return self._to_session(record)
            record.status = CheckoutSessionStatus.ABANDONED.value
            record.updated_at = datetime.now(timezone.utc)
            session.commit()
            return self._to_session(record)

    def list_sessions(
        self,
        merchant_id: str,
        buyer_ref: str,
        *,
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CheckoutSessionListItem]:
        """Newest-first lightweight history rows for one merchant+buyer.

        Projects metadata only (transcript/cart/decision blobs stay in the
        database) plus a message count. Read-only: never inserts or mutates.
        """
        # json_array_length exists on both SQLite (JSON1) and Postgres
        # (json type) — the transcript blob itself is never fetched here.
        from sqlalchemy import func

        with Session(self._engine) as session:
            query = (
                select(
                    CheckoutSessionRecord.session_id,
                    CheckoutSessionRecord.title,
                    CheckoutSessionRecord.status,
                    CheckoutSessionRecord.archived,
                    CheckoutSessionRecord.created_at,
                    CheckoutSessionRecord.updated_at,
                    CheckoutSessionRecord.order_id,
                    CheckoutSessionRecord.trace_id,
                    CheckoutSessionRecord.budget_paise,
                    CheckoutSessionRecord.message,
                    func.coalesce(
                        func.json_array_length(CheckoutSessionRecord.messages_json), 0
                    ),
                )
                .where(CheckoutSessionRecord.merchant_id == merchant_id)
                .where(CheckoutSessionRecord.buyer_ref == buyer_ref)
                .order_by(CheckoutSessionRecord.updated_at.desc())
            )
            if not include_archived:
                query = query.where(CheckoutSessionRecord.archived.is_(False))
            rows = session.execute(
                query.limit(max(1, limit)).offset(max(0, offset))
            ).all()
            return [
                CheckoutSessionListItem(
                    session_id=row[0],
                    title=row[1],
                    status=CheckoutSessionStatus(row[2]),
                    archived=bool(row[3]),
                    created_at=_as_aware_utc(row[4]),
                    updated_at=_as_aware_utc(row[5]),
                    order_id=row[6],
                    trace_id=row[7],
                    budget_paise=row[8],
                    message=row[9],
                    message_count=int(row[10] or 0),
                )
                for row in rows
            ]

    def set_archived(
        self, session_id: str, merchant_id: str, archived: bool
    ) -> CheckoutSession | None:
        """Toggle the soft-archive flag. Foreign ids return None (404 upstream).

        Archiving also abandons an ACTIVE row (same as delete): an archived
        row must never answer ``active_for`` and must never collide with a
        fresh session via the partial unique index. Unarchiving restores
        visibility; the row stays ABANDONED, i.e. read-only history.
        """
        with Session(self._engine) as session:
            record = session.get(CheckoutSessionRecord, session_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            record.archived = archived
            if archived and record.status == CheckoutSessionStatus.ACTIVE.value:
                record.status = CheckoutSessionStatus.ABANDONED.value
            record.updated_at = datetime.now(timezone.utc)
            session.commit()
            return self._to_session(record)

    def delete(self, session_id: str, merchant_id: str) -> CheckoutSession | None:
        """Soft-delete a chat-history row: archive it, and abandon it if still
        ACTIVE so it can never be resumed or receive further writes.

        HARD-DELETES NOTHING: the row stays in the database (archived), and
        linked commerce records — orders, ledger events, refunds, consents —
        are never touched. Foreign ids return None (404 upstream).
        """
        with Session(self._engine) as session:
            record = session.get(CheckoutSessionRecord, session_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            record.archived = True
            if record.status == CheckoutSessionStatus.ACTIVE.value:
                record.status = CheckoutSessionStatus.ABANDONED.value
            record.updated_at = datetime.now(timezone.utc)
            session.commit()
            return self._to_session(record)


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
