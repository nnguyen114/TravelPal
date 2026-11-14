"""Service-to-service auth: core-api signs short-lived ES256 JWTs with aud=ai-service.

The verification key comes from INTERNAL_JWT_PUBLIC_KEY (PEM) or, if unset, core-api's JWKS at INTERNAL_JWKS_URL.
"""

import logging
import os
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException

log = logging.getLogger(__name__)
AUDIENCE = "ai-service"
ISSUER = "core-api"


@lru_cache(maxsize=4)
def jwks(url: str) -> jwt.PyJWKClient:
    # Short cooldown: a new core-api key (e.g. after a deploy) is picked up within seconds.
    return jwt.PyJWKClient(url, cache_keys=True, cooldown_duration=5, timeout=5)


def verification_key(token: str):
    if key := os.environ.get("INTERNAL_JWT_PUBLIC_KEY"):
        return key
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
        log.warning("rejected internal token: %s", e)
        raise HTTPException(401, "Invalid token") from e
