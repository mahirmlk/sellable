"""Hermetic test environment; tests must never inherit developer secrets."""

import os
import tempfile
from pathlib import Path
from uuid import uuid4


# Settings are constructed at import time, before pytest imports test modules.
# Assignment is intentional: setdefault would preserve a developer's remote
# DATABASE_URL and could let local tests mutate a shared staging/production DB.
_TEST_DATABASE = Path(tempfile.gettempdir()) / (
    f"sellable-pytest-{os.getpid()}-{uuid4().hex}.sqlite"
)
os.environ.update(
    {
        "SELLABLE_ENVIRONMENT": "development",
        "DATABASE_URL": f"sqlite+pysqlite:///{_TEST_DATABASE.as_posix()}",
        "PAYMENT_PROVIDER": "simulated",
        "LLM_PROVIDER": "mock",
        "SELLABLE_MAINTENANCE_WORKER": "0",
    }
)

# dotenv does not override keys already present in the process environment.
# Empty values keep ignored local .env files from activating network clients.
for _name in (
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "BUYER_AGENT_API_KEY_HASH",
    "BUYER_AGENT_HMAC_SECRET",
    "SELLABLE_ADMIN_API_KEY",
    "LLM_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "SMTP_HOST",
    "SMTP_FROM",
    "SMTP_RECIPIENTS",
    "ZROK_ENABLE_TOKEN",
    "CLOUDFLARE_API_TOKEN",
):
    os.environ[_name] = ""

