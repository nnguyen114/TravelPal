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
async def test_replies_once_and_caches_trip_context():
    fake = FakeAsyncClient(message(text("Day 1 looks "), text("full.")))
    events = await collect(chat.chat_events(req(), fake))
    # A status goes out first so the connection is never silent while Claude works; then the reply, once.
    assert events == [("status", {"text": "Thinking…"}), ("text", {"text": "Day 1 looks full."}), ("done", {})]
    call = fake.calls[0]
    assert call["cache_control"] == {"type": "ephemeral"} and call["fallbacks"] == "default"
    assert call["system"][1]["text"].startswith("<trip>{")
    ctx = json.loads(call["system"][1]["text"][6:-7])
    assert ctx["places"][0] == {"name": "Meiji Jingu", "day": 1, "time": None, "minutes": 90, "locked": False, "address": None,
                                 "bestAfter": None, "bestBefore": None, "dayTrip": False}
    assert "id" not in ctx["places"][0] and "dayIndex" not in call["system"][1]["text"]
    assert {t["name"] for t in call["tools"]} == {"search_places", "add_places", "propose_optimization", "check_fit"}


@pytest.mark.anyio
async def test_searches_then_adds_real_places_and_says_it_once(monkeypatch):
    calls = []

    def fake_search(q, *, near=None, bbox=None, category="", limit=10, http=None):
        calls.append((q, category))
        if q == "Crazy House":
            return [{"name": "Hang Nga Crazy House", "lat": 11.935, "lng": 108.431, "providerId": "g:ch", "category": "", "address": "Da Lat"}]
        if q == "Golden Bridge":  # only a namesake far away (Hanoi)
            return [{"name": "Golden Bridge", "lat": 21.03, "lng": 105.85, "providerId": "g:gb", "category": "", "address": "Hanoi"}]
        if not category:
            return [{"name": "Da Lat", "lat": 11.94, "lng": 108.44, "providerId": "g:city", "category": "", "address": "Vietnam"}]
        return [{"name": "Da Lat Market", "lat": 11.943, "lng": 108.437, "providerId": "g:m1", "category": "marketplace",
                 "address": "Ward 1, Da Lat"}]
    monkeypatch.setattr(chat.places, "search", fake_search)
    fake = FakeAsyncClient(
        message(text("Let me look that up."), tool_use("s1", "search_places", {"city": "Da Lat", "kinds": ["markets"]}),
                stop_reason="tool_use"),
        message(text("Here's a plan..."), tool_use("a1", "add_places", {"places": [
            {"name": "Da Lat Market", "day_number": 2, "ref": "p1"}, {"name": "Crazy House", "day_number": 0, "city": "da lat"},
            {"name": "Golden Bridge", "day_number": 0, "city": "Da Lat"}, {"name": "Pasted spot", "day_number": 1}]}),
            tool_use("o1", "propose_optimization", {"mode": "RELAXED", "day_number": 0, "instructions": "slow mornings"}),
            tool_use("c1", "check_fit", {"day_number": 1, "minutes": 240}),
            tool_use("x1", "delete_trip", {}), stop_reason="tool_use"),
        message(text("Added 2 places in Da Lat. Optimize Trip will order the days.")),
    )
    events = await collect(chat.chat_events(req("plan da lat markets"), fake))
    # The city is found once and reused for named places in it.
    assert calls == [("Da Lat", ""), ("", "commercial.marketplace"), ("Crazy House", ""), ("Golden Bridge", "")]
    assert ("status", {"text": "Finding markets in Da Lat…"}) in events
    # The searched place keeps its real location; a name-only pick is looked up by the app.
    assert ("proposal", {"type": "places", "places": [
        {"name": "Da Lat Market", "lat": 11.943, "lng": 108.437, "providerId": "g:m1", "address": "Ward 1, Da Lat", "day_number": 2},
        {"name": "Hang Nga Crazy House", "lat": 11.935, "lng": 108.431, "providerId": "g:ch", "address": "Da Lat", "day_number": 0},
        # Its only match is 1,000 km away: left unlocated, still tied to its city so the app never pins it elsewhere.
        {"name": "Golden Bridge", "city": "Da Lat", "day_number": 0},
        {"name": "Pasted spot", "day_number": 1}]}) in events
    assert ("proposal", {"type": "optimize", "mode": "RELAXED", "day_number": 0, "instructions": "slow mornings"}) in events
    result = {r["tool_use_id"]: r for m in fake.calls[-1]["messages"] if m["role"] == "user" and isinstance(m["content"], list)
              for r in m["content"]}
    assert "p1 | Da Lat Market | markets · marketplace | Ward 1, Da Lat" in result["s1"]["content"]
    assert "doesn't fit" in result["c1"]["content"] and result["x1"]["is_error"]
    # Nothing saves until the traveler taps Add, so the model is told they were shown, not added.
    assert result["a1"]["content"].startswith("Shown 4 to the traveler")
    # Preamble text from tool rounds is dropped: one reply, no repeats.
    assert [e for e in events if e[0] == "text"] == [("text", {"text": "Added 2 places in Da Lat. Optimize Trip will order the days."})]


@pytest.mark.anyio
async def test_search_is_capped_and_outages_are_reported(monkeypatch):
    def down(*a, **k):
        raise chat.places.Unavailable
    monkeypatch.setattr(chat.places, "search", down)
    many = [tool_use(f"s{i}", "search_places", {"city": "Hue", "kinds": ["food"]}) for i in range(chat.MAX_SEARCHES + 1)]
    fake = FakeAsyncClient(message(*many, stop_reason="tool_use"), message(text("ok")))
    await collect(chat.chat_events(req(), fake))
    results = fake.calls[1]["messages"][-1]["content"]
    assert "unavailable" in results[0]["content"] and results[-1]["is_error"] and "limit" in results[-1]["content"]
    monkeypatch.setattr(chat.places, "search", lambda *a, **k: [])
    assert "Couldn't find Atlantis" in chat.search_places(chat.SearchPlaces(city="Atlantis", kinds=["food"]), {})
    # Named-place lookups are capped per message, and an unknown city resolves nothing.
    idea = chat.PlaceIdea(name="X", day_number=0, city="Atlantis")
    assert chat.locate(idea, {"lookups": chat.MAX_LOOKUPS}) is None and chat.locate(idea, {}) is None


@pytest.mark.anyio
async def test_refusal_truncation_and_api_errors():
    events = await collect(chat.chat_events(req(), FakeAsyncClient(message(stop_reason="refusal"))))
    assert events[1] == ("text", {"text": "Sorry, I can't help with that one."})
    events = await collect(chat.chat_events(req(), FakeAsyncClient(message(tool_use("t", "check_fit", {}), stop_reason="max_tokens"))))
    assert events == [("status", {"text": "Thinking…"}), ("done", {})]
    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
    events = await collect(chat.chat_events(req(), FakeAsyncClient(error=err)))
    assert events[1][0] == "error" and events[-1] == ("done", {})


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


def test_context_maps_days_to_dates_weekdays_and_cities():
    trip = {"trip": {"name": "Japan", "dayCount": 3, "startDate": "2027-06-10",
                     "cities": [{"name": "Tokyo", "startDate": "2027-06-10", "endDate": "2027-06-11"},
                                {"name": "Kyoto", "startDate": "2027-06-12", "endDate": "2027-06-12"}]},
            "destinations": []}
    ctx = json.loads(chat.trip_context(trip))
    assert ctx["trip"]["days"] == [
        {"day": 1, "date": "2027-06-10", "weekday": "Thursday", "city": "Tokyo"},
        {"day": 2, "date": "2027-06-11", "weekday": "Friday", "city": "Tokyo"},
        {"day": 3, "date": "2027-06-12", "weekday": "Saturday", "city": "Kyoto"},
    ]
    assert ctx["today"] and "dayCount" not in ctx["trip"]


def test_tools_reject_days_past_the_trip_and_skip_duplicates():
    for name, args in [("add_places", {"places": [{"name": "X", "day_number": 3}]}),
                       ("propose_optimization", {"mode": "RELAXED", "day_number": 3, "instructions": ""})]:
        with pytest.raises(ValueError, match="trip has 2 days"):
            chat.run_tool(TRIP, name, args)
    text_, proposal = chat.run_tool(TRIP, "add_places", {"places": [
        {"name": "meiji jingu ", "day_number": 1}, {"name": "Tsukiji", "day_number": 2}, {"name": "TSUKIJI", "day_number": 0}]})
    assert proposal == {"type": "places", "places": [{"name": "Tsukiji", "day_number": 2}]}
    assert "meiji jingu" in text_ and "TSUKIJI" in text_
    text_, proposal = chat.run_tool(TRIP, "add_places", {"places": [{"name": "Cat Street", "day_number": 1}]})
    assert proposal is None and text_.startswith("Nothing added")


def test_viewers_get_no_places_to_add():
    text_, proposal = chat.run_tool(TRIP, "add_places", {"places": [{"name": "Tsukiji", "day_number": 2}]}, can_edit=False)
    assert proposal is None and "only view" in text_
    assert chat.ChatRequest.model_validate({"trip": {}, "messages": [{"role": "user", "content": "hi"}], "canEdit": False}).can_edit is False


@pytest.mark.anyio
async def test_the_last_round_must_reply_instead_of_calling_tools():
    fit = tool_use("c1", "check_fit", {"day_number": 1, "minutes": 60})
    fake = FakeAsyncClient(*[message(fit, stop_reason="tool_use") for _ in range(chat.MAX_TOOL_ROUNDS - 1)],
                           message(text("Day 1 has room.")))
    events = await collect(chat.chat_events(req(), fake))
    assert [c.get("tool_choice") for c in fake.calls] == [None] * (chat.MAX_TOOL_ROUNDS - 1) + [{"type": "none"}]
    assert ("text", {"text": "Day 1 has room."}) in events
