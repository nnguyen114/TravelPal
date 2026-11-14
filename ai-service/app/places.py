"""Place search on OpenStreetMap data through Photon, shared by Find More Places and link import.

One client for the whole service (connection reuse, a timeout). A provider failure raises Unavailable so callers can
say "search is down" instead of showing an empty result as if nothing matched.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)
PLACES_URL = os.environ.get("PLACES_URL", "https://photon.komoot.io")
CLIENT = httpx.Client(headers={"User-Agent": "travelpal-ai-service"}, timeout=8)


class Unavailable(Exception):
    """The place provider failed, timed out or refused us (outage, throttling)."""


def search(q: str, *, near: dict | None = None, bbox: str | None = None, osm_tag: str = "", limit: int = 10,
           http: httpx.Client | None = None) -> list[dict]:
    params: dict = {"q": q, "limit": limit, "lang": "en"}
    if near:
        params |= {"lat": near["lat"], "lon": near["lng"]}
    if bbox:
        params["bbox"] = bbox
    if osm_tag:
        params["osm_tag"] = osm_tag
    try:
        res = (http or CLIENT).get(f"{PLACES_URL}/api/", params=params)
        res.raise_for_status()
        features = res.json().get("features", [])
    except (httpx.HTTPError, ValueError) as e:
        log.warning("place search failed (%s): %s", PLACES_URL, e)
        raise Unavailable from e
    return [place(f) for f in features if (f.get("properties") or {}).get("name")]


def place(feature: dict) -> dict:
    p, (lng, lat) = feature["properties"], feature["geometry"]["coordinates"]
    return {
        "name": p["name"].strip(), "lat": lat, "lng": lng,
        "providerId": f"osm:{p.get('osm_type')}{p.get('osm_id')}",
        "category": (p.get("osm_value") or "").replace("_", " "),
        "address": ", ".join(str(p[k]) for k in ("street", "district", "city", "country") if p.get(k)),
    }
