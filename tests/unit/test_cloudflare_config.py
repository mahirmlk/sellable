"""Deployment security invariants for the production Cloudflare Worker."""

from __future__ import annotations

import json
from pathlib import Path


_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_production_worker_uses_only_the_declared_custom_domain() -> None:
    config = json.loads(
        (_REPOSITORY_ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    )

    assert config["workers_dev"] is False
    assert config["preview_urls"] is False
    assert config["routes"] == [
        {"pattern": "api.sellable.shop", "custom_domain": True}
    ]


def test_production_worker_does_not_check_in_deployment_secrets() -> None:
    config = json.loads(
        (_REPOSITORY_ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    )
    checked_in_vars = config.get("vars", {})
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
