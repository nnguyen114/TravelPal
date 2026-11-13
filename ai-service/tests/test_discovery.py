import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import discovery
from app.main import app

CENTER = {"lat": 35.67, "lng": 139.70}


def feature(name, lat, lng, osm_id, value="cafe", district="Harajuku"):
    return {"geometry": {"coordinates": [lng, lat]},
            "properties": {"name": name, "osm_type": "N", "osm_id": osm_id, "osm_value": value, "district": district, "city": "Tokyo"}}


PHOTON = [feature("Koffee Mameya", 35.6680, 139.7080, 1), feature("Chain Coffee", 35.6700, 139.7010, 2),
          feature("Far Roastery", 35.7300, 139.8000, 3), feature("Bakery Cafe", 35.6690, 139.7020, 4, "bakery"),
          feature(None, 35.67, 139.70, 5), feature("Koffee Mameya", 35.6680, 139.7080, 1),
          feature("Second hand clothes", 35.67, 139.70, 6, "clothes"), feature("Cafe", 35.67, 139.70, 7)]


def photon(calls):
    def handler(request: httpx.Request):
        calls.append(dict(request.url.params))
        return httpx.Response(200, json={"features": PHOTON})
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
    out = discovery.discover({"request": "coffee", "center": CENTER, "exclude": [{"name": "chain coffee"}]}, photon(calls))
    assert calls[0]["q"] == "coffee" and "osm_tag" not in calls[0] and calls[0]["bbox"].count(",") == 3
    names = [s["name"] for s in out["suggestions"]]
    assert "Chain Coffee" not in names and names.count("Koffee Mameya") == 1
    assert not {"Second hand clothes", "Cafe"} & set(names)
    assert names[0] in ("Bakery Cafe", "Koffee Mameya") and names[-1] == "Far Roastery"
    assert out["suggestions"][0]["why"].endswith("“coffee”.")
    assert out["note"].startswith("Opening hours")


def test_claude_plans_voyage_ranks_with_diversity_and_claude_explains(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    answers = iter([
        {"vibe": "independent, design-led specialty coffee", "searches": [{"q": "specialty coffee", "osm_tag": "amenity:cafe"},
                                                                          {"q": "roastery", "osm_tag": "bad tag!"}]},
        {"reasons": [{"n": 0, "why": "Tiny independent roaster near your saved cafes.", "fits": True},
                     {"n": 9, "why": "ignored", "fits": True}, {"n": 2, "why": "A chain.", "fits": False}]},
    ])
    monkeypatch.setattr(discovery.claude, "_json_call", lambda *a: next(answers))
    monkeypatch.setattr(discovery, "embed", fake_vectors)
    calls = []
    out = discovery.discover({"request": "chic cafes like the ones I saved", "center": CENTER, "count": 3,
                              "taste": [{"name": "Fuglen", "category": "cafe"}], "seeds": [{"name": "Onibus Coffee", "category": "cafe"}],
                              "exclude": [{"providerId": "osm:N2"}]}, photon(calls))
    assert calls[0]["osm_tag"] == "amenity:cafe" and "osm_tag" not in calls[1]
    assert calls[2] == {**calls[2], "q": "cafe", "osm_tag": "amenity:cafe"}  # thin pool: broad same-kind search
    assert out["vibe"] == "independent, design-led specialty coffee"
    picks = out["suggestions"]
    assert picks[0]["name"] == "Koffee Mameya" and picks[0]["why"] == "Tiny independent roaster near your saved cafes."
    # three usable candidates (chain excluded by id), the one Claude flagged as a misfit is dropped
    assert len(picks) == 2 and "A chain." not in [p["why"] for p in picks]
    assert all("_v" not in p for p in picks)


def test_photon_errors_and_empty_plans_degrade_gracefully(monkeypatch):
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert discovery.discover({"seeds": [{"name": "Onibus", "category": "cafe"}], "center": CENTER}, client)["suggestions"] == []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(discovery.claude, "_json_call", lambda *a: None)
    vibe, searches = discovery.plan_searches({"center": CENTER})
    assert vibe == "things to see" and searches == [{"q": "attraction", "osm_tag": ""}]


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
