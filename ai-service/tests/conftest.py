import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


@pytest.fixture(autouse=True)
def no_real_keys(monkeypatch):
    """Tests never call real APIs, even when a developer's .env has keys."""
    for k in ("ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "INTERNAL_JWKS_URL", "INTERNAL_JWT_PUBLIC_KEY"):
        monkeypatch.delenv(k, raising=False)
    # Place search needs a key to try at all; tests answer it with mock transports, never the real API.
    monkeypatch.setenv("PLACES_API_KEY", "test-key")


def keypair():
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return priv, pub.decode()


@pytest.fixture
def signer(monkeypatch):
    priv, pub = keypair()
    monkeypatch.setenv("INTERNAL_JWT_PUBLIC_KEY", pub)

    def sign(**overrides):
        claims = {"iss": "core-api", "aud": "ai-service", "exp": int(time.time()) + 60} | overrides
        return {"Authorization": "Bearer " + jwt.encode(claims, priv, algorithm="ES256")}

    return sign
