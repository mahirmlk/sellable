"""Regression coverage for the Supabase Data API database boundary."""

from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy.dialects.postgresql import dialect as postgres_dialect

from sellable.ledger.database import _harden_supabase_data_api


class _Result:
    def __init__(self, values=(), scalar=None):
        self._values = values
        self._scalar = scalar

    def scalars(self):
        return iter(self._values)

    def scalar_one_or_none(self):
        return self._scalar


class _Connection:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, statement, _parameters=None):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM pg_roles" in sql:
            return _Result(("anon", "authenticated"))
        if "pg_get_serial_sequence" in sql:
            return _Result(scalar="public.ledger_events_sequence_seq")
        return _Result()


class _PostgresEngine:
    dialect = postgres_dialect()

    def __init__(self):
        self.connection = _Connection()

    @contextmanager
    def begin(self):
        yield self.connection


def test_postgres_tables_are_closed_to_browser_roles_and_future_grants() -> None:
    engine = _PostgresEngine()

    _harden_supabase_data_api(engine)

    statements = engine.connection.statements
    assert any("ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY" in sql for sql in statements)
    assert any(
        "REVOKE ALL PRIVILEGES ON TABLE public.orders FROM PUBLIC, anon, authenticated"
        in sql
        for sql in statements
    )
    assert any(
        "REVOKE ALL PRIVILEGES ON SEQUENCE public.ledger_events_sequence_seq "
        in sql
        for sql in statements
    )
    assert any(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES"
        in sql
        for sql in statements
    )
    assert any(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES"
        in sql
        for sql in statements
    )
    assert all('"service_role"' not in sql for sql in statements)
