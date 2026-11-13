import json

import anthropic
import httpx
import pytest

from app import claude
from tests.fakes import FakeClient, message, text

JOB = {"trip": {"dayCount": 3}, "destinations": [{"id": "a", "name": "teamLab Planets"}, {"id": "b", "name": "Senso-ji"}],
       "mode": "BALANCED", "instructions": "start 10:00, slow day 3, extra hour at teamlab"}
RESULT = {"scheduled": 1, "total": 2, "moved": ["a"], "added": [], "unscheduled": ["b"], "keptLocked": ["b"],
          "needsReview": [{"id": "b", "reason": "Opening hours unknown"}]}


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")


def use(monkeypatch, fake):
    monkeypatch.setattr(claude, "_client", fake)
    return fake


def test_no_key_means_no_calls_and_plain_notes():
    assert claude.parse_constraints("start at 10", JOB) is None
    out = claude.explain(JOB, RESULT)
    assert out["explanation"] == "1 of 2 places scheduled at a balanced pace."
    assert [n["kind"] for n in out["notes"]] == ["verified", "suggestion", "unsure"]
    assert "Senso-ji: Opening hours unknown" in out["notes"][2]["text"]


def test_parses_constraints_and_drops_out_of_range(with_key, monkeypatch):
    fake = use(monkeypatch, FakeClient(message(text(json.dumps({
        "start_time": "10:00", "end_time": "25:99", "slower_days": [3, 9],
        "extra_minutes": [{"place": "teamLab", "minutes": 60}, {"place": "", "minutes": 5}, {"place": "x", "minutes": 9999}]})))))
    c = claude.parse_constraints(JOB["instructions"], JOB)
    assert (c.start_time, c.end_time, c.slower_days) == (600, None, [2])
    assert c.extra_minutes == {"teamlab": 60, "x": 600}
    call = fake.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["fallbacks"] == "default"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert "<request>start 10:00" in call["messages"][0]["content"]


def test_blank_instructions_skip_the_call(with_key, monkeypatch):
    fake = use(monkeypatch, FakeClient())
    assert claude.parse_constraints("   ", JOB) is None
    assert fake.calls == []


def test_explain_uses_claude_and_falls_back_on_errors(with_key, monkeypatch):
    use(monkeypatch, FakeClient(message(text(json.dumps({"explanation": "Grouped by area.", "notes": [{"kind": "verified", "text": "Dinner kept."}]})))))
    assert claude.explain(JOB, RESULT)["explanation"] == "Grouped by area."

    use(monkeypatch, FakeClient(message(text("{}"), stop_reason="refusal")))
    assert claude.explain(JOB, RESULT)["explanation"].startswith("1 of 2")

    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
    use(monkeypatch, FakeClient(error=err))
    assert claude.explain(JOB, RESULT)["explanation"].startswith("1 of 2")
    assert claude.parse_constraints("x", JOB) is None


def test_client_is_created_once(with_key, monkeypatch):
    monkeypatch.setattr(claude, "_client", None)
    assert claude.client() is claude.client()


HINT_JOB = {"trip": {"dayCount": 2, "cities": [{"name": "Tokyo"}]}, "destinations": [
    {"id": "g", "name": "Golden Gai", "address": "Kabukicho"}, {"id": "t", "name": "Tsukiji"},
    {"id": "n", "name": "Nikko"}, {"id": "u", "name": "User tagged", "hintsSource": "USER"}]}


def test_place_hints_only_for_untagged_and_validated(with_key, monkeypatch):
    fake = use(monkeypatch, FakeClient(message(text(json.dumps({"places": [
        {"n": 0, "visit_after": "19:00", "visit_before": "", "day_trip": False},
        {"n": 1, "visit_after": "", "visit_before": "11:00", "day_trip": False},
        {"n": 2, "visit_after": "18:00", "visit_before": "09:00", "day_trip": True},
        {"n": 7, "visit_after": "", "visit_before": "", "day_trip": True}]})))))
    hints = claude.place_hints(HINT_JOB)
    assert hints == {"g": {"visitAfter": "19:00", "visitBefore": None, "dayTrip": False},
                     "t": {"visitAfter": None, "visitBefore": "11:00", "dayTrip": False},
                     "n": {"visitAfter": "18:00", "visitBefore": None, "dayTrip": True}}
    assert "User tagged" not in fake.calls[0]["messages"][0]["content"]


def test_place_hints_skip_without_key_or_work(monkeypatch):
    assert claude.place_hints(HINT_JOB) == {}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    assert claude.place_hints({"trip": {"cities": []}, "destinations": [{"id": "u", "name": "x", "hintsSource": "AI"}]}) == {}
    use(monkeypatch, FakeClient(message(text("{}"), stop_reason="refusal")))
    assert claude.place_hints(HINT_JOB) == {}


def test_fallback_notes_mention_day_trips_and_timing():
    result = {**RESULT, "dayTrips": ["a"], "timed": [{"id": "b", "after": "19:00", "before": None}, {"id": "a", "after": None, "before": "11:00"}]}
    texts = [n["text"] for n in claude.explain(JOB, result)["notes"]]
    assert "teamLab Planets: planned as a day trip on a day of its own." in texts
    assert "Senso-ji is scheduled after 19:00, when it makes sense to go." in texts
    assert "teamLab Planets is scheduled before 11:00, when it makes sense to go." in texts
