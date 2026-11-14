import pytest


@pytest.fixture(autouse=True)
def no_real_keys(monkeypatch):
    """Tests never call real APIs, even when a developer's .env has keys."""
    for k in ("ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "INTERNAL_JWKS_URL", "INTERNAL_JWT_PUBLIC_KEY"):
        monkeypatch.delenv(k, raising=False)
