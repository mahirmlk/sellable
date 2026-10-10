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
from sellable.auth import NONCE_TTL_SECONDS
from sellable.ledger.database import (
    AgentNonceRecord,
    BuyerMissionRecord,
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

    def list_all(self, *, limit: int = 100) -> list[MerchantRecord]:
        """All merchants for platform administration (admin surface only —
        never merchant-scoped reads)."""
        with Session(self._engine) as session:
            query = (
                select(MerchantRecord)
                .order_by(MerchantRecord.created_at.desc())
                .limit(max(1, min(limit, 500)))
            )
            return list(session.scalars(query).all())

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

    def all(self, merchant_id: str | None = None, *, limit: int = 500, offset: int = 0) -> list[Order]:
        """Newest-first orders, bounded so dashboards never full-scan history."""
        with Session(self._engine) as session:
            query = select(OrderRecord).order_by(OrderRecord.created_at.desc())
            if merchant_id is not None:
                query = query.where(OrderRecord.merchant_id == merchant_id)
            records = session.scalars(
                query.offset(max(0, offset)).limit(max(1, limit))
            ).all()
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

    def claim(self, agent_id: str, nonce: str, *, ttl_seconds: int = NONCE_TTL_SECONDS) -> bool:
        """Return True exactly once per (agent, nonce) pair.

        Stale rows (older than the timestamp window) are pruned on each
        claim so the table stays tiny. The TTL is the shared
        ``NONCE_TTL_SECONDS`` so the persistent claim agrees with the
        in-memory replay guard and the timestamp acceptance window.
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
    #: Persisted quote/decision snapshot caps (bytes of UTF-8 JSON each).
    #: Money-safe to reject: checkout always re-quotes server-side, so an
    #: oversized client snapshot is never needed — and unbounded JSON blobs
    #: would let one merchant bloat the shared sessions table.
    MAX_CART_JSON_BYTES = 32_768
    MAX_DECISION_JSON_BYTES = 32_768

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

    def upsert_many(self, products: list[Product]) -> dict[str, int]:
        """Connector sync primitive: insert missing SKUs, refresh existing
        rows in place. Returns {"inserted": n, "updated": m}."""
        inserted = updated = 0
        with Session(self._engine) as session:
            for product in products:
                row_id = self._row_id(product.merchant_id, product.sku)
                existing = session.get(CatalogProductRecord, row_id)
                if existing is None:
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
                    inserted += 1
                else:
                    existing.title = product.title
                    existing.description = product.description
                    existing.price_paise = product.price_paise
                    existing.floor_paise = product.floor_paise
                    existing.stock = product.stock
                    existing.category = product.category
                    existing.attributes = product.attributes
                    updated += 1
            session.commit()
        return {"inserted": inserted, "updated": updated}


class BuyerMissionRepository:
    """Persists buyer-mission pointer rows (merchant + trace scoped)."""

    def __init__(self, engine: object | None = None) -> None:
        self._engine = engine or make_engine()

    def save(
        self,
        *,
        mission_id: str,
        merchant_id: str,
        trace_id: str,
        buyer_agent_id: str,
        order_id: str | None,
        consent_id: str | None,
        current_state: str,
        mission_message: str,
        budget_paise: int | None,
        requested_sku: str | None,
        quantity: int,
        buyer_offer_paise: int | None,
        negotiated_amount_paise: int | None,
    ) -> BuyerMissionRecord:
        now = datetime.now(timezone.utc)
        # expire_on_commit=False: attributes are read after the session
        # closes (same reason as AgentApiKeyRepository).
        with Session(self._engine, expire_on_commit=False) as session:
            existing = session.get(BuyerMissionRecord, mission_id)
            if existing is None:
                # Trace-keyed replay: a repeated run under the same trace
                # updates the SAME mission instead of forking a new row.
                existing = (
                    session.query(BuyerMissionRecord)
                    .filter(
                        BuyerMissionRecord.merchant_id == merchant_id,
                        BuyerMissionRecord.trace_id == trace_id,
                    )
                    .first()
                )
            if existing is None:
                record = BuyerMissionRecord(
                    mission_id=mission_id,
                    merchant_id=merchant_id,
                    trace_id=trace_id,
                    buyer_agent_id=buyer_agent_id,
                    order_id=order_id,
                    consent_id=consent_id,
                    current_state=current_state,
                    mission_message=mission_message,
                    budget_paise=budget_paise,
                    requested_sku=requested_sku,
                    quantity=quantity,
                    buyer_offer_paise=buyer_offer_paise,
                    negotiated_amount_paise=negotiated_amount_paise,
                    created_at=now,
                    updated_at=now,
                )
                session.add(record)
            else:
                existing.buyer_agent_id = buyer_agent_id
                if order_id:
                    existing.order_id = order_id
                if consent_id:
                    existing.consent_id = consent_id
                existing.current_state = current_state
                existing.mission_message = mission_message
                existing.budget_paise = budget_paise
                existing.requested_sku = requested_sku
                existing.quantity = quantity
                existing.buyer_offer_paise = buyer_offer_paise
                if negotiated_amount_paise is not None:
                    existing.negotiated_amount_paise = negotiated_amount_paise
                existing.updated_at = now
                record = existing
            session.commit()
            return record

    def touch(
        self,
        mission_id: str,
        merchant_id: str,
        *,
        current_state: str | None = None,
        consent_id: str | None = None,
    ) -> BuyerMissionRecord | None:
        """Update the pointer columns (never money state) on a mission row."""
        with Session(self._engine, expire_on_commit=False) as session:
            record = session.get(BuyerMissionRecord, mission_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            if current_state:
                record.current_state = current_state
            if consent_id:
                record.consent_id = consent_id
            record.updated_at = datetime.now(timezone.utc)
            session.commit()
            return record

    def get(self, mission_id: str, merchant_id: str) -> BuyerMissionRecord | None:
        with Session(self._engine) as session:
            record = session.get(BuyerMissionRecord, mission_id)
            if record is None or record.merchant_id != merchant_id:
                # Foreign ids are invisible — same 404 semantics as orders.
                return None
            return record

    def for_order(self, merchant_id: str, order_id: str) -> BuyerMissionRecord | None:
        with Session(self._engine) as session:
            query = (
                select(BuyerMissionRecord)
                .where(BuyerMissionRecord.merchant_id == merchant_id)
                .where(BuyerMissionRecord.order_id == order_id)
                .order_by(BuyerMissionRecord.updated_at.desc())
            )
            return session.scalars(query.limit(1)).first()

    def list_for_merchant(
        self, merchant_id: str, *, limit: int = 20
    ) -> list[BuyerMissionRecord]:
        with Session(self._engine) as session:
            query = (
                select(BuyerMissionRecord)
                .where(BuyerMissionRecord.merchant_id == merchant_id)
                .order_by(BuyerMissionRecord.created_at.desc())
                .limit(max(1, min(limit, 100)))
            )
            return list(session.scalars(query).all())


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


def _delegation_to_grant(record: Any) -> Any:
    from sellable.delegations import DelegationGrant, DelegationStatus, OperationScope

    return DelegationGrant(
        delegation_id=record.delegation_id,
        principal_customer_id=record.principal_customer_id,
        subject_agent_id=record.subject_agent_id,
        merchant_scope=record.merchant_id,
        operation_scopes=[OperationScope(s) for s in record.operation_scopes_json],
        category_scopes=list(record.category_scopes_json),
        amount_limit_paise=record.amount_limit_paise,
        currency=record.currency,
        frequency_limit=record.frequency_limit,
        approval_mode=record.approval_mode,
        valid_from=_as_aware_utc(record.valid_from),
        expires_at=_as_aware_utc(record.expires_at),
        status=DelegationStatus(record.status),
        created_at=_as_aware_utc(record.created_at),
        revoked_at=_as_aware_utc(record.revoked_at) if record.revoked_at else None,
    )


class DelegationRepository:
    """Persistence for bounded customer→agent delegation grants (§14.2)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import DelegationRecord

        self._record_cls = DelegationRecord
        self._engine = engine or make_engine()

    def save(self, grant: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, grant.delegation_id)
            if existing:
                existing.merchant_id = grant.merchant_scope
                existing.principal_customer_id = grant.principal_customer_id
                existing.subject_agent_id = grant.subject_agent_id
                existing.operation_scopes_json = [s.value for s in grant.operation_scopes]
                existing.category_scopes_json = list(grant.category_scopes)
                existing.amount_limit_paise = grant.amount_limit_paise
                existing.currency = grant.currency
                existing.frequency_limit = grant.frequency_limit
                existing.approval_mode = grant.approval_mode.value
                existing.valid_from = grant.valid_from
                existing.expires_at = grant.expires_at
                existing.status = grant.status.value
                existing.created_at = grant.created_at
                existing.revoked_at = grant.revoked_at
            else:
                session.add(
                    self._record_cls(
                        delegation_id=grant.delegation_id,
                        merchant_id=grant.merchant_scope,
                        principal_customer_id=grant.principal_customer_id,
                        subject_agent_id=grant.subject_agent_id,
                        operation_scopes_json=[s.value for s in grant.operation_scopes],
                        category_scopes_json=list(grant.category_scopes),
                        amount_limit_paise=grant.amount_limit_paise,
                        currency=grant.currency,
                        frequency_limit=grant.frequency_limit,
                        approval_mode=grant.approval_mode.value,
                        valid_from=grant.valid_from,
                        expires_at=grant.expires_at,
                        status=grant.status.value,
                        created_at=grant.created_at,
                        revoked_at=grant.revoked_at,
                    )
                )
            session.commit()

    def get(self, delegation_id: str) -> Any | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, delegation_id)
            return _delegation_to_grant(record) if record else None

    def active_for_agent(self, merchant_id: str, agent_id: str) -> list[Any]:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.subject_agent_id == agent_id)
                .where(self._record_cls.status == "ACTIVE")
                .order_by(self._record_cls.created_at.desc())
            )
            return [_delegation_to_grant(r) for r in session.scalars(query).all()]

    def revoke(self, delegation_id: str, merchant_id: str) -> Any:
        """Soft-revoke a grant. Foreign ids stay invisible (LookupError)."""
        with Session(self._engine, expire_on_commit=False) as session:
            record = session.get(self._record_cls, delegation_id)
            if record is None or record.merchant_id != merchant_id:
                raise LookupError(f"Unknown delegation: {delegation_id}")
            record.status = "REVOKED"
            record.revoked_at = datetime.now(timezone.utc)
            session.commit()
            return _delegation_to_grant(record)

    def history_for_principal(self, merchant_id: str, customer_id: str) -> list[Any]:
        """All grants (active and revoked) where the customer is principal —
        the customer-trust history source."""
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.principal_customer_id == customer_id)
                .order_by(self._record_cls.created_at.desc())
            )
            return [_delegation_to_grant(r) for r in session.scalars(query).all()]


class AgentIdentityRepository:
    """Agent registry + reputation persistence (target §13)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import AgentIdentityRecord, AgentReputationRecord

        self._identity_cls = AgentIdentityRecord
        self._reputation_cls = AgentReputationRecord
        self._engine = engine or make_engine()

    def register(self, identity: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._identity_cls, identity.agent_id)
            if existing:
                existing.agent_type = identity.agent_type.value
                existing.owner_id = identity.owner_id
                existing.issuer = identity.issuer
                existing.client_id = identity.client_id
                existing.credential_status = identity.credential_status.value
                existing.credential_expires_at = identity.credential_expires_at
                existing.capability_profile = identity.capability_profile
                existing.last_seen_at = identity.last_seen_at
            else:
                session.add(
                    self._identity_cls(
                        agent_id=identity.agent_id,
                        agent_type=identity.agent_type.value,
                        owner_id=identity.owner_id,
                        issuer=identity.issuer,
                        client_id=identity.client_id,
                        credential_status=identity.credential_status.value,
                        credential_expires_at=identity.credential_expires_at,
                        capability_profile=identity.capability_profile,
                        created_at=identity.created_at,
                        last_seen_at=identity.last_seen_at,
                    )
                )
            session.commit()

    def get(self, agent_id: str) -> Any | None:
        from sellable.agent_identity import AgentIdentity, AgentType, CredentialStatus

        with Session(self._engine) as session:
            record = session.get(self._identity_cls, agent_id)
            if not record:
                return None
            return AgentIdentity(
                agent_id=record.agent_id,
                agent_type=AgentType(record.agent_type),
                owner_id=record.owner_id,
                issuer=record.issuer,
                client_id=record.client_id,
                credential_status=CredentialStatus(record.credential_status),
                credential_expires_at=(
                    _as_aware_utc(record.credential_expires_at)
                    if record.credential_expires_at
                    else None
                ),
                capability_profile=record.capability_profile,
                created_at=_as_aware_utc(record.created_at),
                last_seen_at=(
                    _as_aware_utc(record.last_seen_at) if record.last_seen_at else None
                ),
            )

    def touch_last_seen(self, agent_id: str) -> None:
        with Session(self._engine) as session:
            record = session.get(self._identity_cls, agent_id)
            if record is None:
                return
            record.last_seen_at = datetime.now(timezone.utc)
            session.commit()

    def save_reputation(self, reputation: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._reputation_cls, reputation.agent_id)
            values = {
                "successful_transactions": reputation.successful_transactions,
                "failed_transactions": reputation.failed_transactions,
                "policy_denials": reputation.policy_denials,
                "fraud_flags": reputation.fraud_flags,
                "abuse_flags": reputation.abuse_flags,
                "authorization_failures": reputation.authorization_failures,
                "average_order_value_paise": reputation.average_order_value_paise,
                "support_incidents": reputation.support_incidents,
                "merchant_acceptance_rate_bps": reputation.merchant_acceptance_rate_bps,
                "customer_complaints": reputation.customer_complaints,
                "reputation_score_bps": reputation.reputation_score_bps,
                "score_confidence_bps": reputation.score_confidence_bps,
                "last_updated_at": reputation.last_updated_at,
            }
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
            else:
                session.add(self._reputation_cls(agent_id=reputation.agent_id, **values))
            session.commit()

    def reputation(self, agent_id: str) -> Any | None:
        from sellable.agent_identity import AgentReputation

        with Session(self._engine) as session:
            record = session.get(self._reputation_cls, agent_id)
            if not record:
                return None
            return AgentReputation(
                agent_id=record.agent_id,
                successful_transactions=record.successful_transactions,
                failed_transactions=record.failed_transactions,
                policy_denials=record.policy_denials,
                fraud_flags=record.fraud_flags,
                abuse_flags=record.abuse_flags,
                authorization_failures=record.authorization_failures,
                average_order_value_paise=record.average_order_value_paise,
                support_incidents=record.support_incidents,
                merchant_acceptance_rate_bps=record.merchant_acceptance_rate_bps,
                customer_complaints=record.customer_complaints,
                reputation_score_bps=record.reputation_score_bps,
                score_confidence_bps=record.score_confidence_bps,
                last_updated_at=_as_aware_utc(record.last_updated_at),
            )


class MerchantOnboardingRepository:
    """Onboarding stage pointer persistence (target §10)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import MerchantOnboardingRecord

        self._record_cls = MerchantOnboardingRecord
        self._engine = engine or make_engine()

    def save(self, onboarding: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, onboarding.merchant_id)
            if existing:
                existing.stage = onboarding.stage.value
                existing.completed_checks_json = list(onboarding.completed_checks)
                existing.updated_at = onboarding.updated_at
            else:
                session.add(
                    self._record_cls(
                        merchant_id=onboarding.merchant_id,
                        stage=onboarding.stage.value,
                        completed_checks_json=list(onboarding.completed_checks),
                        updated_at=onboarding.updated_at,
                    )
                )
            session.commit()

    def get(self, merchant_id: str) -> Any | None:
        from sellable.onboarding import MerchantOnboarding, OnboardingStage

        with Session(self._engine) as session:
            record = session.get(self._record_cls, merchant_id)
            if not record:
                return None
            return MerchantOnboarding(
                merchant_id=record.merchant_id,
                stage=OnboardingStage(record.stage),
                completed_checks=list(record.completed_checks_json),
                updated_at=_as_aware_utc(record.updated_at),
            )


class OutboxRepository:
    """Transactional-outbox queue for the future Event Bus (target §27)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import OutboxEventRecord

        self._record_cls = OutboxEventRecord
        self._engine = engine or make_engine()

    def publish(self, event: Any) -> None:
        with Session(self._engine) as session:
            session.add(
                self._record_cls(
                    event_id=event.event_id,
                    event_type=event.event_type,
                    event_version=event.event_version,
                    occurred_at=event.occurred_at,
                    tenant_id=event.tenant_id,
                    merchant_id=event.merchant_id,
                    aggregate_type=event.aggregate_type,
                    aggregate_id=event.aggregate_id,
                    trace_id=event.trace_id,
                    actor_type=event.actor.type,
                    actor_id=event.actor.id,
                    data_json=dict(event.data),
                )
            )
            session.commit()

    def claim_unpublished(
        self, *, limit: int = 100, merchant_id: str | None = None
    ) -> list[Any]:
        """Oldest deliverable envelopes first: unpublished, not
        dead-lettered. Merchant consoles drain their own store; the
        platform drain takes everything."""
        from sellable.events import EventActor, PlatformEvent

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.published_at.is_(None))
                .where(self._record_cls.dead_lettered.is_(False))
                .order_by(self._record_cls.occurred_at.asc())
                .limit(max(1, min(limit, 1000)))
            )
            if merchant_id is not None:
                query = query.where(self._record_cls.merchant_id == merchant_id)
            return [
                PlatformEvent(
                    event_id=r.event_id,
                    event_type=r.event_type,
                    event_version=r.event_version,
                    occurred_at=_as_aware_utc(r.occurred_at),
                    tenant_id=r.tenant_id,
                    merchant_id=r.merchant_id,
                    aggregate_type=r.aggregate_type,
                    aggregate_id=r.aggregate_id,
                    trace_id=r.trace_id,
                    actor=EventActor(type=r.actor_type, id=r.actor_id),
                    data=dict(r.data_json),
                )
                for r in session.scalars(query).all()
            ]

    def mark_published(self, event_id: str) -> None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, event_id)
            if record is None:
                return
            record.published_at = datetime.now(timezone.utc)
            session.commit()

    def mark_failed(self, event_id: str, error: str) -> int:
        """Record a failed consumer delivery; returns the attempt count."""
        with Session(self._engine, expire_on_commit=False) as session:
            record = session.get(self._record_cls, event_id)
            if record is None:
                return 0
            record.attempts = (record.attempts or 0) + 1
            record.last_error = error[:500]
            session.commit()
            return record.attempts

    def mark_dead_letter(self, event_id: str, error: str) -> None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, event_id)
            if record is None:
                return
            record.dead_lettered = True
            record.last_error = error[:500]
            session.commit()

    def reset_delivery(self, event_id: str, merchant_id: str) -> bool:
        """Requeue a dead-lettered event for redelivery (ops replay)."""
        with Session(self._engine) as session:
            record = session.get(self._record_cls, event_id)
            if record is None or record.merchant_id != merchant_id:
                return False
            record.dead_lettered = False
            record.attempts = 0
            record.last_error = None
            record.published_at = None
            session.commit()
            return True

    def pending_count(self, merchant_id: str | None = None) -> int:
        from sqlalchemy import func

        with Session(self._engine) as session:
            query = select(func.count()).select_from(self._record_cls).where(
                self._record_cls.published_at.is_(None)
            ).where(
                self._record_cls.dead_lettered.is_(False)
            )
            if merchant_id is not None:
                query = query.where(self._record_cls.merchant_id == merchant_id)
            result = session.execute(query).scalar()
            return int(result or 0)

    def dead_letter_count(self, merchant_id: str | None = None) -> int:
        from sqlalchemy import func

        with Session(self._engine) as session:
            query = select(func.count()).select_from(self._record_cls).where(
                self._record_cls.dead_lettered.is_(True)
            )
            if merchant_id is not None:
                query = query.where(self._record_cls.merchant_id == merchant_id)
            result = session.execute(query).scalar()
            return int(result or 0)

    def list_dead_letters(
        self, merchant_id: str | None = None, *, limit: int = 50
    ) -> list[dict[str, object]]:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.dead_lettered.is_(True))
                .order_by(self._record_cls.occurred_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            if merchant_id is not None:
                query = query.where(self._record_cls.merchant_id == merchant_id)
            return [
                {
                    "event_id": r.event_id,
                    "event_type": r.event_type,
                    "merchant_id": r.merchant_id,
                    "aggregate_type": r.aggregate_type,
                    "aggregate_id": r.aggregate_id,
                    "trace_id": r.trace_id,
                    "attempts": r.attempts,
                    "last_error": r.last_error,
                    "occurred_at": _as_aware_utc(r.occurred_at).isoformat(),
                }
                for r in session.scalars(query).all()
            ]


def _cart_to_contract(header: Any, lines: list[Any]) -> Any:
    from sellable.contracts import Cart, CartLine, CartStatus

    return Cart(
        cart_id=header.cart_id,
        merchant_id=header.merchant_id,
        customer_id=header.customer_id,
        agent_session_id=header.agent_session_id,
        items=[
            CartLine(
                sku=line.sku,
                quantity=line.quantity,
                unit_price_paise=line.unit_price_paise,
            )
            for line in sorted(lines, key=lambda row: row.sku)
        ],
        subtotal_paise=header.subtotal_paise,
        discount_total_paise=header.discount_total_paise,
        tax_total_paise=header.tax_total_paise,
        shipping_total_paise=header.shipping_total_paise,
        grand_total_paise=header.grand_total_paise,
        status=CartStatus(header.status),
        version=header.version,
        expires_at=_as_aware_utc(header.expires_at),
        created_at=_as_aware_utc(header.created_at),
        updated_at=_as_aware_utc(header.updated_at),
    )


class CartRepository:
    """Persistence for versioned carts (target §18.2). Saves are atomic
    compare-and-swap on ``version`` so a stale writer cannot silently
    overwrite a newer cart (§45: no stale price becomes authoritative)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import CartItemRecord, CartRecord

        self._header_cls = CartRecord
        self._line_cls = CartItemRecord
        self._engine = engine or make_engine()

    def create(self, cart: Any) -> None:
        with Session(self._engine) as session:
            session.add(
                self._header_cls(
                    cart_id=cart.cart_id,
                    merchant_id=cart.merchant_id,
                    customer_id=cart.customer_id,
                    agent_session_id=cart.agent_session_id,
                    status=cart.status.value,
                    version=cart.version,
                    subtotal_paise=cart.subtotal_paise,
                    discount_total_paise=cart.discount_total_paise,
                    tax_total_paise=cart.tax_total_paise,
                    shipping_total_paise=cart.shipping_total_paise,
                    grand_total_paise=cart.grand_total_paise,
                    expires_at=cart.expires_at,
                    created_at=cart.created_at,
                    updated_at=cart.updated_at,
                )
            )
            for line in cart.items:
                session.add(
                    self._line_cls(
                        cart_id=cart.cart_id,
                        sku=line.sku,
                        quantity=line.quantity,
                        unit_price_paise=line.unit_price_paise,
                    )
                )
            session.commit()

    def get(self, cart_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            header = session.get(self._header_cls, cart_id)
            if header is None or header.merchant_id != merchant_id:
                # Foreign ids are invisible — same 404 semantics as orders.
                return None
            lines = (
                session.query(self._line_cls)
                .filter(self._line_cls.cart_id == cart_id)
                .all()
            )
            return _cart_to_contract(header, lines)

    def save(self, cart: Any, *, expected_version: int) -> Any:
        """Compare-and-swap: applies only when the stored version still
        matches what the caller read, and bumps it by exactly one."""
        from sellable.cart import CartNotFoundError, CartVersionConflictError

        with Session(self._engine) as session:
            updated_rows = (
                session.query(self._header_cls)
                .filter(self._header_cls.cart_id == cart.cart_id)
                .filter(self._header_cls.version == expected_version)
                .update(
                    {
                        self._header_cls.status: cart.status.value,
                        self._header_cls.version: expected_version + 1,
                        self._header_cls.subtotal_paise: cart.subtotal_paise,
                        self._header_cls.discount_total_paise: cart.discount_total_paise,
                        self._header_cls.tax_total_paise: cart.tax_total_paise,
                        self._header_cls.shipping_total_paise: cart.shipping_total_paise,
                        self._header_cls.grand_total_paise: cart.grand_total_paise,
                        self._header_cls.updated_at: cart.updated_at,
                    },
                    synchronize_session=False,
                )
            )
            if updated_rows == 0:
                exists = session.get(self._header_cls, cart.cart_id)
                if exists is None or exists.merchant_id != cart.merchant_id:
                    raise CartNotFoundError(f"Unknown cart: {cart.cart_id}")
                raise CartVersionConflictError(
                    f"cart version {exists.version} does not match "
                    f"expected {expected_version}"
                )
            session.query(self._line_cls).filter(
                self._line_cls.cart_id == cart.cart_id
            ).delete(synchronize_session=False)
            for line in cart.items:
                session.add(
                    self._line_cls(
                        cart_id=cart.cart_id,
                        sku=line.sku,
                        quantity=line.quantity,
                        unit_price_paise=line.unit_price_paise,
                    )
                )
            session.commit()
            return cart.model_copy(update={"version": expected_version + 1})

    def list_active(self, merchant_id: str) -> list[Any]:
        """Non-terminal carts for sweeps and session views."""
        with Session(self._engine) as session:
            query = (
                select(self._header_cls)
                .where(self._header_cls.merchant_id == merchant_id)
                .where(
                    self._header_cls.status.in_(["ACTIVE", "CHECKOUT_STARTED"])
                )
                .order_by(self._header_cls.updated_at.desc())
            )
            headers = session.scalars(query).all()
            carts = []
            for header in headers:
                lines = (
                    session.query(self._line_cls)
                    .filter(self._line_cls.cart_id == header.cart_id)
                    .all()
                )
                carts.append(_cart_to_contract(header, lines))
            return carts


def _promotion_to_contract(record: Any) -> Any:
    from sellable.contracts import Promotion, PromotionStatus, PromotionType, StackingRule

    return Promotion(
        promotion_id=record.promotion_id,
        merchant_id=record.merchant_id,
        kind=PromotionType(record.kind),
        status=PromotionStatus(record.status),
        title=record.title,
        start_at=_as_aware_utc(record.start_at),
        end_at=_as_aware_utc(record.end_at) if record.end_at else None,
        coupon_code=record.coupon_code,
        percent_bps=record.percent_bps,
        amount_paise=record.amount_paise,
        buy_sku=record.buy_sku,
        buy_quantity=record.buy_quantity,
        get_quantity=record.get_quantity,
        bundle_skus=list(record.bundle_skus_json),
        bundle_amount_paise=record.bundle_amount_paise,
        volume_sku=record.volume_sku,
        volume_min_quantity=record.volume_min_quantity,
        min_cart_total_paise=record.min_cart_total_paise,
        max_discount_paise=record.max_discount_paise,
        stacking=StackingRule(record.stacking),
        budget_limit_paise=record.budget_limit_paise,
        redemption_limit=record.redemption_limit,
        product_skus=list(record.product_skus_json),
        categories=list(record.categories_json),
        customer_ids=list(record.customer_ids_json),
        channels=list(record.channels_json),
        free_shipping=bool(record.free_shipping),
        priority=record.priority,
    )


class PromotionRepository:
    """Promotion definitions + redemption accounting (§20.4 budget/cap engine)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            PromotionCampaignRecord,
            PromotionRedemptionRecord,
        )

        self._campaign_cls = PromotionCampaignRecord
        self._redemption_cls = PromotionRedemptionRecord
        self._engine = engine or make_engine()

    def save(self, promotion: Any) -> None:
        now = datetime.now(timezone.utc)
        with Session(self._engine) as session:
            existing = session.get(self._campaign_cls, promotion.promotion_id)
            values = {
                "merchant_id": promotion.merchant_id,
                "kind": promotion.kind.value,
                "status": promotion.status.value,
                "title": promotion.title,
                "start_at": promotion.start_at,
                "end_at": promotion.end_at,
                "coupon_code": promotion.coupon_code,
                "percent_bps": promotion.percent_bps,
                "amount_paise": promotion.amount_paise,
                "buy_sku": promotion.buy_sku,
                "buy_quantity": promotion.buy_quantity,
                "get_quantity": promotion.get_quantity,
                "bundle_skus_json": list(promotion.bundle_skus),
                "bundle_amount_paise": promotion.bundle_amount_paise,
                "volume_sku": promotion.volume_sku,
                "volume_min_quantity": promotion.volume_min_quantity,
                "min_cart_total_paise": promotion.min_cart_total_paise,
                "max_discount_paise": promotion.max_discount_paise,
                "stacking": promotion.stacking.value,
                "budget_limit_paise": promotion.budget_limit_paise,
                "redemption_limit": promotion.redemption_limit,
                "product_skus_json": list(promotion.product_skus),
                "categories_json": list(promotion.categories),
                "customer_ids_json": list(promotion.customer_ids),
                "channels_json": list(promotion.channels),
                "free_shipping": promotion.free_shipping,
                "priority": promotion.priority,
                "updated_at": now,
            }
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
            else:
                session.add(
                    self._campaign_cls(promotion_id=promotion.promotion_id, created_at=now, **values)
                )
            session.commit()

    def get(self, promotion_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            record = session.get(self._campaign_cls, promotion_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return _promotion_to_contract(record)

    def active_for_merchant(self, merchant_id: str) -> list[Any]:
        with Session(self._engine) as session:
            query = (
                select(self._campaign_cls)
                .where(self._campaign_cls.merchant_id == merchant_id)
                .where(self._campaign_cls.status == "ACTIVE")
                .order_by(
                    self._campaign_cls.priority.desc(),
                    self._campaign_cls.promotion_id.asc(),
                )
            )
            return [_promotion_to_contract(r) for r in session.scalars(query).all()]

    def record_redemption(
        self, *, promotion_id: str, merchant_id: str, checkout_id: str, discount_paise: int
    ) -> None:
        from sellable.contracts import new_id

        with Session(self._engine) as session:
            session.add(
                self._redemption_cls(
                    redemption_id=new_id("red"),
                    promotion_id=promotion_id,
                    merchant_id=merchant_id,
                    checkout_id=checkout_id,
                    discount_paise=discount_paise,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def usage(self, merchant_id: str) -> dict[str, dict[str, int]]:
        """Per-promotion ``{"count": n, "discount_paise": total}`` for the
        budget/cap engine. Only completed-checkout redemptions are recorded,
        so priced-but-abandoned checkouts never consume budget."""
        from sqlalchemy import func

        with Session(self._engine) as session:
            query = (
                select(
                    self._redemption_cls.promotion_id,
                    func.count().label("redemptions"),
                    func.coalesce(func.sum(self._redemption_cls.discount_paise), 0).label(
                        "discount"
                    ),
                )
                .where(self._redemption_cls.merchant_id == merchant_id)
                .group_by(self._redemption_cls.promotion_id)
            )
            return {
                row.promotion_id: {
                    "count": int(row.redemptions),
                    "discount_paise": int(row.discount),
                }
                for row in session.execute(query).all()
            }


def _quote_to_contract(header: Any, lines: list[Any]) -> Any:
    from sellable.contracts import Quote, QuoteLine, QuoteStatus

    return Quote(
        quote_id=header.quote_id,
        merchant_id=header.merchant_id,
        cart_id=header.cart_id,
        customer_id=header.customer_id,
        agent_session_id=header.agent_session_id,
        lines=sorted(
            (
                QuoteLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    base_unit_paise=line.base_unit_paise,
                    negotiated_unit_paise=line.negotiated_unit_paise,
                )
                for line in lines
            ),
            key=lambda line: line.sku,
        ),
        base_subtotal_paise=header.base_subtotal_paise,
        negotiated_subtotal_paise=header.negotiated_subtotal_paise,
        applied_promotion_ids=list(header.applied_promotion_ids_json),
        promotion_discount_paise=header.promotion_discount_paise,
        round_number=header.round_number,
        status=QuoteStatus(header.status),
        expires_at=_as_aware_utc(header.expires_at),
        created_at=_as_aware_utc(header.created_at),
        updated_at=_as_aware_utc(header.updated_at),
    )


class QuoteRepository:
    """Bounded-offer snapshots (§18.3). Quotes are merchant offers: only the
    negotiation service mutates them, within floor/round bounds."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import QuoteItemRecord, QuoteRecord

        self._header_cls = QuoteRecord
        self._line_cls = QuoteItemRecord
        self._engine = engine or make_engine()

    def save(self, quote: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._header_cls, quote.quote_id)
            if existing:
                existing.base_subtotal_paise = quote.base_subtotal_paise
                existing.negotiated_subtotal_paise = quote.negotiated_subtotal_paise
                existing.applied_promotion_ids_json = list(quote.applied_promotion_ids)
                existing.promotion_discount_paise = quote.promotion_discount_paise
                existing.round_number = quote.round_number
                existing.status = quote.status.value
                existing.expires_at = quote.expires_at
                existing.updated_at = quote.updated_at
                session.query(self._line_cls).filter(
                    self._line_cls.quote_id == quote.quote_id
                ).delete(synchronize_session=False)
            else:
                session.add(
                    self._header_cls(
                        quote_id=quote.quote_id,
                        merchant_id=quote.merchant_id,
                        cart_id=quote.cart_id,
                        customer_id=quote.customer_id,
                        agent_session_id=quote.agent_session_id,
                        base_subtotal_paise=quote.base_subtotal_paise,
                        negotiated_subtotal_paise=quote.negotiated_subtotal_paise,
                        applied_promotion_ids_json=list(quote.applied_promotion_ids),
                        promotion_discount_paise=quote.promotion_discount_paise,
                        round_number=quote.round_number,
                        status=quote.status.value,
                        expires_at=quote.expires_at,
                        created_at=quote.created_at,
                        updated_at=quote.updated_at,
                    )
                )
            for line in quote.lines:
                session.add(
                    self._line_cls(
                        quote_id=quote.quote_id,
                        sku=line.sku,
                        quantity=line.quantity,
                        base_unit_paise=line.base_unit_paise,
                        negotiated_unit_paise=line.negotiated_unit_paise,
                    )
                )
            session.commit()

    def get(self, quote_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            header = session.get(self._header_cls, quote_id)
            if header is None or header.merchant_id != merchant_id:
                return None
            lines = (
                session.query(self._line_cls)
                .filter(self._line_cls.quote_id == quote_id)
                .all()
            )
            return _quote_to_contract(header, lines)


def _checkout_to_contract(header: Any, lines: list[Any]) -> Any:
    from sellable.contracts import Checkout, CheckoutLine, CheckoutStatus

    return Checkout(
        checkout_id=header.checkout_id,
        merchant_id=header.merchant_id,
        customer_id=header.customer_id,
        agent_session_id=header.agent_session_id,
        cart_id=header.cart_id,
        cart_version=header.cart_version,
        quote_id=header.quote_id,
        delegation_id=header.delegation_id,
        lines=sorted(
            (
                CheckoutLine(
                    sku=line.sku,
                    quantity=line.quantity,
                    unit_price_paise=line.unit_price_paise,
                )
                for line in lines
            ),
            key=lambda line: line.sku,
        ),
        subtotal_paise=header.subtotal_paise,
        discount_total_paise=header.discount_total_paise,
        tax_total_paise=header.tax_total_paise,
        shipping_total_paise=header.shipping_total_paise,
        grand_total_paise=max(header.grand_total_paise, 1),
        applied_promotion_ids=list(header.applied_promotion_ids_json),
        promotion_discounts=dict(header.promotion_discounts_json or {}),
        free_shipping_applied=bool(header.free_shipping_applied),
        status=CheckoutStatus(header.status),
        risk_reference=header.risk_reference,
        authorization_id=header.authorization_id,
        price_hash=header.price_hash,
        order_id=header.order_id,
        expires_at=_as_aware_utc(header.expires_at),
        created_at=_as_aware_utc(header.created_at),
        updated_at=_as_aware_utc(header.updated_at),
    )


class CheckoutRepository:
    """Checkout sessions + append-only transition log (§18.4, §38)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            CheckoutEventRecord,
            CheckoutLineRecord,
            CheckoutRecord,
        )

        self._header_cls = CheckoutRecord
        self._line_cls = CheckoutLineRecord
        self._event_cls = CheckoutEventRecord
        self._engine = engine or make_engine()

    def save(self, checkout: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._header_cls, checkout.checkout_id)
            if existing:
                existing.cart_version = checkout.cart_version
                existing.quote_id = checkout.quote_id
                existing.delegation_id = checkout.delegation_id
                existing.subtotal_paise = checkout.subtotal_paise
                existing.discount_total_paise = checkout.discount_total_paise
                existing.tax_total_paise = checkout.tax_total_paise
                existing.shipping_total_paise = checkout.shipping_total_paise
                existing.grand_total_paise = checkout.grand_total_paise
                existing.applied_promotion_ids_json = list(checkout.applied_promotion_ids)
                existing.promotion_discounts_json = dict(checkout.promotion_discounts)
                existing.free_shipping_applied = checkout.free_shipping_applied
                existing.status = checkout.status.value
                existing.risk_reference = checkout.risk_reference
                existing.authorization_id = checkout.authorization_id
                existing.price_hash = checkout.price_hash
                existing.order_id = checkout.order_id
                existing.expires_at = checkout.expires_at
                existing.updated_at = checkout.updated_at
                session.query(self._line_cls).filter(
                    self._line_cls.checkout_id == checkout.checkout_id
                ).delete(synchronize_session=False)
            else:
                session.add(
                    self._header_cls(
                        checkout_id=checkout.checkout_id,
                        merchant_id=checkout.merchant_id,
                        customer_id=checkout.customer_id,
                        agent_session_id=checkout.agent_session_id,
                        cart_id=checkout.cart_id,
                        cart_version=checkout.cart_version,
                        quote_id=checkout.quote_id,
                        delegation_id=checkout.delegation_id,
                        subtotal_paise=checkout.subtotal_paise,
                        discount_total_paise=checkout.discount_total_paise,
                        tax_total_paise=checkout.tax_total_paise,
                        shipping_total_paise=checkout.shipping_total_paise,
                        grand_total_paise=checkout.grand_total_paise,
                        applied_promotion_ids_json=list(checkout.applied_promotion_ids),
                        promotion_discounts_json=dict(checkout.promotion_discounts),
                        free_shipping_applied=checkout.free_shipping_applied,
                        status=checkout.status.value,
                        risk_reference=checkout.risk_reference,
                        authorization_id=checkout.authorization_id,
                        price_hash=checkout.price_hash,
                        order_id=checkout.order_id,
                        expires_at=checkout.expires_at,
                        created_at=checkout.created_at,
                        updated_at=checkout.updated_at,
                    )
                )
            for line in checkout.lines:
                session.add(
                    self._line_cls(
                        checkout_id=checkout.checkout_id,
                        sku=line.sku,
                        quantity=line.quantity,
                        unit_price_paise=line.unit_price_paise,
                    )
                )
            session.commit()

    def get(self, checkout_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            header = session.get(self._header_cls, checkout_id)
            if header is None or header.merchant_id != merchant_id:
                return None
            lines = (
                session.query(self._line_cls)
                .filter(self._line_cls.checkout_id == checkout_id)
                .all()
            )
            return _checkout_to_contract(header, lines)

    def append_event(
        self,
        *,
        event_id: str,
        checkout_id: str,
        merchant_id: str,
        action: str,
        from_status: str | None,
        to_status: str,
        detail: str | None = None,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._event_cls(
                    event_id=event_id,
                    checkout_id=checkout_id,
                    merchant_id=merchant_id,
                    action=action,
                    from_status=from_status,
                    to_status=to_status,
                    detail=detail,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def events_for(self, checkout_id: str, merchant_id: str) -> list[Any]:
        with Session(self._engine) as session:
            query = (
                select(self._event_cls)
                .where(self._event_cls.checkout_id == checkout_id)
                .where(self._event_cls.merchant_id == merchant_id)
                .order_by(self._event_cls.created_at.asc())
            )
            return list(session.scalars(query).all())

    def list_open(self, merchant_id: str) -> list[Any]:
        """Non-terminal checkouts for expiry sweeps."""
        with Session(self._engine) as session:
            query = (
                select(self._header_cls)
                .where(self._header_cls.merchant_id == merchant_id)
                .where(
                    self._header_cls.status.not_in(
                        ["COMPLETED", "REJECTED", "EXPIRED", "CANCELLED", "PAYMENT_FAILED"]
                    )
                )
                .order_by(self._header_cls.updated_at.desc())
            )
            headers = session.scalars(query).all()
            checkouts = []
            for header in headers:
                lines = (
                    session.query(self._line_cls)
                    .filter(self._line_cls.checkout_id == header.checkout_id)
                    .all()
                )
                checkouts.append(_checkout_to_contract(header, lines))
            return checkouts

    def for_order(self, order_id: str, merchant_id: str) -> Any | None:
        """Find the checkout linked to an order (payment completion path)."""
        with Session(self._engine) as session:
            query = (
                select(self._header_cls)
                .where(self._header_cls.merchant_id == merchant_id)
                .where(self._header_cls.order_id == order_id)
            )
            header = session.scalars(query.limit(1)).first()
            if header is None:
                return None
            lines = (
                session.query(self._line_cls)
                .filter(self._line_cls.checkout_id == header.checkout_id)
                .all()
            )
            return _checkout_to_contract(header, lines)


class TaxRateRepository:
    """Merchant GST rates per category (target §22)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import TaxRateRecord

        self._record_cls = TaxRateRecord
        self._engine = engine or make_engine()

    def upsert(self, rate: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(
                self._record_cls, (rate.merchant_id, rate.category)
            )
            if existing:
                existing.cgst_bps = rate.cgst_bps
                existing.sgst_bps = rate.sgst_bps
                existing.igst_bps = rate.igst_bps
            else:
                session.add(
                    self._record_cls(
                        merchant_id=rate.merchant_id,
                        category=rate.category,
                        cgst_bps=rate.cgst_bps,
                        sgst_bps=rate.sgst_bps,
                        igst_bps=rate.igst_bps,
                    )
                )
            session.commit()

    def all_for(self, merchant_id: str) -> dict[str, Any]:
        from sellable.contracts import TaxRate

        with Session(self._engine) as session:
            query = select(self._record_cls).where(
                self._record_cls.merchant_id == merchant_id
            )
            return {
                r.category: TaxRate(
                    merchant_id=r.merchant_id,
                    category=r.category,
                    cgst_bps=r.cgst_bps,
                    sgst_bps=r.sgst_bps,
                    igst_bps=r.igst_bps,
                )
                for r in session.scalars(query).all()
            }


class ShippingMethodRepository:
    """Merchant shipping methods (target §23.1)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import ShippingMethodRecord

        self._record_cls = ShippingMethodRecord
        self._engine = engine or make_engine()

    def save(self, config: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(
                self._record_cls, (config.merchant_id, config.method.value)
            )
            if existing:
                existing.price_paise = config.price_paise
                existing.eta_min_days = config.eta_min_days
                existing.eta_max_days = config.eta_max_days
                existing.pincode_prefixes_json = list(config.pincode_prefixes)
                existing.active = config.active
            else:
                session.add(
                    self._record_cls(
                        merchant_id=config.merchant_id,
                        method=config.method.value,
                        price_paise=config.price_paise,
                        eta_min_days=config.eta_min_days,
                        eta_max_days=config.eta_max_days,
                        pincode_prefixes_json=list(config.pincode_prefixes),
                        active=config.active,
                    )
                )
            session.commit()

    def active_for(self, merchant_id: str) -> list[Any]:
        from sellable.contracts import ShippingMethod, ShippingMethodConfig

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.active.is_(True))
                .order_by(self._record_cls.method.asc())
            )
            return [
                ShippingMethodConfig(
                    merchant_id=r.merchant_id,
                    method=ShippingMethod(r.method),
                    price_paise=r.price_paise,
                    eta_min_days=r.eta_min_days,
                    eta_max_days=r.eta_max_days,
                    pincode_prefixes=list(r.pincode_prefixes_json),
                    active=bool(r.active),
                )
                for r in session.scalars(query).all()
            ]


def _fulfillment_to_contract(record: Any) -> Any:
    from sellable.contracts import Fulfillment, FulfillmentStatus, ShippingMethod

    return Fulfillment(
        fulfillment_id=record.fulfillment_id,
        merchant_id=record.merchant_id,
        order_id=record.order_id,
        method=ShippingMethod(record.method),
        tracking_reference=record.tracking_reference,
        carrier=record.carrier,
        status=FulfillmentStatus(record.status),
        created_at=_as_aware_utc(record.created_at),
        updated_at=_as_aware_utc(record.updated_at),
    )


class FulfillmentRepository:
    """Basic fulfillment rows + tracking log (target §23.2)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import FulfillmentRecord, TrackingEventRecord

        self._record_cls = FulfillmentRecord
        self._event_cls = TrackingEventRecord
        self._engine = engine or make_engine()

    def save(self, fulfillment: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, fulfillment.fulfillment_id)
            if existing:
                existing.method = fulfillment.method.value
                existing.tracking_reference = fulfillment.tracking_reference
                existing.carrier = fulfillment.carrier
                existing.status = fulfillment.status.value
                existing.updated_at = fulfillment.updated_at
            else:
                session.add(
                    self._record_cls(
                        fulfillment_id=fulfillment.fulfillment_id,
                        merchant_id=fulfillment.merchant_id,
                        order_id=fulfillment.order_id,
                        method=fulfillment.method.value,
                        tracking_reference=fulfillment.tracking_reference,
                        carrier=fulfillment.carrier,
                        status=fulfillment.status.value,
                        created_at=fulfillment.created_at,
                        updated_at=fulfillment.updated_at,
                    )
                )
            session.commit()

    def get(self, fulfillment_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, fulfillment_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return _fulfillment_to_contract(record)

    def for_order(self, order_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.order_id == order_id)
            )
            record = session.scalars(query.limit(1)).first()
            return _fulfillment_to_contract(record) if record else None

    def for_tracking(self, tracking_reference: str) -> Any | None:
        """Resolve by carrier tracking reference (inbound webhook path;
        merchant comes from the row)."""
        with Session(self._engine) as session:
            query = select(self._record_cls).where(
                self._record_cls.tracking_reference == tracking_reference
            )
            record = session.scalars(query.limit(1)).first()
            return _fulfillment_to_contract(record) if record else None

    def append_tracking(self, event: Any) -> None:
        from sellable.contracts import new_id

        with Session(self._engine) as session:
            session.add(
                self._event_cls(
                    event_id=new_id("trk"),
                    fulfillment_id=event.fulfillment_id,
                    merchant_id=self._merchant_of(event.fulfillment_id),
                    status=event.status.value,
                    location=event.location,
                    occurred_at=event.occurred_at,
                )
            )
            session.commit()

    def _merchant_of(self, fulfillment_id: str) -> str:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, fulfillment_id)
            return record.merchant_id if record else ""

    def timeline(self, fulfillment_id: str, merchant_id: str) -> list[Any]:
        from sellable.contracts import FulfillmentStatus, TrackingEvent

        with Session(self._engine) as session:
            query = (
                select(self._event_cls)
                .where(self._event_cls.fulfillment_id == fulfillment_id)
                .where(self._event_cls.merchant_id == merchant_id)
                .order_by(self._event_cls.occurred_at.asc())
            )
            return [
                TrackingEvent(
                    fulfillment_id=r.fulfillment_id,
                    status=FulfillmentStatus(r.status),
                    location=r.location,
                    occurred_at=_as_aware_utc(r.occurred_at),
                )
                for r in session.scalars(query).all()
            ]


def _return_items_to_contracts(items: list[dict[str, object]]) -> list[Any]:
    from sellable.contracts import CartLine

    return [CartLine.model_validate(item) for item in items]


class ReturnRepository:
    """Return cases, exchanges, and refund asks (target §26, §38)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            ExchangeRecord,
            RefundRequestRecord,
            ReturnRecord,
        )

        self._return_cls = ReturnRecord
        self._exchange_cls = ExchangeRecord
        self._refund_request_cls = RefundRequestRecord
        self._engine = engine or make_engine()

    def save_return(self, case: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._return_cls, case.return_id)
            payload = {
                "merchant_id": case.merchant_id,
                "order_id": case.order_id,
                "customer_id": case.customer_id,
                "items_json": [item.model_dump() for item in case.items],
                "reason": case.reason,
                "status": case.status.value,
                "updated_at": case.updated_at,
            }
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
            else:
                session.add(
                    self._return_cls(
                        return_id=case.return_id,
                        created_at=case.created_at,
                        **payload,
                    )
                )
            session.commit()

    def get_return(self, return_id: str, merchant_id: str) -> Any | None:
        from sellable.contracts import ReturnRequest, ReturnStatus

        with Session(self._engine) as session:
            record = session.get(self._return_cls, return_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return ReturnRequest(
                return_id=record.return_id,
                merchant_id=record.merchant_id,
                order_id=record.order_id,
                customer_id=record.customer_id,
                items=_return_items_to_contracts(list(record.items_json)),
                reason=record.reason,
                status=ReturnStatus(record.status),
                created_at=_as_aware_utc(record.created_at),
                updated_at=_as_aware_utc(record.updated_at),
            )

    def save_exchange(self, exchange: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._exchange_cls, exchange.exchange_id)
            if existing:
                existing.status = exchange.status.value
                existing.updated_at = exchange.updated_at
            else:
                session.add(
                    self._exchange_cls(
                        exchange_id=exchange.exchange_id,
                        merchant_id=exchange.merchant_id,
                        return_id=exchange.return_id,
                        replacement_sku=exchange.replacement_sku,
                        replacement_quantity=exchange.replacement_quantity,
                        status=exchange.status.value,
                        created_at=exchange.created_at,
                        updated_at=exchange.updated_at,
                    )
                )
            session.commit()

    def get_exchange(self, exchange_id: str, merchant_id: str) -> Any | None:
        from sellable.contracts import ExchangeRequest, ExchangeStatus

        with Session(self._engine) as session:
            record = session.get(self._exchange_cls, exchange_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return ExchangeRequest(
                exchange_id=record.exchange_id,
                merchant_id=record.merchant_id,
                return_id=record.return_id,
                replacement_sku=record.replacement_sku,
                replacement_quantity=record.replacement_quantity,
                status=ExchangeStatus(record.status),
                created_at=_as_aware_utc(record.created_at),
                updated_at=_as_aware_utc(record.updated_at),
            )

    def save_refund_request(self, ask: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._refund_request_cls, ask.refund_request_id)
            payload = {
                "merchant_id": ask.merchant_id,
                "order_id": ask.order_id,
                "return_id": ask.return_id,
                "amount_paise": ask.amount_paise,
                "reason": ask.reason,
                "status": ask.status.value,
                "decided_by": ask.decided_by,
                "provider_ref": ask.provider_ref,
                "updated_at": ask.updated_at,
            }
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
            else:
                session.add(
                    self._refund_request_cls(
                        refund_request_id=ask.refund_request_id,
                        created_at=ask.created_at,
                        **payload,
                    )
                )
            session.commit()

    def get_refund_request(self, refund_request_id: str, merchant_id: str) -> Any | None:
        from sellable.contracts import RefundRequest, RefundRequestStatus

        with Session(self._engine) as session:
            record = session.get(self._refund_request_cls, refund_request_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return RefundRequest(
                refund_request_id=record.refund_request_id,
                merchant_id=record.merchant_id,
                order_id=record.order_id,
                return_id=record.return_id,
                amount_paise=record.amount_paise,
                reason=record.reason,
                status=RefundRequestStatus(record.status),
                decided_by=record.decided_by,
                provider_ref=record.provider_ref,
                created_at=_as_aware_utc(record.created_at),
                updated_at=_as_aware_utc(record.updated_at),
            )


class ObservabilityRepository:
    """Agent run/model/tool telemetry (target §29.1). Write-mostly: runs
    open at agent start, close at agent end; model/tool calls append."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            AgentModelCallRecord,
            AgentRunRecord,
            AgentToolCallRecord,
        )

        self._run_cls = AgentRunRecord
        self._model_cls = AgentModelCallRecord
        self._tool_cls = AgentToolCallRecord
        self._engine = engine or make_engine()

    def open_run(
        self,
        *,
        run_id: str,
        merchant_id: str,
        trace_id: str,
        agent_id: str,
        agent_version: str = "",
        prompt_version: str = "",
        policy_bundle_version: str = "",
        tool_registry_version: str = "",
        model_version: str = "",
        session_id: str | None = None,
        customer_id: str | None = None,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._run_cls(
                    run_id=run_id,
                    merchant_id=merchant_id,
                    trace_id=trace_id,
                    agent_id=agent_id,
                    agent_version=agent_version,
                    prompt_version=prompt_version,
                    policy_bundle_version=policy_bundle_version,
                    tool_registry_version=tool_registry_version,
                    model_version=model_version,
                    session_id=session_id,
                    customer_id=customer_id,
                    status="RUNNING",
                    started_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def close_run(
        self,
        run_id: str,
        *,
        status: str,
        outcome: str | None = None,
        error: str | None = None,
    ) -> None:
        with Session(self._engine) as session:
            record = session.get(self._run_cls, run_id)
            if record is None:
                return
            record.status = status
            record.outcome = outcome
            record.error = error[:500] if error else None
            record.ended_at = datetime.now(timezone.utc)
            session.commit()

    def record_model_call(
        self,
        *,
        call_id: str,
        run_id: str,
        merchant_id: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        estimated_cost_usd: float,
        latency_ms: int,
        finish_reason: str,
        error: str | None,
        retry_count: int,
        fallback_used: bool,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._model_cls(
                    call_id=call_id,
                    run_id=run_id,
                    merchant_id=merchant_id,
                    provider=provider,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    estimated_cost_usd=estimated_cost_usd,
                    latency_ms=latency_ms,
                    finish_reason=finish_reason,
                    error=error,
                    retry_count=retry_count,
                    fallback_used=fallback_used,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def record_tool_call(
        self,
        *,
        tool_call_id: str,
        run_id: str,
        merchant_id: str,
        tool_name: str,
        tool_version: str = "1",
        status: str = "OK",
        latency_ms: int = 0,
        error: str | None = None,
        policy_decision_id: str | None = None,
        risk_decision_id: str | None = None,
        authorization_id: str | None = None,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._tool_cls(
                    tool_call_id=tool_call_id,
                    run_id=run_id,
                    merchant_id=merchant_id,
                    tool_name=tool_name,
                    tool_version=tool_version,
                    status=status,
                    latency_ms=latency_ms,
                    error=error,
                    policy_decision_id=policy_decision_id,
                    risk_decision_id=risk_decision_id,
                    authorization_id=authorization_id,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def run_summary(self, run_id: str) -> dict[str, Any]:
        """Aggregate counters for evaluation and merchant observability."""
        from sqlalchemy import func

        with Session(self._engine) as session:
            run = session.get(self._run_cls, run_id)
            if run is None:
                return {}
            models = (
                session.query(self._model_cls)
                .filter(self._model_cls.run_id == run_id)
                .all()
            )
            tools = (
                session.query(self._tool_cls)
                .filter(self._tool_cls.run_id == run_id)
                .all()
            )
            return {
                "run_id": run.run_id,
                "status": run.status,
                "outcome": run.outcome,
                "model_calls": len(models),
                "model_cost_usd": round(
                    sum(m.estimated_cost_usd for m in models), 6
                ),
                "model_latency_ms": sum(m.latency_ms for m in models),
                "tool_calls": len(tools),
                "tool_failures": sum(1 for t in tools if t.status != "OK"),
            }

    def list_runs(self, merchant_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        """Recent agent runs for operations triage, newest first."""
        with Session(self._engine) as session:
            query = (
                select(self._run_cls)
                .where(self._run_cls.merchant_id == merchant_id)
                .order_by(self._run_cls.started_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            return [
                {
                    "run_id": r.run_id,
                    "trace_id": r.trace_id,
                    "agent_id": r.agent_id,
                    "agent_version": r.agent_version,
                    "status": r.status,
                    "outcome": r.outcome,
                    "error": r.error,
                    "started_at": _as_aware_utc(r.started_at).isoformat(),
                    "ended_at": _as_aware_utc(r.ended_at).isoformat()
                    if r.ended_at
                    else None,
                }
                for r in session.scalars(query).all()
            ]


class RiskRepository:
    """Persisted risk decisions (target §24.3)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import RiskDecisionRecord

        self._record_cls = RiskDecisionRecord
        self._engine = engine or make_engine()

    def save(self, assessment: Any) -> None:
        with Session(self._engine) as session:
            session.add(
                self._record_cls(
                    decision_id=assessment.decision_id,
                    merchant_id=assessment.merchant_id,
                    level=assessment.level.value,
                    score_bps=assessment.score_bps,
                    reasons_json=list(assessment.reasons),
                    subject_type=assessment.subject_type,
                    subject_id=assessment.subject_id,
                    trace_id=assessment.trace_id,
                    created_at=assessment.created_at,
                )
            )
            session.commit()

    def recent(self, merchant_id: str, *, limit: int = 50) -> list[Any]:
        from sellable.contracts import RiskAssessment, RiskLevel

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .order_by(self._record_cls.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            return [
                RiskAssessment(
                    decision_id=r.decision_id,
                    merchant_id=r.merchant_id,
                    level=RiskLevel(r.level),
                    score_bps=r.score_bps,
                    reasons=list(r.reasons_json),
                    subject_type=r.subject_type,
                    subject_id=r.subject_id,
                    trace_id=r.trace_id,
                    created_at=_as_aware_utc(r.created_at),
                )
                for r in session.scalars(query).all()
            ]

    def recent_all(self, *, limit: int = 50) -> list[Any]:
        """Cross-merchant recent decisions (platform admin eyes only)."""
        from sellable.contracts import RiskAssessment, RiskLevel

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .order_by(self._record_cls.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            return [
                RiskAssessment(
                    decision_id=r.decision_id,
                    merchant_id=r.merchant_id,
                    level=RiskLevel(r.level),
                    score_bps=r.score_bps,
                    reasons=list(r.reasons_json),
                    subject_type=r.subject_type,
                    subject_id=r.subject_id,
                    trace_id=r.trace_id,
                    created_at=_as_aware_utc(r.created_at),
                )
                for r in session.scalars(query).all()
            ]


class FraudRepository:
    """Abuse/fraud signals (target §24.4)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import FraudEventRecord

        self._record_cls = FraudEventRecord
        self._engine = engine or make_engine()

    def save(self, event: Any) -> None:
        with Session(self._engine) as session:
            session.add(
                self._record_cls(
                    event_id=event.event_id,
                    merchant_id=event.merchant_id,
                    kind=event.kind.value,
                    subject_type=event.subject_type,
                    subject_id=event.subject_id,
                    detail_json=dict(event.detail),
                    trace_id=event.trace_id,
                    created_at=event.created_at,
                )
            )
            session.commit()

    def list_for(
        self, merchant_id: str, *, kind: Any | None = None, limit: int = 50
    ) -> list[Any]:
        from sellable.contracts import FraudEvent, FraudKind

        with Session(self._engine) as session:
            query = select(self._record_cls).where(
                self._record_cls.merchant_id == merchant_id
            )
            if kind is not None:
                query = query.where(self._record_cls.kind == kind.value)
            query = query.order_by(self._record_cls.created_at.desc()).limit(
                max(1, min(limit, 200))
            )
            return [
                FraudEvent(
                    event_id=r.event_id,
                    merchant_id=r.merchant_id,
                    kind=FraudKind(r.kind),
                    subject_type=r.subject_type,
                    subject_id=r.subject_id,
                    detail=dict(r.detail_json),
                    trace_id=r.trace_id,
                    created_at=_as_aware_utc(r.created_at),
                )
                for r in session.scalars(query).all()
            ]

    def list_recent_all(self, *, limit: int = 50) -> list[Any]:
        """Cross-merchant recent fraud (platform admin eyes only)."""
        from sellable.contracts import FraudEvent, FraudKind

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .order_by(self._record_cls.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            return [
                FraudEvent(
                    event_id=r.event_id,
                    merchant_id=r.merchant_id,
                    kind=FraudKind(r.kind),
                    subject_type=r.subject_type,
                    subject_id=r.subject_id,
                    detail=dict(r.detail_json),
                    trace_id=r.trace_id,
                    created_at=_as_aware_utc(r.created_at),
                )
                for r in session.scalars(query).all()
            ]


class TrustEventRepository:
    """Append-only agent trust history (§38 agent_trust_events)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import AgentTrustEventRecord

        self._record_cls = AgentTrustEventRecord
        self._engine = engine or make_engine()

    def append(self, event: dict[str, Any]) -> None:
        with Session(self._engine) as session:
            session.add(
                self._record_cls(
                    event_id=event["event_id"],
                    merchant_id=event.get("merchant_id", ""),
                    agent_id=event["agent_id"],
                    kind=event["kind"],
                    reference=event.get("reference") or None,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def for_agent(self, agent_id: str, merchant_id: str) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.agent_id == agent_id)
                .where(self._record_cls.merchant_id == merchant_id)
                .order_by(self._record_cls.created_at.asc())
            )
            return [
                {
                    "event_id": r.event_id,
                    "kind": r.kind,
                    "reference": r.reference,
                    "created_at": _as_aware_utc(r.created_at),
                }
                for r in session.scalars(query).all()
            ]


class SupportCaseRepository:
    """Customer-service cases (target §26.1)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import SupportCaseRecord

        self._record_cls = SupportCaseRecord
        self._engine = engine or make_engine()

    def save(self, case: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, case.case_id)
            payload = {
                "merchant_id": case.merchant_id,
                "customer_id": case.customer_id,
                "agent_id": case.agent_id,
                "order_id": case.order_id,
                "checkout_id": case.checkout_id,
                "category": case.category.value,
                "priority": case.priority.value,
                "status": case.status.value,
                "summary": case.summary,
                "context_json": dict(case.context),
                "updated_at": case.updated_at,
            }
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
            else:
                session.add(
                    self._record_cls(
                        case_id=case.case_id, created_at=case.created_at, **payload
                    )
                )
            session.commit()

    def get(self, case_id: str, merchant_id: str) -> Any | None:
        from sellable.contracts import (
            SupportCase,
            SupportCasePriority,
            SupportCaseStatus,
            SupportCategory,
        )

        with Session(self._engine) as session:
            record = session.get(self._record_cls, case_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return SupportCase(
                case_id=record.case_id,
                merchant_id=record.merchant_id,
                customer_id=record.customer_id,
                agent_id=record.agent_id,
                order_id=record.order_id,
                checkout_id=record.checkout_id,
                category=SupportCategory(record.category),
                priority=SupportCasePriority(record.priority),
                status=SupportCaseStatus(record.status),
                summary=record.summary,
                context=dict(record.context_json),
                created_at=_as_aware_utc(record.created_at),
                updated_at=_as_aware_utc(record.updated_at),
            )

    def list_open(self, merchant_id: str) -> list[Any]:
        from sellable.contracts import (
            SupportCase,
            SupportCasePriority,
            SupportCaseStatus,
            SupportCategory,
        )

        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(
                    self._record_cls.status.in_(
                        ["OPEN", "IN_PROGRESS", "ESCALATED", "WAITING_FOR_CUSTOMER"]
                    )
                )
                .order_by(self._record_cls.created_at.desc())
            )
            return [
                SupportCase(
                    case_id=r.case_id,
                    merchant_id=r.merchant_id,
                    customer_id=r.customer_id,
                    agent_id=r.agent_id,
                    order_id=r.order_id,
                    checkout_id=r.checkout_id,
                    category=SupportCategory(r.category),
                    priority=SupportCasePriority(r.priority),
                    status=SupportCaseStatus(r.status),
                    summary=r.summary,
                    context=dict(r.context_json),
                    created_at=_as_aware_utc(r.created_at),
                    updated_at=_as_aware_utc(r.updated_at),
                )
                for r in session.scalars(query).all()
            ]


def _session_to_contract(record: Any) -> Any:
    from sellable.contracts import ProtocolSession, ProtocolSessionStatus

    return ProtocolSession(
        session_id=record.session_id,
        agent_id=record.agent_id,
        merchant_id=record.merchant_id,
        protocol=record.protocol,
        protocol_version=record.protocol_version,
        active_capabilities=list(record.active_capabilities_json),
        auth_context=dict(record.auth_context_json),
        delegation_id=record.delegation_id,
        status=ProtocolSessionStatus(record.status),
        created_at=_as_aware_utc(record.created_at),
        expires_at=_as_aware_utc(record.expires_at),
    )


class ProtocolSessionRepository:
    """Negotiated capability sessions (target §15.3)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import ProtocolSessionRecord

        self._record_cls = ProtocolSessionRecord
        self._engine = engine or make_engine()

    def save(self, session: Any) -> None:
        with Session(self._engine) as session_conn:
            existing = session_conn.get(self._record_cls, session.session_id)
            if existing:
                existing.active_capabilities_json = list(session.active_capabilities)
                existing.auth_context_json = dict(session.auth_context)
                existing.delegation_id = session.delegation_id
                existing.status = session.status.value
                existing.expires_at = session.expires_at
            else:
                session_conn.add(
                    self._record_cls(
                        session_id=session.session_id,
                        agent_id=session.agent_id,
                        merchant_id=session.merchant_id,
                        protocol=session.protocol,
                        protocol_version=session.protocol_version,
                        active_capabilities_json=list(session.active_capabilities),
                        auth_context_json=dict(session.auth_context),
                        delegation_id=session.delegation_id,
                        status=session.status.value,
                        created_at=session.created_at,
                        expires_at=session.expires_at,
                    )
                )
            session_conn.commit()

    def get(self, session_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session_conn:
            record = session_conn.get(self._record_cls, session_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return _session_to_contract(record)

    def active_for_agent(self, merchant_id: str, agent_id: str) -> list[Any]:
        with Session(self._engine) as session_conn:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.agent_id == agent_id)
                .where(self._record_cls.status == "ACTIVE")
                .order_by(self._record_cls.created_at.desc())
            )
            return [_session_to_contract(r) for r in session_conn.scalars(query).all()]

    def active_for_merchant(self, merchant_id: str) -> list[Any]:
        """All ACTIVE sessions for expiry sweeps."""
        with Session(self._engine) as session_conn:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.status == "ACTIVE")
                .order_by(self._record_cls.created_at.desc())
            )
            return [_session_to_contract(r) for r in session_conn.scalars(query).all()]


def _link_to_contract(record: Any) -> Any:
    from sellable.contracts import IdentityLink, IdentityLinkStatus

    return IdentityLink(
        link_id=record.link_id,
        merchant_id=record.merchant_id,
        customer_id=record.customer_id,
        agent_id=record.agent_id,
        protocol=record.protocol,
        scopes=list(record.scopes_json),
        status=IdentityLinkStatus(record.status),
        link_code_hash=record.link_code_hash,
        created_at=_as_aware_utc(record.created_at),
        expires_at=_as_aware_utc(record.expires_at),
    )


class IdentityLinkRepository:
    """Customer identity links (target §12)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import IdentityLinkRecord

        self._record_cls = IdentityLinkRecord
        self._engine = engine or make_engine()

    def save(self, link: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, link.link_id)
            if existing:
                existing.scopes_json = list(link.scopes)
                existing.status = link.status.value
                existing.expires_at = link.expires_at
            else:
                session.add(
                    self._record_cls(
                        link_id=link.link_id,
                        merchant_id=link.merchant_id,
                        customer_id=link.customer_id,
                        agent_id=link.agent_id,
                        protocol=link.protocol,
                        scopes_json=list(link.scopes),
                        status=link.status.value,
                        link_code_hash=link.link_code_hash,
                        created_at=link.created_at,
                        expires_at=link.expires_at,
                    )
                )
            session.commit()

    def get(self, link_id: str, merchant_id: str) -> Any | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, link_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return _link_to_contract(record)

    def linked_for_customer(
        self, merchant_id: str, customer_id: str, *, agent_id: str | None = None
    ) -> list[Any]:
        """LINKED identities for a customer (optionally via one agent)."""
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.customer_id == customer_id)
                .where(self._record_cls.status == "LINKED")
            )
            if agent_id is not None:
                query = query.where(self._record_cls.agent_id == agent_id)
            return [_link_to_contract(r) for r in session.scalars(query).all()]


class AnalyticsRepository:
    """Analytical fact store + metric queries (target §34)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import AnalyticsEventRecord

        self._record_cls = AnalyticsEventRecord
        self._engine = engine or make_engine()

    def ingest(self, event: Any, *, amount_paise: int = 0) -> bool:
        """Insert idempotently: redelivered bus events return False."""
        with Session(self._engine) as session:
            if session.get(self._record_cls, event.event_id) is not None:
                return False
            session.add(
                self._record_cls(
                    event_id=event.event_id,
                    event_type=event.event_type,
                    merchant_id=event.merchant_id,
                    aggregate_type=event.aggregate_type,
                    aggregate_id=event.aggregate_id,
                    trace_id=event.trace_id,
                    occurred_at=event.occurred_at,
                    amount_paise=amount_paise,
                    data_json=dict(event.data),
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()
            return True

    def _scoped(self, merchant_id: str, event_types: list[str] | None, since=None):
        query = select(self._record_cls).where(
            self._record_cls.merchant_id == merchant_id
        )
        if event_types:
            query = query.where(self._record_cls.event_type.in_(event_types))
        if since is not None:
            query = query.where(self._record_cls.occurred_at >= since)
        return query

    def overview(self, merchant_id: str, *, since=None) -> dict[str, object]:
        """Commerce + agentic metrics (§34.2 core set) computed in Python
        over a bounded window (portable across SQLite/Postgres)."""
        from sellable.contracts import utc_now as _utcnow

        with Session(self._engine) as session:
            rows = session.scalars(
                self._scoped(merchant_id, None, since).limit(5000)
            ).all()
        paid = [r for r in rows if r.event_type == "order.paid"]
        created = [r for r in rows if r.event_type == "order.created"]
        completed = [r for r in rows if r.event_type == "checkout.completed"]
        refunds = [r for r in rows if r.event_type == "refund.completed"]
        returns = [r for r in rows if r.event_type == "return.created"]
        gmv = sum(r.amount_paise for r in paid)
        paid_count = len({r.aggregate_id for r in paid})
        created_count = len({r.aggregate_id for r in created})
        agent_completed = sum(
            1 for r in completed if (r.data_json or {}).get("delegation_id")
        )
        return {
            "gmv_paise": gmv,
            "orders_created": created_count,
            "orders_paid": paid_count,
            "conversion_rate_bps": (
                paid_count * 10_000 // created_count if created_count else 0
            ),
            "aov_paise": gmv // paid_count if paid_count else 0,
            "checkouts_completed": len(completed),
            "agent_assisted_checkouts": agent_completed,
            "refunds_completed": len(refunds),
            "refund_amount_paise": sum(r.amount_paise for r in refunds),
            "returns_created": len(returns),
            "computed_at": _utcnow().isoformat(),
        }

    def timeseries(
        self, merchant_id: str, *, days: int = 30, now=None
    ) -> list[dict[str, object]]:
        """Daily GMV + paid-order counts, oldest first."""
        from datetime import timedelta

        from sellable.contracts import utc_now as _utcnow

        moment = now or _utcnow()
        since = moment - timedelta(days=max(days, 1))
        with Session(self._engine) as session:
            rows = session.scalars(
                self._scoped(merchant_id, ["order.paid"], since).limit(5000)
            ).all()
        buckets: dict[str, dict[str, int]] = {}
        for record in rows:
            day = _as_aware_utc(record.occurred_at).date().isoformat()
            bucket = buckets.setdefault(day, {"gmv_paise": 0, "orders": 0})
            bucket["gmv_paise"] += record.amount_paise
            bucket["orders"] += 1
        return [
            {"date": day, **buckets[day]} for day in sorted(buckets)
        ]


class NotificationRepository:
    """Merchant notification feed (target §35)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import NotificationRecord

        self._record_cls = NotificationRecord
        self._engine = engine or make_engine()

    def create(
        self,
        *,
        merchant_id: str,
        channel: str,
        event_type: str,
        title: str,
        body: str = "",
        urgency: str = "NORMAL",
        trace_id: str | None = None,
    ) -> str:
        from sellable.contracts import new_id

        notification_id = new_id("ntf")
        with Session(self._engine) as session:
            session.add(
                self._record_cls(
                    notification_id=notification_id,
                    merchant_id=merchant_id,
                    channel=channel,
                    event_type=event_type,
                    title=title,
                    body=body,
                    urgency=urgency,
                    status="SENT" if channel == "inapp" else "PENDING",
                    trace_id=trace_id,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()
            return notification_id

    def list_for_merchant(
        self, merchant_id: str, *, limit: int = 50, unread_only: bool = False
    ) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .where(self._record_cls.channel == "inapp")
                .order_by(self._record_cls.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            if unread_only:
                query = query.where(self._record_cls.read_at.is_(None))
            return [
                {
                    "notification_id": r.notification_id,
                    "event_type": r.event_type,
                    "title": r.title,
                    "body": r.body,
                    "urgency": r.urgency,
                    "status": r.status,
                    "trace_id": r.trace_id,
                    "read_at": r.read_at.isoformat() if r.read_at else None,
                    "created_at": _as_aware_utc(r.created_at).isoformat(),
                }
                for r in session.scalars(query).all()
            ]

    def mark_read(self, notification_id: str, merchant_id: str) -> bool:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, notification_id)
            if record is None or record.merchant_id != merchant_id:
                return False
            record.read_at = datetime.now(timezone.utc)
            record.status = "READ"
            session.commit()
            return True


class WebhookRepository:
    """Outbound subscriptions + delivery log (target §36.2)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            WebhookDispatchRecord,
            WebhookSubscriptionRecord,
        )

        self._subscription_cls = WebhookSubscriptionRecord
        self._dispatch_cls = WebhookDispatchRecord
        self._engine = engine or make_engine()

    def create_subscription(
        self, *, merchant_id: str, url: str, events: list[str], secret: str
    ) -> Any:
        from sellable.contracts import WebhookSubscription, new_id

        subscription = WebhookSubscription(
            subscription_id=new_id("whs"),
            merchant_id=merchant_id,
            url=url,
            events=events,
        )
        with Session(self._engine) as session:
            session.add(
                self._subscription_cls(
                    subscription_id=subscription.subscription_id,
                    merchant_id=merchant_id,
                    url=url,
                    events_json=list(events),
                    secret=secret,
                    active=True,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()
            return subscription

    def list_subscriptions(self, merchant_id: str) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._subscription_cls)
                .where(self._subscription_cls.merchant_id == merchant_id)
                .order_by(self._subscription_cls.created_at.desc())
            )
            return [
                {
                    "subscription_id": r.subscription_id,
                    "url": r.url,
                    "events": list(r.events_json),
                    "active": bool(r.active),
                    "created_at": _as_aware_utc(r.created_at).isoformat(),
                }
                for r in session.scalars(query).all()
            ]

    def delete_subscription(self, subscription_id: str, merchant_id: str) -> bool:
        with Session(self._engine) as session:
            record = session.get(self._subscription_cls, subscription_id)
            if record is None or record.merchant_id != merchant_id:
                return False
            session.delete(record)
            session.commit()
            return True

    def matching_subscriptions(
        self, merchant_id: str, event_type: str
    ) -> list[dict[str, Any]]:
        """Active subscriptions including this event type (secret included —
        server-side use only, never serialized to clients)."""
        with Session(self._engine) as session:
            query = (
                select(self._subscription_cls)
                .where(self._subscription_cls.merchant_id == merchant_id)
                .where(self._subscription_cls.active.is_(True))
            )
            return [
                {
                    "subscription_id": r.subscription_id,
                    "url": r.url,
                    "secret": r.secret,
                }
                for r in session.scalars(query).all()
                if event_type in (r.events_json or [])
            ]

    def log_dispatch(
        self,
        *,
        dispatch_id: str,
        subscription_id: str,
        merchant_id: str,
        event_id: str,
        event_type: str,
        status: str,
        attempts: int,
        last_status_code: int | None,
        last_error: str | None,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._dispatch_cls(
                    dispatch_id=dispatch_id,
                    subscription_id=subscription_id,
                    merchant_id=merchant_id,
                    event_id=event_id,
                    event_type=event_type,
                    status=status,
                    attempts=attempts,
                    last_status_code=last_status_code,
                    last_error=(last_error or "")[:500] if last_error else None,
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def recent_dispatches(
        self, merchant_id: str, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._dispatch_cls)
                .where(self._dispatch_cls.merchant_id == merchant_id)
                .order_by(self._dispatch_cls.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            return [
                {
                    "dispatch_id": r.dispatch_id,
                    "subscription_id": r.subscription_id,
                    "event_id": r.event_id,
                    "event_type": r.event_type,
                    "status": r.status,
                    "attempts": r.attempts,
                    "last_status_code": r.last_status_code,
                    "last_error": r.last_error,
                    "created_at": _as_aware_utc(r.created_at).isoformat(),
                }
                for r in session.scalars(query).all()
            ]


class EvaluationRepository:
    """Versioned suites, cases, runs, and results (target §30)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import (
            EvaluationCaseRecord,
            EvaluationResultRecord,
            EvaluationRunRecord,
            EvaluationSuiteRecord,
        )

        self._suite_cls = EvaluationSuiteRecord
        self._case_cls = EvaluationCaseRecord
        self._run_cls = EvaluationRunRecord
        self._result_cls = EvaluationResultRecord
        self._engine = engine or make_engine()

    def save_suite(self, suite_id: str, name: str, version: str, description: str = "") -> None:
        with Session(self._engine) as session:
            existing = session.get(self._suite_cls, suite_id)
            if existing:
                existing.name = name
                existing.version = version
                existing.description = description
            else:
                session.add(
                    self._suite_cls(
                        suite_id=suite_id,
                        name=name,
                        version=version,
                        description=description,
                        created_at=datetime.now(timezone.utc),
                    )
                )
            session.commit()

    def list_suites(self) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            return [
                {
                    "suite_id": r.suite_id,
                    "name": r.name,
                    "version": r.version,
                    "description": r.description,
                    "created_at": _as_aware_utc(r.created_at).isoformat(),
                }
                for r in session.scalars(select(self._suite_cls)).all()
            ]

    def save_case(
        self, *, case_id: str, suite_id: str, name: str, category: str,
        severity: str, kind: str, params: dict, expects: dict,
    ) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._case_cls, case_id)
            if existing:
                existing.name = name
                existing.category = category
                existing.severity = severity
                existing.kind = kind
                existing.params_json = params
                existing.expects_json = expects
            else:
                session.add(
                    self._case_cls(
                        case_id=case_id,
                        suite_id=suite_id,
                        name=name,
                        category=category,
                        severity=severity,
                        kind=kind,
                        params_json=params,
                        expects_json=expects,
                        created_at=datetime.now(timezone.utc),
                    )
                )
            session.commit()

    def cases_for_suite(self, suite_id: str) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._case_cls)
                .where(self._case_cls.suite_id == suite_id)
                .order_by(self._case_cls.case_id.asc())
            )
            return [
                {
                    "case_id": r.case_id,
                    "suite_id": r.suite_id,
                    "name": r.name,
                    "category": r.category,
                    "severity": r.severity,
                    "kind": r.kind,
                    "params": dict(r.params_json),
                    "expects": dict(r.expects_json),
                }
                for r in session.scalars(query).all()
            ]

    def start_run(
        self, *, run_id: str, suite_id: str, agent_id: str = "",
        agent_version: str = "", prompt_version: str = "", model: str = "",
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._run_cls(
                    run_id=run_id,
                    suite_id=suite_id,
                    agent_id=agent_id,
                    agent_version=agent_version,
                    prompt_version=prompt_version,
                    model=model,
                    status="RUNNING",
                    started_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def finish_run(
        self, run_id: str, *, status: str, passed: int, failed: int, error: str | None = None
    ) -> None:
        with Session(self._engine) as session:
            record = session.get(self._run_cls, run_id)
            if record is None:
                return
            record.status = status
            record.passed = passed
            record.failed = failed
            record.error = error[:500] if error else None
            record.ended_at = datetime.now(timezone.utc)
            session.commit()

    def record_result(
        self, *, result_id: str, run_id: str, case_id: str, passed: bool,
        score_bps: int = 0, duration_ms: int = 0,
        error: str | None = None, details: dict | None = None,
    ) -> None:
        with Session(self._engine) as session:
            session.add(
                self._result_cls(
                    result_id=result_id,
                    run_id=run_id,
                    case_id=case_id,
                    passed=passed,
                    score_bps=score_bps,
                    duration_ms=duration_ms,
                    error=error[:500] if error else None,
                    details_json=dict(details or {}),
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    def results_for_run(self, run_id: str) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._result_cls)
                .where(self._result_cls.run_id == run_id)
                .order_by(self._result_cls.case_id.asc())
            )
            return [
                {
                    "result_id": r.result_id,
                    "run_id": r.run_id,
                    "case_id": r.case_id,
                    "passed": bool(r.passed),
                    "score_bps": r.score_bps,
                    "duration_ms": r.duration_ms,
                    "error": r.error,
                    "details": dict(r.details_json),
                }
                for r in session.scalars(query).all()
            ]

    def latest_run_for_suite(self, suite_id: str) -> dict[str, Any] | None:
        with Session(self._engine) as session:
            query = (
                select(self._run_cls)
                .where(self._run_cls.suite_id == suite_id)
                .order_by(self._run_cls.started_at.desc())
                .limit(1)
            )
            record = session.scalars(query).first()
            if record is None:
                return None
            return {
                "run_id": record.run_id,
                "suite_id": record.suite_id,
                "status": record.status,
                "passed": record.passed,
                "failed": record.failed,
                "started_at": _as_aware_utc(record.started_at).isoformat(),
            }


class SandboxRepository:
    """Sandbox workflow runs (target §31.2)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import SandboxRunRecord

        self._record_cls = SandboxRunRecord
        self._engine = engine or make_engine()

    def save(self, sandbox: Any) -> None:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, sandbox["sandbox_id"])
            if existing:
                existing.stage = sandbox["stage"]
                existing.status = sandbox["status"]
                existing.summary_json = dict(sandbox.get("summary") or {})
                existing.updated_at = datetime.now(timezone.utc)
            else:
                session.add(
                    self._record_cls(
                        sandbox_id=sandbox["sandbox_id"],
                        agent_id=sandbox["agent_id"],
                        merchant_id=sandbox["merchant_id"],
                        stage=sandbox["stage"],
                        status=sandbox.get("status", "ACTIVE"),
                        summary_json=dict(sandbox.get("summary") or {}),
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    )
                )
            session.commit()

    def get(self, sandbox_id: str) -> dict[str, Any] | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, sandbox_id)
            if record is None:
                return None
            return {
                "sandbox_id": record.sandbox_id,
                "agent_id": record.agent_id,
                "merchant_id": record.merchant_id,
                "stage": record.stage,
                "status": record.status,
                "summary": dict(record.summary_json),
                "created_at": _as_aware_utc(record.created_at).isoformat(),
                "updated_at": _as_aware_utc(record.updated_at).isoformat(),
            }

    def list_for_merchant(self, merchant_id: str) -> list[dict[str, object]]:
        """All sandbox rows for operations triage (Phase 8 admin views)."""
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .order_by(self._record_cls.updated_at.desc())
                .limit(100)
            )
            return [
                {
                    "sandbox_id": r.sandbox_id,
                    "agent_id": r.agent_id,
                    "stage": r.stage,
                    "status": r.status,
                }
                for r in session.scalars(query).all()
            ]


class ConnectorRepository:
    """Merchant source-system connectors (target §38 merchant_connectors)."""

    def __init__(self, engine: object | None = None) -> None:
        from sellable.ledger.database import MerchantConnectorRecord

        self._record_cls = MerchantConnectorRecord
        self._engine = engine or make_engine()

    def save(self, config: Any) -> dict[str, Any]:
        with Session(self._engine) as session:
            existing = session.get(self._record_cls, config.connector_id)
            payload = {
                "merchant_id": config.merchant_id,
                "kind": config.kind,
                "provider": config.provider,
                "base_url": config.base_url,
                "products_path": config.products_path,
                "field_map_json": dict(config.field_map or {}),
                "headers_json": {
                    k: v for k, v in dict(config.headers or {}).items()
                    if "secret" not in k.lower() and "key" not in k.lower()
                },
                "active": config.active,
            }
            if existing:
                if existing.merchant_id != config.merchant_id:
                    raise LookupError(f"Unknown connector: {config.connector_id}")
                for key, value in payload.items():
                    setattr(existing, key, value)
            else:
                session.add(
                    self._record_cls(
                        connector_id=config.connector_id,
                        status="NEW",
                        created_at=datetime.now(timezone.utc),
                        **payload,
                    )
                )
            session.commit()
            return {"connector_id": config.connector_id, **payload}

    def get(self, connector_id: str, merchant_id: str) -> dict[str, Any] | None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, connector_id)
            if record is None or record.merchant_id != merchant_id:
                return None
            return {
                "connector_id": record.connector_id,
                "merchant_id": record.merchant_id,
                "kind": record.kind,
                "provider": record.provider,
                "base_url": record.base_url,
                "products_path": record.products_path,
                "field_map": dict(record.field_map_json or {}),
                "headers": dict(record.headers_json or {}),
                "active": bool(record.active),
            }

    def list_for_merchant(self, merchant_id: str) -> list[dict[str, Any]]:
        with Session(self._engine) as session:
            query = (
                select(self._record_cls)
                .where(self._record_cls.merchant_id == merchant_id)
                .order_by(self._record_cls.connector_id.asc())
            )
            return [
                {
                    "connector_id": r.connector_id,
                    "kind": r.kind,
                    "provider": r.provider,
                    "base_url": r.base_url,
                    "active": bool(r.active),
                    "status": r.status,
                    "last_sync_at": (
                        _as_aware_utc(r.last_sync_at).isoformat()
                        if r.last_sync_at
                        else None
                    ),
                }
                for r in session.scalars(query).all()
            ]

    def delete(self, connector_id: str, merchant_id: str) -> bool:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, connector_id)
            if record is None or record.merchant_id != merchant_id:
                return False
            session.delete(record)
            session.commit()
            return True

    def touch_sync(
        self, connector_id: str, merchant_id: str, *, status: str
    ) -> None:
        with Session(self._engine) as session:
            record = session.get(self._record_cls, connector_id)
            if record is None or record.merchant_id != merchant_id:
                return
            record.status = status
            record.last_sync_at = datetime.now(timezone.utc)
            session.commit()
