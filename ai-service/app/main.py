from typing import Annotated

from fastapi import Depends, FastAPI

from app.security import require_internal

app = FastAPI(title="TravelPal AI service", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict:
    return {"status": "UP"}


@app.get("/internal/ping")
def ping(claims: Annotated[dict, Depends(require_internal)]) -> dict:
    return {"caller": claims["iss"]}
