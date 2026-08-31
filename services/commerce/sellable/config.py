"""Runtime configuration kept outside agent and domain logic."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


def _project_root() -> Path:
    """Walk up from this file until we find ``infra/seed/`` (the repo root)."""
    here = Path(__file__).resolve().parent
    for parent in [here, *here.parents]:
        if (parent / "infra" / "seed").is_dir():
            return parent
    return here.parents[3]


def _resolve_database_url(raw_url: str) -> str:
    """If *raw_url* is a relative SQLite path, anchor it to the project root."""
    if not raw_url.startswith("sqlite"):
        return raw_url
    prefix = "sqlite+pysqlite:///"
    if not raw_url.startswith(prefix):
        return raw_url
    remainder = raw_url[len(prefix):]
    if os.path.isabs(remainder):
        return raw_url
    root = _project_root()
    return f"sqlite+pysqlite:///{root / remainder}"


def _suffix_url(url: str | None, suffix: str) -> str | None:
    """Return *url* joined with *suffix* if *url* is a non-empty value."""
    if not url:
        return None
    return url.rstrip("/") + suffix


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = "development"
    database_url: str = "sqlite+pysqlite:///./data/sellable.db"

    # Razorpay (test-mode only)
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    # LLM provider abstraction
    llm_provider: str = "mock"
    llm_model: str | None = None
    llm_temperature: float = 0.0
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    openrouter_api_key: str | None = None
    google_api_key: str | None = None

    # Supabase / Postgres
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None

    # Agent authentication (store only hashes/secrets server-side)
    agent_api_key_hashes: tuple[str, ...] = ()
    agent_hmac_secret: str | None = None

    # CORS
    cors_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )

    @classmethod
    def from_environment(cls) -> "Settings":
        raw_db_url = os.getenv("DATABASE_URL", "sqlite+pysqlite:///./data/sellable.db")
        supabase_url = os.getenv("SUPABASE_URL")
        key_hashes = tuple(
            h.strip()
            for h in os.getenv("BUYER_AGENT_API_KEY_HASH", "").split(",")
            if h.strip()
        )
        return cls(
            environment=os.getenv("SELLABLE_ENVIRONMENT", "development"),
            database_url=_resolve_database_url(raw_db_url),
            razorpay_key_id=os.getenv("RAZORPAY_KEY_ID"),
            razorpay_key_secret=os.getenv("RAZORPAY_KEY_SECRET"),
            razorpay_webhook_secret=os.getenv("RAZORPAY_WEBHOOK_SECRET"),
            llm_provider=os.getenv("LLM_PROVIDER", "mock"),
            llm_model=os.getenv("LLM_MODEL") or None,
            llm_temperature=float(os.getenv("LLM_TEMPERATURE", "0")),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
            google_api_key=os.getenv("GOOGLE_API_KEY"),
            supabase_url=supabase_url.rstrip("/") if supabase_url else None,
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY"),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
            supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET"),
            agent_api_key_hashes=key_hashes,
            agent_hmac_secret=os.getenv("BUYER_AGENT_HMAC_SECRET"),
            cors_origins=tuple(
                origin.strip()
                for origin in os.getenv("CORS_ORIGINS", "").split(",")
                if origin.strip()
            )
            or (
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ),
        )

    @property
    def razorpay_is_configured(self) -> bool:
        values = (
            self.razorpay_key_id,
            self.razorpay_key_secret,
            self.razorpay_webhook_secret,
        )
        placeholders = {"", "replace_me", "rzp_test_replace_me"}
        return all(value and value not in placeholders for value in values)

    @property
    def supabase_is_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_jwt_secret)

    @property
    def llm_is_configured(self) -> bool:
        """True when the active LLM provider has usable credentials."""
        if self.llm_provider in ("mock", "deterministic", ""):
            return True
        return bool(self.llm_api_key)

    @property
    def llm_api_key(self) -> str | None:
        """Return the credential for the active provider, or the generic one."""
        generic = os.getenv("LLM_API_KEY")
        by_provider = {
            "openai": self.openai_api_key,
            "anthropic": self.anthropic_api_key,
            "openrouter": self.openrouter_api_key,
            "google": self.google_api_key,
        }
        return by_provider.get(self.llm_provider, generic) or generic

    @property
    def supabase_rest_url(self) -> str | None:
        return _suffix_url(self.supabase_url, "/rest/v1")

    @property
    def supabase_auth_url(self) -> str | None:
        return _suffix_url(self.supabase_url, "/auth/v1")


settings = Settings.from_environment()
