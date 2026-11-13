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
