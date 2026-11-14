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


def test_optimize_over_http_answers_like_the_queue_worker(signer):
    job = {"previewId": "p1", "mode": "BALANCED", "scope": "TRIP", "dayIndex": None, "dayCount": 1, "startDate": "2027-06-10",
           "cities": [{"name": "Tokyo", "lat": 35.68, "lng": 139.76}],
           "destinations": [{"id": "a", "name": "Senso-ji", "lat": 35.71, "lng": 139.79, "dayIndex": None, "position": None,
                             "startTime": None, "locked": False, "durationMin": 90, "flexibility": "FLEXIBLE"}]}
    r = client.post("/internal/optimize", json=job, headers=signer())
    assert r.status_code == 200
    assert r.json()["previewId"] == "p1" and r.json()["status"] in ("READY", "FAILED")
    assert client.post("/internal/optimize", json={"hello": 1}, headers=signer()).status_code == 422
    assert client.post("/internal/optimize", json=job).status_code == 401


def test_pasted_keys_are_repaired(signer, monkeypatch):
    import os

    from app.security import normalize_pem
    pem = os.environ["INTERNAL_JWT_PUBLIC_KEY"]
    body = "".join(pem.split("-----")[2].split())
    for mangled in [pem.replace("\n", " "), pem.replace("\n", "\\n"), f'"{pem}"', body]:
        monkeypatch.setenv("INTERNAL_JWT_PUBLIC_KEY", mangled)
        assert normalize_pem(mangled) == normalize_pem(pem)
        assert client.get("/internal/ping", headers=signer()).status_code == 200


def test_unreadable_pinned_key_is_reported_at_startup(monkeypatch, caplog):
    from app.security import check_configured_key
    monkeypatch.setenv("INTERNAL_JWT_PUBLIC_KEY", "not a key")
    check_configured_key()
    assert "not a readable public key" in caplog.text


def test_api_description_is_not_published():
    assert client.get("/openapi.json").status_code == 404
