import json

import pytest
from moto import mock_aws

from app import worker

JOB = {"previewId": "p1", "mode": "BALANCED", "scope": "TRIP",
       "trip": {"startDate": "2027-06-10", "dayCount": 1, "cities": [{"name": "Tokyo", "lat": 35.68, "lng": 139.76}]},
       "destinations": [{"id": "a", "name": "Senso-ji", "lat": 35.7148, "lng": 139.7967}]}


@pytest.fixture
def sqs(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with mock_aws():
        yield worker.sqs_client()


def test_job_in_result_out(sqs):
    jobs, results = worker.queue_url(sqs, "jobs"), worker.queue_url(sqs, "results")
    assert worker.queue_url(sqs, "jobs") == jobs  # idempotent
    sqs.send_message(QueueUrl=jobs, MessageBody=json.dumps(JOB))
    sqs.send_message(QueueUrl=jobs, MessageBody=json.dumps({"previewId": "p2", "trip": {}}))
    assert worker.process_once(sqs, jobs, results, wait_seconds=0) == 2
    out = {m["previewId"]: m for m in (json.loads(x["Body"]) for x in sqs.receive_message(QueueUrl=results, MaxNumberOfMessages=10)["Messages"])}
    assert out["p1"]["status"] == "READY"
    assert out["p1"]["result"]["items"][0]["dayIndex"] == 0
    assert out["p1"]["result"]["explanation"].startswith("1 of 1")
    assert out["p1"]["result"]["constraintsUnderstood"] is False
    assert out["p2"] == {"previewId": "p2", "status": "FAILED", "error": "The optimizer couldn't build a plan."}
    assert sqs.receive_message(QueueUrl=jobs).get("Messages") is None  # both jobs deleted


def test_background_loop_starts_and_stops(sqs, monkeypatch):
    import threading
    calls = []
    monkeypatch.setattr(worker, "sqs_client", lambda: sqs)

    def fake_once(*a):
        calls.append(1)
        raise RuntimeError("boom") if len(calls) == 1 else stop.set()
    stop = threading.Event()
    monkeypatch.setattr(worker, "process_once", fake_once)
    monkeypatch.setattr(stop, "wait", lambda s: None)
    worker.start(stop).join(timeout=5)
    assert len(calls) == 2


def test_hints_from_claude_and_distance_are_returned_for_untagged_places(monkeypatch):
    job = {"previewId": "p", "mode": "BALANCED", "scope": "TRIP",
           "trip": {"startDate": "2027-06-10", "dayCount": 2, "cities": [{"name": "Tokyo", "lat": 35.68, "lng": 139.76}]},
           "destinations": [{"id": "gai", "name": "Golden Gai", "lat": 35.6938, "lng": 139.7046},
                            {"id": "nikko", "name": "Toshogu", "lat": 36.7581, "lng": 139.5988},
                            {"id": "mine", "name": "Mine", "lat": 35.68, "lng": 139.70, "hintsSource": "USER", "visitAfter": "15:00"}]}
    monkeypatch.setattr(worker.claude, "place_hints", lambda j: {"gai": {"visitAfter": "20:00", "visitBefore": None, "dayTrip": False}})
    out = worker.handle(job)
    assert out["hints"] == [{"id": "gai", "visitAfter": "20:00", "visitBefore": None, "dayTrip": False},
                            {"id": "nikko", "visitAfter": None, "visitBefore": None, "dayTrip": True}]
    items = {i["id"]: i for i in out["items"]}
    assert items["gai"]["startTime"] >= "20:00"
    assert items["nikko"]["dayIndex"] != items["gai"]["dayIndex"]
