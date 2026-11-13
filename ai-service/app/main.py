import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import chat, impact, worker
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


class ImpactRequest(BaseModel):
    trip: dict
    changes: list[dict] = Field(min_length=1, max_length=20)


@app.post("/internal/impact")
def impact_check(req: ImpactRequest, _: Annotated[dict, Depends(require_internal)]) -> dict:
    return impact.analyze(req.trip, req.changes)
