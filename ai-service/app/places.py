"""Place search on OpenStreetMap data through Geoapify, shared by Find More Places and link import.

Text search uses Geoapify's geocoder; "places of a kind in this area" uses its Places API by category. One client
for the whole service (connection reuse, a timeout). A failure raises Unavailable so callers can say "search is
down" instead of showing an empty result as if nothing matched. The API key travels in the URL, so errors are
logged by status or exception type only, never by message (which would include the URL).
"""

import logging
import os
import re

import httpx

log = logging.getLogger(__name__)
API = "https://api.geoapify.com"
CLIENT = httpx.Client(headers={"User-Agent": "travelpal-ai-service"}, timeout=8)
CATEGORY = re.compile(r"^[a-z_]+(\.[a-z_]+)*$")
# Geoapify's "categories" also carry attributes (internet_access.limited, dogs.yes); only these groups name a kind
# of place a traveler would recognise.
KINDS = ("accommodation", "activity", "catering", "commercial", "entertainment", "heritage", "leisure", "natural",
         "religion", "sport", "tourism")


class Unavailable(Exception):
    """Place search failed, timed out, was refused, or has no API key configured."""


def search(q: str, *, near: dict | None = None, bbox: str | None = None, category: str = "", limit: int = 10,
           http: httpx.Client | None = None) -> list[dict]:
    """Places matching the text, or (with a category) places of that kind in the box. bbox: "lon1,lat1,lon2,lat2"."""
    key = os.environ.get("PLACES_API_KEY")
    if not key:
        log.error("PLACES_API_KEY is not set; place search is off")
        raise Unavailable
    params: dict = {"limit": limit, "lang": "en", "apiKey": key}
    if category:
        url, params["categories"] = f"{API}/v2/places", category
    else:
        url, params["text"], params["format"] = f"{API}/v1/geocode/search", q, "json"
    if bbox:
        params["filter"] = f"rect:{bbox}"
    if near:
        params["bias"] = f"proximity:{near['lng']},{near['lat']}"
    try:
        res = (http or CLIENT).get(url, params=params)
        res.raise_for_status()
        data = res.json()
    except httpx.HTTPStatusError as e:
        log.warning("place search failed: HTTP %s", e.response.status_code)
        raise Unavailable from e
    except (httpx.HTTPError, ValueError) as e:
        log.warning("place search failed: %s", type(e).__name__)
        raise Unavailable from e
    rows = [f["properties"] for f in data.get("features", [])] if category else data.get("results", [])
    return [place(r) for r in rows if r.get("name") or r.get("address_line1")]


def place(r: dict) -> dict:
    """A geocoder result or Places API feature properties, as the app's place."""
    categories = [c for c in r.get("categories") or [r.get("category") or ""] if c.split(".")[0] in KINDS]
    kind = max(categories, key=len).rsplit(".", 1)[-1].replace("_", " ") if categories else ""
    return {
        "name": (r.get("name") or r["address_line1"]).strip(), "lat": r["lat"], "lng": r["lon"],
        "providerId": f"geoapify:{r['place_id']}",
        "category": kind,
        "address": r.get("address_line2") or "",
    }
