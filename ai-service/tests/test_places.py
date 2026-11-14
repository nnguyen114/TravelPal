import httpx
import pytest

from app import places


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_maps_features_to_places_and_skips_nameless_ones():
    seen = {}

    def handler(r):
        seen.update(r.url.params)
        return httpx.Response(200, json={"features": [
            {"geometry": {"coordinates": [139.79, 35.71]},
             "properties": {"name": " Senso-ji ", "osm_type": "W", "osm_id": 1, "osm_value": "place_of_worship", "city": "Tokyo"}},
            {"geometry": {"coordinates": [0, 0]}, "properties": {"osm_type": "N", "osm_id": 2}},
        ]})
    out = places.search("senso", near={"lat": 35.7, "lng": 139.8}, osm_tag="amenity:cafe", http=client(handler))
    assert out == [{"name": "Senso-ji", "lat": 35.71, "lng": 139.79, "providerId": "osm:W1", "category": "place of worship",
                    "address": "Tokyo"}]
    assert seen["lat"] == "35.7" and seen["lon"] == "139.8" and seen["osm_tag"] == "amenity:cafe" and "bbox" not in seen


@pytest.mark.parametrize("response", [httpx.Response(429), httpx.Response(200, text="<html>blocked</html>")])
def test_throttling_or_garbage_is_unavailable_not_empty(response):
    with pytest.raises(places.Unavailable):
        places.search("x", http=client(lambda r: response))
