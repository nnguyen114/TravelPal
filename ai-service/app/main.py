import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import chat, discovery, impact, links, worker
from app.security import require_internal

# Local dev: keys live in the repo-root .env (gitignored). Real env vars win.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = threading.Event()
    if os.environ.get("WORKER_ENABLED", "true") == "true":
        worker.start(stop)
    yield
    stop.set()


app = FastAPI(title="TravelPal AI service", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "UP"}


@app.get("/internal/ping")
def ping(claims: Annotated[dict, Depends(require_internal)]) -> dict:
    return {"caller": claims["iss"]}


@app.post("/internal/chat")
def assistant(req: chat.ChatRequest, _: Annotated[dict, Depends(require_internal)]) -> StreamingResponse:
    if not chat.available():
        raise HTTPException(503, "Assistant not configured")
    return StreamingResponse(chat.chat_events(req), media_type="text/event-stream")


@app.post("/internal/optimize")
def optimize_now(job: dict, _: Annotated[dict, Depends(require_internal)]) -> dict:
    """The same job the SQS worker handles, answered directly (used where there is no queue)."""
    if not isinstance(job.get("previewId"), str) or not isinstance(job.get("destinations"), list):
        raise HTTPException(422, "Not an optimize job")
    return worker.run(job)


class ImpactRequest(BaseModel):
    trip: dict
    changes: list[dict] = Field(min_length=1, max_length=20)


@app.post("/internal/impact")
def impact_check(req: ImpactRequest, _: Annotated[dict, Depends(require_internal)]) -> dict:
    return impact.analyze(req.trip, req.changes)


class DiscoverRequest(BaseModel):
    request: str | None = Field(default=None, max_length=500)
    center: dict
    radiusKm: float = Field(default=3, gt=0, le=30)
    taste: list[dict] = Field(default_factory=list, max_length=60)
    seeds: list[dict] = Field(default_factory=list, max_length=5)
    exclude: list[dict] = Field(default_factory=list, max_length=500)
    count: int = Field(default=5, ge=1, le=10)


@app.post("/internal/discover")
def discover(req: DiscoverRequest, _: Annotated[dict, Depends(require_internal)]) -> dict:
    return discovery.discover(req.model_dump())


class LinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    near: dict | None = None


@app.post("/internal/link")
def link(req: LinkRequest, _: Annotated[dict, Depends(require_internal)]) -> dict:
    return links.resolve(req.url, req.near)
