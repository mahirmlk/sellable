"""Production startup verifies the required PostgreSQL uniqueness invariants."""

from __future__ import annotations

import pytest

from sellable.ledger.database import _verify_required_postgres_index


class _Mappings:
    def __init__(self, record):
        self._record = record

    def first(self):
        return self._record


class _Result:
    def __init__(self, record):
        self._record = record

    def mappings(self):
        return _Mappings(self._record)


class _Connection:
    def __init__(self, record):
        self.record = record

    def execute(self, _statement, _parameters):
        return _Result(self.record)


def _record(
    *,
    table_name: str,
    columns: list[str],
    predicate: str | None = None,
    is_unique: bool = True,
    is_valid: bool = True,
    is_ready: bool = True,
):
    return {
        "table_name": table_name,
        "columns": columns,
        "predicate": predicate,
        "is_unique": is_unique,
        "is_valid": is_valid,
        "is_ready": is_ready,
    }


def test_order_idempotency_index_definition_is_accepted() -> None:
    _verify_required_postgres_index(
        _Connection(
            _record(
                table_name="orders",
                columns=["merchant_id", "idempotency_key"],
            )
        ),
        index_name="uq_orders_merchant_idempotency",
        table_name="orders",
        columns=("merchant_id", "idempotency_key"),
        predicate=None,
    )


def test_active_session_index_accepts_postgres_predicate_rendering() -> None:
    _verify_required_postgres_index(
        _Connection(
            _record(
                table_name="checkout_sessions",
                columns=["merchant_id", "buyer_ref"],
                predicate="((status)::text = 'ACTIVE'::text)",
            )
        ),
        index_name="uq_active_checkout_session",
        table_name="checkout_sessions",
        columns=("merchant_id", "buyer_ref"),
        predicate="status = 'ACTIVE'",
    )


@pytest.mark.parametrize(
    "record",
    [
        _record(table_name="orders", columns=["idempotency_key", "merchant_id"]),
        _record(
            table_name="orders",
            columns=["merchant_id", "idempotency_key"],
            is_unique=False,
        ),
        _record(
            table_name="orders",
            columns=["merchant_id", "idempotency_key"],
            is_valid=False,
        ),
        _record(
            table_name="orders",
            columns=["merchant_id", "idempotency_key"],
            is_ready=False,
        ),
        _record(
            table_name="orders",
            columns=["merchant_id", "idempotency_key"],
            predicate="status = 'ACTIVE'",
        ),
        _record(
            table_name="checkout_sessions",
            columns=["merchant_id", "buyer_ref"],
            predicate="status = 'EXPIRED'",
        ),
    ],
)
def test_mismatched_required_index_fails_closed(record) -> None:
    required = (
        {
            "index_name": "uq_active_checkout_session",
            "table_name": "checkout_sessions",
            "columns": ("merchant_id", "buyer_ref"),
            "predicate": "status = 'ACTIVE'",
        }
        if record["table_name"] == "checkout_sessions"
        else {
            "index_name": "uq_orders_merchant_idempotency",
            "table_name": "orders",
            "columns": ("merchant_id", "idempotency_key"),
            "predicate": None,
        }
    )

    with pytest.raises(RuntimeError, match="invalid or mismatched required index"):
        _verify_required_postgres_index(_Connection(record), **required)


def test_missing_required_index_fails_closed() -> None:
    with pytest.raises(RuntimeError, match="invalid or mismatched required index"):
        _verify_required_postgres_index(
            _Connection(None),
            index_name="uq_orders_merchant_idempotency",
            table_name="orders",
            columns=("merchant_id", "idempotency_key"),
            predicate=None,
        )
