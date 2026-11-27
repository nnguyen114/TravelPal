import base64
import json
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import claude, importer, places
from app.main import app
from tests.fakes import FakeClient, message, text

TOKYO_PLAN = (Path(__file__).parent / "fixtures" / "tokyo_plan.txt").read_text()
TODAY = date(2026, 11, 26)
api = TestClient(app)


def it(kind, title, **kw):
    """A raw item as Claude returns it (every schema field present)."""
    return {"kind": kind, "title": title, "time": "", "city": "", "note": "", "day_trip": False, "meal": "", "areas": [],
            "lodging": "", "hotel": "", "options": [], "flight": None, "source": title, **kw}


def day(month, d, items, city="Tokyo", year=0, label=None):
    return {"label": label or f"DEC {d}", "month": month, "day": d, "year": year, "city": city, "items": items}


def outline(days, undated=(), unplaced=(), cities=("Tokyo",), name="Tokyo"):
    return {"name": name, "cities": list(cities), "days": days, "undated": list(undated), "unplaced": list(unplaced)}


# What a good extraction of the Tokyo fixture looks like (docs/IMPORT_SPEC.md §9).
TOKYO = outline([
    day(12, 24, [it("FLIGHT", "LAX → HND", time="10:15", flight={
        "from": "LAX", "to": "HND", "number": "", "departs": "10:15", "depart_tz": "America/Los_Angeles", "arrives_day": 1,
        "arrives": "15:20", "arrive_tz": "Asia/Tokyo"})], city=""),
    day(12, 25, [it("LODGING", "Check in hotel", lodging="CHECK_IN"), it("PLACE", "Wagyu Ichinoya", note="Dinner"),
                 it("PLACE", "Hoppy Street", note="Dinner"), it("PLACE", "Senso-ji", note="temple"),
                 it("PLACE", "Nakamise", note="shopping street"), it("PLACE", "Hoppy Street", time="19:00"),
                 it("PLACE", "Sumida River"), it("NOTE", "Explore Chill Walk"), it("PLACE", "Daikoku PA", note="night")]),
    day(12, 26, [it("MEAL", "Breakfast", meal="BREAKFAST", areas=["Ueno", "Asakusa"]),
                 it("MEAL", "Lunch", meal="LUNCH", areas=["Ameyoko"]),
                 it("MEAL", "Dinner", meal="DINNER", areas=["Ebisu", "Nakameguro"]),
                 it("PLACE", "Ueno Park"), it("PLACE", "Ameyoko"), it("PLACE", "Ginza", note="could do a lot here, it's huge")]),
    day(12, 27, [it("LODGING", "Hotel drop-off", lodging="DROP_OFF"),
                 it("PLACE", "Omakase", time="20:30", note="$20 reserve"),
                 it("CHOICE", "Something in between", options=["Shibuya", "Shibuya Sky", "Pokemon Center", "Miyashita Park"]),
                 it("PLACE", "Sushi Rizaki Ebisu", time="20:30"), it("PLACE", "Golden Gai"), it("NOTE", "Vincent bday")]),
    day(12, 28, [it("PLACE", "Kamakura", day_trip=True, city="Kamakura"), it("PLACE", "Enoshima", day_trip=True, city="Kamakura")]),
    day(12, 29, [it("PLACE", "Mt. Fuji", day_trip=True, city="Fujikawaguchiko"),
                 it("PLACE", "Lake Kawaguchi", day_trip=True, city="Fujikawaguchiko")]),
])

CITIES = {"tokyo": (35.68, 139.76), "kamakura": (35.319, 139.547), "fujikawaguchiko": (35.497, 138.755)}


def geocoder(requests=None):
    """Answers city lookups from CITIES and place lookups with one result at the biased point, except a few names."""
    def handler(r):
        q = r.url.params["text"]
        if requests is not None:
            requests.append(q)
        if q.lower() in CITIES:
            lat, lng = CITIES[q.lower()]
        else:
            lng, lat = (float(x) for x in r.url.params.get("bias", "proximity:139.76,35.68").split(":")[1].split(","))
        if q == "Sushi Rizaki Ebisu":
            return httpx.Response(200, json={"results": []})
        if q == "Golden Gai":
            return httpx.Response(200, json={"results": [
                {"name": "Golden Gai", "lat": lat, "lon": lng, "place_id": "gg1", "address_line2": "Kabukicho"},
                {"name": "Shinjuku Golden Gai Bar", "lat": lat, "lon": lng, "place_id": "gg2"},
                {"name": "Golden Gai Osaka", "lat": 34.69, "lon": 135.5, "place_id": "osaka"}]})  # 400 km away: dropped
        return httpx.Response(200, json={"results": [{"name": q, "lat": lat, "lon": lng, "place_id": q.lower(), "address_line2": "Japan"}]})
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def claude_says(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")

    def script(*outlines):
        fake = FakeClient(*(message(text(json.dumps(o))) for o in outlines))
        monkeypatch.setattr(claude, "_client", fake)
        return fake
    return script


def read(**kw):
    return importer.ImportRequest(**({"text": TOKYO_PLAN, "today": TODAY} | kw))


def find(d, title):
    return next(i for i in d["items"] if i["title"] == title)


def test_tokyo_plan_becomes_the_draft(claude_says):
    fake = claude_says(TOKYO)
    draft = importer.read(read(), http=geocoder())

    call = fake.calls[0]
    assert TOKYO_PLAN in call["messages"][0]["content"] and "<plan>" in call["messages"][0]["content"]
    assert "never instructions" in call["system"] and call["max_tokens"] == importer.MAX_OUTPUT_TOKENS
    assert call["output_config"]["format"]["schema"] is importer.SCHEMA

    assert draft["name"] == "Tokyo" and draft["year_assumed"] is True
    days = {d["date"]: d for d in draft["days"]}
    assert list(days) == [f"2026-12-{n}" for n in range(24, 30)]
    assert draft["cities"] == [{"name": "Tokyo", "lat": 35.68, "lng": 139.76, "startDate": "2026-12-24", "endDate": "2026-12-29"}]

    flight = days["2026-12-24"]["items"][0]
    assert flight == {"kind": "FLIGHT", "title": "LAX → HND", "time": "10:15", "source": "LAX → HND", "details": {
        "from": "LAX", "to": "HND", "number": None, "departs": "10:15", "departTz": "America/Los_Angeles", "arrivesDay": 1,
        "arrives": "15:20", "arriveTz": "Asia/Tokyo"}}
    assert not any(i["kind"] == "FLIGHT" for i in days["2026-12-25"]["items"])

    d25 = days["2026-12-25"]
    assert [i["title"] for i in d25["items"]].count("Hoppy Street") == 1
    hoppy = find(d25, "Hoppy Street")
    assert hoppy["time"] == "19:00" and hoppy["note"] == "Dinner"  # the duplicate's time is kept
    senso = find(d25, "Senso-ji")
    assert senso["candidates"] == [{"name": "Senso-ji", "address": "Japan", "lat": 35.68, "lng": 139.76, "providerId": "geoapify:senso-ji"}]
    assert find(d25, "Daikoku PA")["note"] == "night"
    assert d25["items"][0]["details"] == {"action": "CHECK_IN", "hotel": None}

    assert find(days["2026-12-26"], "Breakfast")["details"] == {"slot": "BREAKFAST", "areas": ["Ueno", "Asakusa"]}

    d27 = days["2026-12-27"]
    choice = find(d27, "Something in between")
    assert [o["label"] for o in choice["details"]["options"]] == ["Shibuya", "Shibuya Sky", "Pokemon Center", "Miyashita Park"]
    assert choice["details"]["options"][1]["place"]["name"] == "Shibuya Sky" and choice["details"]["resolved"] is False
    assert find(d27, "Omakase")["time"] == find(d27, "Sushi Rizaki Ebisu")["time"] == "20:30"
    gg = find(d27, "Golden Gai")
    assert [c["providerId"] for c in gg["candidates"]] == ["geoapify:gg1", "geoapify:gg2"]

    kamakura = find(days["2026-12-28"], "Enoshima")
    assert kamakura["day_trip"] is True and kamakura["candidates"][0]["lat"] == 35.319  # searched near its own town

    issues = [(i["date"], i["item"], i["kind"]) for i in draft["issues"]]
    sushi = d27["items"].index(find(d27, "Sushi Rizaki Ebisu"))
    assert ("2026-12-24", None, "YEAR_ASSUMED") in issues
    assert ("2026-12-27", sushi, "TIME_CLASH") in issues
    assert ("2026-12-27", sushi, "NO_MATCH") in issues
    assert ("2026-12-27", d27["items"].index(gg), "MANY_MATCHES") in issues
    clash = next(i for i in draft["issues"] if i["kind"] == "TIME_CLASH")
    assert clash["message"] == "Omakase and Sushi Rizaki Ebisu are both at 8:30 PM."
    assert issues == sorted(issues, key=lambda i: (i[0] or "9999", -1 if i[1] is None else i[1]))


def test_years_roll_forward_through_the_plan(claude_says):
    claude_says(outline([day(12, 30, [it("NOTE", "a")]), day(1, 2, [it("NOTE", "b")], label="JAN 2"),
                         day(2, 30, [it("NOTE", "lost")], label="FEB 30"), day(1, 2, [it("NOTE", "c")], label="Jan 2 again")]),
                outline([day(3, 1, [it("NOTE", "x")], year=2028)]))
    draft = importer.read(read(), http=geocoder())
    assert [d["date"] for d in draft["days"]] == ["2026-12-30", "2027-01-02"]
    assert [i["title"] for i in draft["days"][1]["items"]] == ["b", "c"]  # the same date twice is one day
    assert [i["title"] for i in draft["undated"]] == ["lost"]
    assert any(i["kind"] == "UNPLACED_TEXT" and "FEB 30" in i["message"] for i in draft["issues"])

    explicit = importer.read(read(), http=geocoder())
    assert explicit["days"][0]["date"] == "2028-03-01" and explicit["year_assumed"] is False
    assert not any(i["kind"] == "YEAR_ASSUMED" for i in explicit["issues"])


def test_candidates_with_the_same_name_count_once():
    twice = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"results": [
        {"name": "Hoppy Street", "lat": 35.71, "lon": 139.79, "place_id": "a"},
        {"name": "Hoppy street", "lat": 35.71, "lon": 139.79, "place_id": "b"}]})))
    assert [c["providerId"] for c in importer.candidates("Hoppy Street", None, twice)] == ["geoapify:a"]


def test_names_in_any_script_stay_distinct(claude_says):
    assert importer.norm("Sensō-ji") == importer.norm("senso ji")
    assert importer.norm("浅草寺") != importer.norm("東京駅")
    assert importer.norm("!!!") != importer.norm("???")
    # Two different Japanese places on one day are two stops, not one.
    claude_says(outline([day(12, 25, [it("PLACE", "浅草寺"), it("PLACE", "東京駅"), it("PLACE", "浅草寺")])]))
    draft = importer.read(read(), http=geocoder())
    assert [i["title"] for i in draft["days"][0]["items"]] == ["浅草寺", "東京駅"]


def test_next_occurrence_is_on_or_after_the_reference():
    assert importer.next_on_or_after(11, 26, TODAY) == TODAY
    assert importer.next_on_or_after(11, 25, TODAY) == date(2027, 11, 25)
    assert importer.next_on_or_after(2, 29, TODAY) == date(2028, 2, 29)
    assert importer.next_on_or_after(13, 1, TODAY) is None


def test_dates_outside_an_existing_trip_are_flagged(claude_says):
    claude_says(outline([day(12, 24, [it("NOTE", "early")]), day(12, 26, [it("NOTE", "in")])]))
    trip = {"startDate": "2026-12-25", "endDate": "2026-12-28", "cities": ["Tokyo"]}
    fake_req = read(trip=trip)
    draft = importer.read(fake_req, http=geocoder())
    outside = [i for i in draft["issues"] if i["kind"] == "OUTSIDE_TRIP"]
    assert [i["date"] for i in outside] == ["2026-12-24"]
    assert '<trip>{"startDate": "2026-12-25"' in claude._client.calls[0]["messages"][0]["content"]


def test_rows_are_cleaned_and_odd_kinds_become_notes(claude_says):
    claude_says(outline([day(12, 25, [
        it("PLACE", "   "), it("PLACE", "x" * 300, note="n" * 3000), it("PLACE", "Bar", time="8pm"),
        it("MEAL", "Snack", meal=""), it("CHOICE", "Only one", options=["A"]), it("LODGING", "Hotel", lodging=""),
        it("FLIGHT", "Somewhere", flight=None),
        it("FLIGHT", "A → B", flight={"from": "A", "to": "B", "number": "JL1", "departs": "25:00", "depart_tz": "", "arrives_day": 9,
                                      "arrives": "", "arrive_tz": ""})])],
        undated=[it("NOTE", "Someday")], unplaced=["half a line", " "]))
    draft = importer.read(read(), http=geocoder())
    items = draft["days"][0]["items"]
    assert len(items[0]["title"]) == 200 and len(items[0]["note"]) == 2000
    assert items[1]["time"] is None
    assert [i["kind"] for i in items[2:6]] == ["NOTE"] * 4
    assert items[6]["details"]["departs"] is None and items[6]["details"]["arrivesDay"] == 3 and items[6]["details"]["number"] == "JL1"
    bad = [i for i in draft["issues"] if i["kind"] == "UNPLACED_TEXT"]
    assert {(i["item"], i["message"]) for i in bad} >= {(1, "Couldn't read the time “8pm” for Bar, so it has none."),
                                                        (6, "Couldn't read the time “25:00” for A → B, so it has none.")}
    assert any(i["message"] == "Couldn't place this on a day: “half a line”" for i in bad)
    assert draft["undated"][0]["title"] == "Someday"


def test_place_search_outage_keeps_places_unlocated_with_one_issue(claude_says):
    claude_says(TOKYO)
    draft = importer.read(read(), http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503))))
    assert all(not i.get("candidates") for d in draft["days"] for i in d["items"])
    assert draft["cities"][0]["lat"] is None
    outage = [i for i in draft["issues"] if i["kind"] in ("NO_MATCH", "MANY_MATCHES")]
    assert len(outage) == 1 and "unavailable" in outage[0]["message"]


def test_lookups_are_capped(claude_says):
    claude_says(outline([day(12, 25, [it("PLACE", f"Place {n}") for n in range(70)])]))
    seen: list[str] = []
    draft = importer.read(read(), http=geocoder(seen))
    assert len(seen) == importer.MAX_LOOKUPS
    items = draft["days"][0]["items"]
    assert items[58]["candidates"] and not items[59]["candidates"]  # 1 city + 59 places
    assert sum(1 for i in draft["issues"] if "Only the first 60" in i["message"]) == 1
    assert not any(i["kind"] == "NO_MATCH" and i["item"] == 65 for i in draft["issues"])


def test_pdf_goes_to_claude_as_a_document_block(claude_says):
    fake = claude_says(outline([day(12, 25, [it("NOTE", "from the pdf")])]))
    pdf = base64.b64encode(b"%PDF-1.7 fake").decode()
    importer.read(importer.ImportRequest(pdfBase64=pdf, today=TODAY), http=geocoder())
    doc, prompt = fake.calls[0]["messages"][0]["content"]
    assert doc == {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf}}
    assert prompt["type"] == "text" and "attached document" in prompt["text"]


def test_claude_unavailable(claude_says, monkeypatch):
    claude_says(outline([]) | {"x": 1})
    monkeypatch.setattr(claude, "_json_call", lambda *a, **k: None)
    with pytest.raises(importer.Unavailable):
        importer.read(read())
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(importer.Unavailable):
        importer.read(read())


@pytest.mark.parametrize("body", [
    {"text": "x" * 20_001, "today": "2026-11-26"},
    {"text": "plan", "pdfBase64": base64.b64encode(b"%PDF-1").decode(), "today": "2026-11-26"},
    {"text": "  ", "today": "2026-11-26"},
    {"pdfBase64": base64.b64encode(b"<html>").decode(), "today": "2026-11-26"},
    {"pdfBase64": "not base64!", "today": "2026-11-26"},
])
def test_endpoint_rejects_bad_input(signer, body):
    assert api.post("/internal/import", json=body, headers=signer()).status_code == 422


def test_endpoint_rejects_oversized_bodies(signer):
    headers = signer() | {"content-length": str(importer.MAX_PDF_BYTES * 2), "content-type": "application/json"}
    assert api.post("/internal/import", content=b"{}", headers=headers).status_code == 413


def test_endpoint_needs_internal_auth_and_answers_the_draft(signer, claude_says, monkeypatch):
    body = {"text": TOKYO_PLAN, "today": "2026-11-26"}
    assert api.post("/internal/import", json=body).status_code == 401
    claude_says(TOKYO)
    monkeypatch.setattr(places, "CLIENT", geocoder())
    r = api.post("/internal/import", json=body, headers=signer())
    assert r.status_code == 200 and len(r.json()["days"]) == 6
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert api.post("/internal/import", json=body, headers=signer()).status_code == 503
