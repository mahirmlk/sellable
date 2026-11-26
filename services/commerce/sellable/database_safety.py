"""Fail-closed parsing for local-only development database safeguards."""

from __future__ import annotations

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


_LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_local_database_url(raw_url: str | None) -> bool:
    """Return true only for SQLite or URLs whose actual host is loopback.

    Do not use substring checks: a remote DNS name such as localhost.attacker.example
    must never enable the built-in demo key. Query-level host overrides are
    rejected because they can replace the authority hostname used by common
    PostgreSQL drivers.
    """
    if not isinstance(raw_url, str) or not raw_url.strip():
        return False
    try:
        parsed = make_url(raw_url)
    except (ArgumentError, TypeError, ValueError):
        return False

    if parsed.get_backend_name() == "sqlite":
        return True
    if any(key.lower() in {"host", "hostaddr"} for key in parsed.query):
        return False
    hostname = (parsed.host or "").rstrip(".").lower()
    return hostname in _LOCAL_DATABASE_HOSTS
