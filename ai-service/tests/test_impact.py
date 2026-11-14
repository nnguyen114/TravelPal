from fastapi.testclient import TestClient

from app import impact
from app.main import app

TRIP = {
    "trip": {"startDate": "2027-06-10", "dayCount": 3, "cities": [{"name": "Tokyo", "lat": 35.68, "lng": 139.76}]},
    "destinations": [
        {"id": "sensoji", "name": "Senso-ji", "lat": 35.7148, "lng": 139.7967, "dayIndex": 2, "position": 0, "startTime": "08:00", "durationMin": 60},
        {"id": "kappa", "name": "Kappabashi", "lat": 35.7134, "lng": 139.7883, "dayIndex": 2, "position": 1, "startTime": "09:10", "durationMin": 90},
        {"id": "meiji", "name": "Meiji Jingu", "lat": 35.6764, "lng": 139.6993, "dayIndex": 0, "position": 0, "startTime": "09:00", "durationMin": 90},
        {"id": "dinner", "name": "Dinner", "lat": 35.6595, "lng": 139.7005, "dayIndex": 0, "position": 1, "startTime": "19:00",
         "durationMin": 90, "locked": True},
    ],
}


def test_adding_to_a_day_reports_fit_and_what_shifts():
    out = impact.analyze(TRIP, [{"kind": "ADD", "name": "Tsukiji Outer Market", "lat": 35.6655, "lng": 139.7707, "dayIndex": 2,
                                 "durationMin": 60}])
    assert out["fits"].startswith("Yes: Tsukiji Outer Market on Day 3 at ")
    assert out["conflicts"] == "None with locks"
    assert out["days"] == [3]
    assert out["suggestedDay"] is None
    assert "moves to" in out["dayEffect"] or out["dayEffect"] == "Nothing else moves"


def test_unplaced_addition_gets_the_closest_day():
    out = impact.analyze(TRIP, [{"kind": "ADD", "name": "Ueno Park", "lat": 35.7156, "lng": 139.7745}])
    assert out["suggestedDay"] == 3
    assert "Ueno Park on Day 3" in out["fits"]


def test_moving_a_locked_plan_and_overfull_days_are_conflicts():
    out = impact.analyze(TRIP, [{"kind": "MOVE", "destinationId": "dinner", "dayIndex": 1}])
    assert out["conflicts"].startswith("It changes a locked plan")
    assert out["days"] == [1, 2]
    huge = impact.analyze(TRIP, [{"kind": "ADD", "name": "All-day museum", "lat": 35.71, "lng": 139.78, "dayIndex": 2, "durationMin": 600}])
    assert huge["fits"].startswith("Tight") and "runs past" in huge["conflicts"]


def test_removing_reports_the_day_and_no_location_add():
    out = impact.analyze(TRIP, [{"kind": "REMOVE", "destinationId": "sensoji"}, {"kind": "ADD", "name": "Somewhere"}])
    assert out["days"] == [3]
    assert out["suggestedDay"] is None
    assert "Somewhere has no map location yet" in out["conflicts"] and out["fits"] == "Not cleanly"


def test_endpoint_requires_internal_auth_and_validates(monkeypatch):
    client = TestClient(app)
    body = {"trip": TRIP, "changes": [{"kind": "REMOVE", "destinationId": "kappa"}]}
    assert client.post("/internal/impact", json=body).status_code == 401
    from app.security import require_internal
    app.dependency_overrides[require_internal] = lambda: {"iss": "core-api"}
    try:
        r = client.post("/internal/impact", json=body)
        assert r.status_code == 200 and r.json()["days"] == [3]
        assert client.post("/internal/impact", json={"trip": TRIP, "changes": []}).status_code == 422
    finally:
        app.dependency_overrides.clear()
