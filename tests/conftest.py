"""Hermetic test environment.

``sellable.config`` reads Settings at import time, and there is no ``.env``
file on GitHub CI (it is gitignored). Without this conftest the suite runs
as a "production" deploy: the demo agent key the tests authenticate with is
rejected (403) and ``/health`` reports ``environment=production``.

This conftest runs before any test module imports ``sellable.main``, pinning
the values the suite expects. ``load_dotenv`` uses ``override=False``, so a
developer's .env cannot undo these pins — DATABASE_URL is deliberately
forced to local SQLite so test runs never touch a shared Postgres.
"""

import os

os.environ.setdefault("SELLABLE_ENVIRONMENT", "development")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///./data/sellable.db")
