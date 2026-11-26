"""Keep the staging Worker isolated from production configuration."""

from __future__ import annotations

import json
from pathlib import Path


_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_staging_worker_is_separate_and_uses_only_staging_origins() -> None:
    staging = json.loads(
        (_REPOSITORY_ROOT / "wrangler.staging.jsonc").read_text(encoding="utf-8")
    )

    assert staging["name"] == "sellable-commerce-api-staging"
    assert staging["name"] != "sellable-commerce-api"
    assert staging["vars"]["SELLABLE_ENVIRONMENT"] == "staging"
    assert staging["workers_dev"] is True
    assert staging.get("routes", []) == []
    assert staging["vars"]["CORS_ORIGINS"] == "https://staging.sellable.shop"


def test_staging_worker_keeps_credentials_out_of_checked_in_vars() -> None:
    staging = json.loads(
        (_REPOSITORY_ROOT / "wrangler.staging.jsonc").read_text(encoding="utf-8")
    )
    checked_in_vars = staging.get("vars", {})
    secret_names = {
        "DATABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_JWT_SECRET",
        "BUYER_AGENT_API_KEY_HASH",
        "BUYER_AGENT_HMAC_SECRET",
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
        "LLM_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENROUTER_API_KEY",
        "GOOGLE_API_KEY",
        "SELLABLE_ADMIN_API_KEY",
    }

    assert secret_names.isdisjoint(checked_in_vars)
