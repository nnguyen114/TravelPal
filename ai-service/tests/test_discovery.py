import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import discovery, places
from app.main import app

CENTER = {"lat": 35.67, "lng": 139.70}


def feature(name, lat, lng, pid, category="catering.cafe", area="Harajuku, Tokyo"):
    """A Places API feature; the geocoder answers text searches with the same properties as flat results."""
    return {"properties": {"name": name, "lat": lat, "lon": lng, "place_id": pid, "categories": ["catering", category],
                           "address_line2": area}}


PLACES = [feature("Koffee Mameya", 35.6680, 139.7080, "p1"), feature("Chain Coffee", 35.6700, 139.7010, "p2"),
          feature("Far Roastery", 35.7300, 139.8000, "p3"),
          feature("Bakery Cafe", 35.6690, 139.7020, "p4", "commercial.food_and_drink.bakery"),
          feature(None, 35.67, 139.70, "p5"), feature("Koffee Mameya", 35.6680, 139.7080, "p1"),
          feature("Second hand clothes", 35.67, 139.70, "p6", "commercial.clothing"), feature("Cafe", 35.67, 139.70, "p7")]


def geoapify(calls):
    def handler(request: httpx.Request):
        calls.append({"path": request.url.path, **dict(request.url.params)})
        if request.url.path == "/v2/places":
            return httpx.Response(200, json={"type": "FeatureCollection", "features": PLACES})
        return httpx.Response(200, json={"results": [f["properties"] for f in PLACES]})
    return httpx.Client(transport=httpx.MockTransport(handler))


def fake_vectors(texts):
    """Coffee-ish texts point one way, bakery another; closeness by keyword is enough to test the ranking logic."""
    def v(t):
        t = t.lower()
        return [1.0 if "mameya" in t or "independent" in t or "roastery" in t else 0.2,
                1.0 if "bakery" in t else 0.1, 0.5 if "chain" in t else 0.1]
    return [v(t) for t in texts]


def test_keyless_fallback_searches_the_request_and_sorts_by_distance():
    calls = []
    out = discovery.discover({"request": "coffee", "center": CENTER, "exclude": [{"name": "chain coffee"}]}, geoapify(calls))
    assert calls[0]["path"] == "/v1/geocode/search" and calls[0]["text"] == "coffee" and "categories" not in calls[0]
    assert calls[0]["filter"].startswith("rect:") and calls[0]["filter"].count(",") == 3 and calls[0]["apiKey"] == "test-key"
    names = [s["name"] for s in out["suggestions"]]
    assert "Chain Coffee" not in names and names.count("Koffee Mameya") == 1
    assert not {"Second hand clothes", "Cafe"} & set(names)
    assert names[0] in ("Bakery Cafe", "Koffee Mameya") and names[-1] == "Far Roastery"
    assert out["suggestions"][0]["why"].endswith("“coffee”.")
    assert out["note"].startswith("Opening hours")


def test_claude_plans_voyage_ranks_with_diversity_and_claude_explains(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    answers = iter([
        {"vibe": "independent, design-led specialty coffee", "searches": [{"q": "specialty coffee", "category": "catering.cafe"},
                                                                          {"q": "roastery", "category": "bad category!"}]},
        {"reasons": [{"n": 0, "why": "Tiny independent roaster near your saved cafes.", "fits": True},
                     {"n": 9, "why": "ignored", "fits": True}, {"n": 2, "why": "A chain.", "fits": False}]},
    ])
    monkeypatch.setattr(discovery.claude, "_json_call", lambda *a: next(answers))
    monkeypatch.setattr(discovery, "embed", fake_vectors)
    calls = []
    out = discovery.discover({"request": "chic cafes like the ones I saved", "center": CENTER, "count": 3,
                              "taste": [{"name": "Fuglen", "category": "cafe"}], "seeds": [{"name": "Onibus Coffee", "category": "cafe"}],
                              "exclude": [{"providerId": "geoapify:p2"}]}, geoapify(calls))
    # A category lists every place of that kind; an invalid category falls back to a text search.
    assert calls[0]["path"] == "/v2/places" and calls[0]["categories"] == "catering.cafe"
    assert calls[1]["path"] == "/v1/geocode/search" and calls[1]["text"] == "roastery"
    assert len(calls) == 4 and calls[2]["filter"] != calls[0]["filter"]  # thin pool: same searches, bigger area
    assert out["vibe"] == "independent, design-led specialty coffee"
    picks = out["suggestions"]
    assert picks[0]["name"] == "Koffee Mameya" and picks[0]["why"] == "Tiny independent roaster near your saved cafes."
    # three usable candidates (chain excluded by id), the one Claude flagged as a misfit is dropped
    assert len(picks) == 2 and "A chain." not in [p["why"] for p in picks]
    assert all("_v" not in p for p in picks)


def test_place_search_outage_is_reported_not_shown_as_no_results(monkeypatch):
    down = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429)))
    with pytest.raises(places.Unavailable):
        discovery.discover({"seeds": [{"name": "Onibus", "category": "cafe"}], "center": CENTER}, down)
    monkeypatch.setattr(places, "CLIENT", down)
    from app.security import require_internal
    app.dependency_overrides[require_internal] = lambda: {"iss": "core-api"}
    try:
        r = TestClient(app).post("/internal/discover", json={"request": "coffee", "center": CENTER})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503 and r.json()["detail"] == "Place search is unavailable right now."


def test_empty_plans_fall_back_to_a_plain_search(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(discovery.claude, "_json_call", lambda *a: None)
    vibe, searches = discovery.plan_searches({"center": CENTER})
    assert vibe == "things to see" and searches == [{"q": "attraction", "category": ""}]


def test_embed_needs_a_key_and_survives_voyage_errors(monkeypatch):
    assert discovery.embed(["a"]) is None
    monkeypatch.setenv("VOYAGE_API_KEY", "x")
    import voyageai
    from voyageai.error import AuthenticationError

    class Boom:
        def __init__(self, **kw):
            pass

        def embed(self, *a, **kw):
            raise AuthenticationError("bad key")
    monkeypatch.setattr(voyageai, "Client", Boom)
    assert discovery.embed(["a"]) is None

    class Ok(Boom):
        def embed(self, texts, **kw):
            assert kw["input_type"] == "document"
            return type("E", (), {"embeddings": [[1.0]] * len(texts)})()
    monkeypatch.setattr(voyageai, "Client", Ok)
    assert discovery.embed(["a", "b"]) == [[1.0], [1.0]]


def test_endpoints_validate_and_need_auth(monkeypatch):
    client = TestClient(app)
    assert client.post("/internal/discover", json={"center": CENTER}).status_code == 401
    from app.security import require_internal
    app.dependency_overrides[require_internal] = lambda: {"iss": "core-api"}
    monkeypatch.setattr(discovery, "discover", lambda req: {"suggestions": [], "echo": req["radiusKm"]})
    monkeypatch.setattr("app.main.links.resolve", lambda url, near: {"readable": False, "url": url})
    try:
        assert client.post("/internal/discover", json={"center": CENTER}).json() == {"suggestions": [], "echo": 3}
        assert client.post("/internal/discover", json={"center": CENTER, "radiusKm": 99}).status_code == 422
        assert client.post("/internal/link", json={"url": "https://example.com/x"}).json()["url"] == "https://example.com/x"
        assert client.post("/internal/link", json={"url": "x"}).status_code == 422
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("vectors", [[[1.0, 0.0], [0.0, 1.0]]])
def test_cosine_and_mean(vectors):
    assert discovery.cosine(*vectors) == 0
    assert discovery.mean(vectors) == [0.5, 0.5]
    assert json.dumps(discovery.describe({"name": "A", "category": "", "address": "B"})) == '"A \\u2014 B"'
