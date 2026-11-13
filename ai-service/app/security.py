"""Service-to-service auth: core-api signs short-lived ES256 JWTs with aud=ai-service."""

import os

import jwt
from fastapi import Header, HTTPException

AUDIENCE = "ai-service"
ISSUER = "core-api"


def public_key() -> str:
    key = os.environ.get("INTERNAL_JWT_PUBLIC_KEY")
    if not key:
        raise HTTPException(503, "Internal auth not configured")
    return key


def require_internal(authorization: str = Header(default="")) -> dict:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing bearer token")
    try:
        return jwt.decode(
            token, public_key(), algorithms=["ES256"], audience=AUDIENCE, issuer=ISSUER,
            options={"require": ["exp", "aud", "iss"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Invalid token") from e
