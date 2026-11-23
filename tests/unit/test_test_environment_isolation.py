"""Local pytest runs cannot inherit remote services or live credentials."""

from sellable.config import Settings


def test_pytest_uses_local_sandbox_configuration() -> None:
    settings = Settings.from_environment()

    assert settings.environment == "development"
    assert settings.database_url.startswith("sqlite+pysqlite:///")
    assert settings.payment_provider == "simulated"
    assert settings.llm_provider == "mock"
    assert not settings.supabase_is_configured
    assert not settings.razorpay_is_configured
    assert not settings.stripe_secret_key

