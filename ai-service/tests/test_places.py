import httpx
import pytest

from app import places


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_text_search_uses_the_geocoder_and_maps_results():
    seen = {}

    def handler(r):
        seen.update(path=r.url.path, **r.url.params)
        return httpx.Response(200, json={"results": [
            {"name": " Senso-ji ", "lat": 35.71, "lon": 139.79, "place_id": "abc", "category": "tourism.sights.place_of_worship",
             "address_line2": "Asakusa, Taito, Tokyo, Japan"},
            {"address_line1": "Lisbon", "lat": 38.7, "lon": -9.1, "place_id": "lis", "address_line2": "Portugal"},
            {"lat": 0, "lon": 0, "place_id": "nameless"},
        ]})
    out = places.search("senso", near={"lat": 35.7, "lng": 139.8}, http=client(handler))
    assert out == [
        {"name": "Senso-ji", "lat": 35.71, "lng": 139.79, "providerId": "geoapify:abc", "category": "place of worship",
         "address": "Asakusa, Taito, Tokyo, Japan"},
        {"name": "Lisbon", "lat": 38.7, "lng": -9.1, "providerId": "geoapify:lis", "category": "", "address": "Portugal"},
    ]
    assert seen["path"] == "/v1/geocode/search" and seen["text"] == "senso" and seen["bias"] == "proximity:139.8,35.7"
    assert seen["apiKey"] == "test-key" and "filter" not in seen


def test_category_search_uses_the_places_api():
    seen = {}

    def handler(r):
        seen.update(path=r.url.path, **r.url.params)
        return httpx.Response(200, json={"features": [{"properties": {
            "name": "Fuglen", "lat": 35.66, "lon": 139.69, "place_id": "f", "categories": ["catering", "catering.cafe.coffee_shop", "internet_access.limited", "dogs.yes"]}}]})
    out = places.search("coffee", bbox="139.6,35.6,139.8,35.8", category="catering.cafe", http=client(handler))
    assert out[0]["category"] == "coffee shop" and out[0]["providerId"] == "geoapify:f"
    assert seen["path"] == "/v2/places" and seen["categories"] == "catering.cafe" and seen["filter"] == "rect:139.6,35.6,139.8,35.8"


@pytest.mark.parametrize("response", [httpx.Response(401), httpx.Response(429), httpx.Response(200, text="<html>oops</html>")])
def test_failures_are_unavailable_not_empty(response, caplog):
    with pytest.raises(places.Unavailable):
        places.search("x", http=client(lambda r: response))
    assert "test-key" not in caplog.text  # the key is in the URL; logs must never carry it


def test_require_name_drops_address_only_results():
    rows = {"results": [{"address_line1": "Mintei", "lat": 1, "lon": 2, "place_id": "a"},
                        {"name": " ", "address_line1": "Mintei", "lat": 1, "lon": 2, "place_id": "b"},
                        {"name": "Mintei", "lat": 1, "lon": 2, "place_id": "c"}]}
    assert [p["providerId"] for p in places.search("mintei", http=client(lambda r: httpx.Response(200, json=rows)))] == [
        "geoapify:a", "geoapify:b", "geoapify:c"]
    assert [p["providerId"] for p in places.search("mintei", require_name=True,
                                                   http=client(lambda r: httpx.Response(200, json=rows)))] == ["geoapify:c"]


def test_no_key_means_unavailable(monkeypatch):
    monkeypatch.delenv("PLACES_API_KEY")
    with pytest.raises(places.Unavailable):
        places.search("x", http=client(lambda r: 1 / 0))
