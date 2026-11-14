"""Service-to-service auth: core-api signs short-lived ES256 JWTs with aud=ai-service.

The verification key comes from INTERNAL_JWT_PUBLIC_KEY (PEM) or, if unset, core-api's JWKS at INTERNAL_JWKS_URL.
"""

import logging
import os
import re
from functools import lru_cache

import jwt
from cryptography.hazmat.primitives import serialization
from fastapi import Header, HTTPException

log = logging.getLogger(__name__)
AUDIENCE = "ai-service"
ISSUER = "core-api"


@lru_cache(maxsize=4)
def jwks(url: str) -> jwt.PyJWKClient:
    # Short cooldown: a new core-api key (e.g. after a deploy) is picked up within seconds.
    return jwt.PyJWKClient(url, cache_keys=True, cooldown_duration=5, timeout=5)


PEM = re.compile(r"-----BEGIN ([A-Z ]+)-----(.*?)-----END \1-----", re.DOTALL)


def normalize_pem(value: str) -> str:
    """Rebuild a PEM key pasted into a dashboard: lost line breaks, quotes, \\n escapes or a missing header."""
    v = value.strip().strip('"').strip("'").replace("\\n", "\n")
    m = PEM.search(v)
    kind, body = (m.group(1), m.group(2)) if m else ("PUBLIC KEY", v)
    body = "".join(body.split())
    lines = [body[i:i + 64] for i in range(0, len(body), 64)]
    return "\n".join([f"-----BEGIN {kind}-----", *lines, f"-----END {kind}-----"]) + "\n"


def check_configured_key() -> None:
    """Fail loudly at startup if the pinned key can't be read, instead of rejecting every call later."""
    if raw := os.environ.get("INTERNAL_JWT_PUBLIC_KEY"):
        try:
            serialization.load_pem_public_key(normalize_pem(raw).encode())
        except ValueError:
            log.error("INTERNAL_JWT_PUBLIC_KEY is not a readable public key; every internal call will be rejected")


def verification_key(token: str):
    if key := os.environ.get("INTERNAL_JWT_PUBLIC_KEY"):
        return normalize_pem(key)
    if url := os.environ.get("INTERNAL_JWKS_URL"):
        try:
            return jwks(url).get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientError as e:
            log.warning("no verification key for internal token: %s", e)
            raise HTTPException(401, "Invalid token") from e
    raise HTTPException(503, "Internal auth not configured")


def require_internal(authorization: str = Header(default="")) -> dict:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing bearer token")
    try:
        return jwt.decode(
            token, verification_key(token), algorithms=["ES256"], audience=AUDIENCE, issuer=ISSUER,
            options={"require": ["exp", "aud", "iss"]},
        )
    except jwt.PyJWTError as e:
        log.warning("rejected internal token: %s (INTERNAL_JWT_PUBLIC_KEY must be the public half of core-api's "
                    "INTERNAL_JWT_PRIVATE_JWK)", e)
        raise HTTPException(401, "Invalid token") from e
