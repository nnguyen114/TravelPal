import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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


def test_health_is_public():
    assert client.get("/health").json() == {"status": "UP"}


def test_valid_internal_token(signer):
    r = client.get("/internal/ping", headers=signer())
    assert r.status_code == 200 and r.json() == {"caller": "core-api"}


@pytest.mark.parametrize("claims", [{"aud": "someone-else"}, {"iss": "attacker"}, {"exp": int(time.time()) - 10}])
def test_rejects_wrong_claims(signer, claims):
    assert client.get("/internal/ping", headers=signer(**claims)).status_code == 401


def test_rejects_token_from_other_key(signer):
    other, _ = keypair()
    token = jwt.encode({"iss": "core-api", "aud": "ai-service", "exp": int(time.time()) + 60}, other, algorithm="ES256")
    assert client.get("/internal/ping", headers={"Authorization": f"Bearer {token}"}).status_code == 401


@pytest.mark.parametrize("header", ["", "Basic abc", "Bearer "])
def test_rejects_missing_or_malformed_header(signer, header):
    assert client.get("/internal/ping", headers={"Authorization": header}).status_code == 401


def test_unconfigured_key_fails_closed(monkeypatch):
    monkeypatch.delenv("INTERNAL_JWT_PUBLIC_KEY", raising=False)
    assert client.get("/internal/ping", headers={"Authorization": "Bearer x"}).status_code == 503


def test_verifies_against_core_api_jwks(monkeypatch):
    from types import SimpleNamespace

    import app.security as sec
    priv, pub = keypair()
    monkeypatch.setenv("INTERNAL_JWKS_URL", "http://core-api/.well-known/internal-jwks.json")
    key = SimpleNamespace(key=pub)
    monkeypatch.setattr(sec, "jwks", lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda t: key))
    token = jwt.encode({"iss": "core-api", "aud": "ai-service", "exp": int(time.time()) + 60}, priv, algorithm="ES256")
    assert client.get("/internal/ping", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    def unknown(t):
        raise jwt.PyJWKClientError("no matching key")
    monkeypatch.setattr(sec, "jwks", lambda url: SimpleNamespace(get_signing_key_from_jwt=unknown))
    assert client.get("/internal/ping", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert sec.jwks.__name__ == "<lambda>"
