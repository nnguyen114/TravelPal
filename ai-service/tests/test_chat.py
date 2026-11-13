import json

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from app import chat
from app.main import app
from tests.fakes import FakeAsyncClient, message, text, tool_use

TRIP = {"trip": {"name": "Japan", "dayCount": 2, "startDate": "2027-06-10", "cities": []},
        "destinations": [{"id": "a", "name": "Meiji Jingu", "lat": 35.676, "lng": 139.699, "dayIndex": 0, "position": 0, "durationMin": 90},
                         {"id": "b", "name": "Cat Street", "lat": 35.667, "lng": 139.705, "dayIndex": 0, "position": 1, "durationMin": 300}]}


def req(text_="hi"):
    return chat.ChatRequest(trip=TRIP, messages=[{"role": "user", "content": text_}])


async def collect(gen):
    out = []
    async for chunk in gen:
        name, data = chunk.split("\n")[:2]
        out.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return out


@pytest.mark.anyio
async def test_streams_text_and_caches_trip_context():
    fake = FakeAsyncClient(message(text("Day 1 looks "), text("full.")))
    events = await collect(chat.chat_events(req(), fake))
    assert events == [("text", {"text": "Day 1 looks "}), ("text", {"text": "full."}), ("done", {})]
    call = fake.calls[0]
    assert call["cache_control"] == {"type": "ephemeral"} and call["fallbacks"] == "default"
    assert call["system"][1]["text"].startswith("<trip>{")
    ctx = json.loads(call["system"][1]["text"][6:-7])
    assert ctx["places"][0] == {"name": "Meiji Jingu", "day": 1, "time": None, "minutes": 90, "locked": False, "address": None,
                                 "bestAfter": None, "bestBefore": None, "dayTrip": False}
    assert "id" not in ctx["places"][0] and "dayIndex" not in call["system"][1]["text"]
    assert {t["name"] for t in call["tools"]} == {"propose_places", "propose_optimization", "check_fit"}


@pytest.mark.anyio
async def test_proposals_are_emitted_not_applied_and_bad_input_is_reported():
    fake = FakeAsyncClient(
        message(tool_use("t1", "propose_places", {"places": [{"name": "Tsukiji", "day_number": 2}]}),
                tool_use("t2", "propose_optimization", {"mode": "RELAXED", "day_number": 0, "instructions": "slow mornings"}),
                tool_use("t3", "check_fit", {"day_number": 1, "minutes": 240}),
                tool_use("t4", "propose_places", {"places": []}),
                tool_use("t5", "delete_trip", {}), stop_reason="tool_use"),
        message(text("Buttons are below.")),
    )
    events = await collect(chat.chat_events(req("add tsukiji"), fake))
    assert ("proposal", {"type": "places", "places": [{"name": "Tsukiji", "day_number": 2}]}) in events
    assert ("proposal", {"type": "optimize", "mode": "RELAXED", "day_number": 0, "instructions": "slow mornings"}) in events
    results = fake.calls[1]["messages"][-1]["content"]
    assert "about" in results[2]["content"] and "doesn't fit" in results[2]["content"]
    assert results[3]["is_error"] and results[4]["is_error"]
    assert events[-2:] == [("text", {"text": "Buttons are below."}), ("done", {})]


@pytest.mark.anyio
async def test_refusal_truncation_and_api_errors():
    events = await collect(chat.chat_events(req(), FakeAsyncClient(message(stop_reason="refusal"))))
    assert events[0] == ("text", {"text": "Sorry, I can't help with that one."})
    events = await collect(chat.chat_events(req(), FakeAsyncClient(message(tool_use("t", "check_fit", {}), stop_reason="max_tokens"))))
    assert events == [("done", {})]
    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
    events = await collect(chat.chat_events(req(), FakeAsyncClient(error=err)))
    assert events[0][0] == "error" and events[-1] == ("done", {})


def test_check_fit_estimates():
    assert "only 2 days" in chat.check_fit(TRIP, chat.CheckFit(day_number=5, minutes=60))
    assert "visit fits" in chat.check_fit(TRIP, chat.CheckFit(day_number=2, minutes=60))
    assert "is tight" in chat.check_fit({**TRIP, "destinations": [{**TRIP["destinations"][1], "durationMin": 470}]}, chat.CheckFit(day_number=1, minutes=120))


def test_endpoint_needs_internal_auth_and_a_key(monkeypatch):
    client = TestClient(app)
    body = {"trip": TRIP, "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/internal/chat", json=body).status_code == 401
    monkeypatch.setattr("app.main.require_internal", dict)
    app.dependency_overrides[chat_dep()] = lambda: {"iss": "core-api"}
    try:
        assert client.post("/internal/chat", json=body).status_code == 503
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test")

        async def fake_events(_):
            yield chat.sse("text", {"text": "hi"})
        monkeypatch.setattr(chat, "chat_events", fake_events)
        r = client.post("/internal/chat", json=body)
        assert r.status_code == 200 and "event: text" in r.text
        assert client.post("/internal/chat", json={"trip": TRIP, "messages": []}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def chat_dep():
    from app.security import require_internal
    return require_internal


@pytest.fixture
def anyio_backend():
    return "asyncio"
