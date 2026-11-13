from itertools import pairwise

from app.optimizer import Constraints, Stop, best_order, fmt, hhmm, km, optimize

HARAJUKU = [("Meiji Jingu", 35.6764, 139.6993), ("Cat Street", 35.6668, 139.7053), ("Takeshita St", 35.6717, 139.7031),
            ("Omotesando Hills", 35.6673, 139.7090)]
ASAKUSA = [("Senso-ji", 35.7148, 139.7967), ("Kappabashi", 35.7134, 139.7883), ("Sumida Park", 35.7118, 139.8012),
           ("Ueno Park", 35.7156, 139.7745)]
SHINJUKU = [("Shinjuku Gyoen", 35.6852, 139.7101), ("Omoide Yokocho", 35.6931, 139.6995), ("Golden Gai", 35.6938, 139.7046),
            ("Metropolitan Bldg", 35.6896, 139.6917)]


def dest(name, lat, lng, **kw):
    return {"id": name, "name": name, "lat": lat, "lng": lng, "durationMin": 60, "dayIndex": None, "position": None,
            "startTime": None, "locked": False, "flexibility": "FLEXIBLE", **kw}


def job(dests, days=3, mode="BALANCED", cities=None, **kw):
    return {"trip": {"startDate": "2027-06-10", "dayCount": days,
                     "cities": cities or [{"name": "Tokyo", "lat": 35.68, "lng": 139.76, "startDate": None, "endDate": None}]},
            "destinations": dests, "mode": mode, "scope": "TRIP", **kw}


def by_id(result):
    return {i["id"]: i for i in result["items"]}


def test_groups_neighborhoods_onto_the_same_day():
    dests = [dest(*p) for p in HARAJUKU + ASAKUSA + SHINJUKU]
    r = by_id(optimize(job(dests)))
    for area in (HARAJUKU, ASAKUSA, SHINJUKU):
        assert len({r[p[0]]["dayIndex"] for p in area}) == 1, area
    assert len({r[a[0][0]]["dayIndex"] for a in (HARAJUKU, ASAKUSA, SHINJUKU)}) == 3
    day = sorted((i for i in r.values() if i["dayIndex"] == r["Senso-ji"]["dayIndex"]), key=lambda i: i["position"])
    assert [i["position"] for i in day] == [0, 1, 2, 3]
    assert day[0]["startTime"] == "09:00"
    assert all(a["startTime"] < b["startTime"] for a, b in pairwise(day))


def test_locked_plans_never_move_and_anchor_their_neighborhood():
    dinner = dest("Dinner", 35.6595, 139.7005, dayIndex=2, position=0, startTime="19:00", locked=True, durationMin=90)
    dests = [dinner] + [dest(*p) for p in HARAJUKU + ASAKUSA]
    out = optimize(job(dests))
    r = by_id(out)
    assert (r["Dinner"]["dayIndex"], r["Dinner"]["startTime"]) == (2, "19:00")
    assert r["Meiji Jingu"]["dayIndex"] == 2  # Harajuku is next to the Shibuya dinner
    assert out["keptLocked"] == ["Dinner"]
    day2 = sorted((i for i in r.values() if i["dayIndex"] == 2), key=lambda i: i["position"])
    assert day2[-1]["id"] == "Dinner"


def test_fixed_flexibility_counts_as_locked():
    museum = dest("Museum", 35.7156, 139.7745, dayIndex=0, position=0, startTime="10:00", flexibility="FIXED")
    r = by_id(optimize(job([museum] + [dest(*p) for p in SHINJUKU], days=2)))
    assert (r["Museum"]["dayIndex"], r["Museum"]["startTime"]) == (0, "10:00")


def test_pace_changes_how_much_fits_and_lists_the_rest():
    dests = [dest(*p) for p in HARAJUKU + ASAKUSA + SHINJUKU]
    relaxed = optimize(job(dests, days=2, mode="RELAXED"))
    packed = optimize(job(dests, days=2, mode="PACKED"))
    assert relaxed["scheduled"] < packed["scheduled"] <= 12
    assert relaxed["total"] == 12
    assert len(relaxed["unscheduled"]) == 12 - relaxed["scheduled"]
    assert all(by_id(relaxed)[u]["dayIndex"] is None for u in relaxed["unscheduled"])


def test_long_visits_overflow_the_day_window():
    dests = [dest(*p, durationMin=240) for p in HARAJUKU]
    out = optimize(job(dests, days=1))
    assert out["scheduled"] == 2 and len(out["unscheduled"]) == 2


def test_reports_moved_and_added():
    a = dest(*HARAJUKU[0], dayIndex=1, position=0)
    b = dest(*ASAKUSA[0])
    out = optimize(job([a, b] + [dest(*p) for p in HARAJUKU[1:]], days=2))
    assert "Senso-ji" in out["added"]
    assert set(out["moved"]) | set(out["added"]) | {i["id"] for i in out["items"] if i["dayIndex"] == 1} >= {"Meiji Jingu"}


def test_day_scope_only_reorders_that_day():
    far_order = [dest(*SHINJUKU[0], dayIndex=0, position=0), dest(*ASAKUSA[0], dayIndex=0, position=1),
                 dest(*SHINJUKU[1], dayIndex=0, position=2)]
    other = dest(*HARAJUKU[0], dayIndex=1, position=0, startTime="11:00")
    idea = dest(*HARAJUKU[1])
    r = by_id(optimize(job(far_order + [other, idea], days=2, scope="DAY", dayIndex=0)))
    assert r["Meiji Jingu"] == {"id": "Meiji Jingu", "dayIndex": 1, "position": 0, "startTime": "11:00"}
    assert r["Cat Street"]["dayIndex"] is None
    assert abs(r["Shinjuku Gyoen"]["position"] - r["Omoide Yokocho"]["position"]) == 1  # Shinjuku stops end up adjacent


def test_day_scope_flags_overrun_instead_of_dropping():
    stops = [dest(n, la, lo, dayIndex=0, position=i, durationMin=200) for i, (n, la, lo) in enumerate(HARAJUKU)]
    out = optimize(job(stops, days=1, scope="DAY", dayIndex=0))
    assert out["scheduled"] == 4
    assert any("Runs past 19:00" in n["reason"] for n in out["needsReview"])


def test_selection_scope_moves_only_selected():
    seated = [dest(n, la, lo, dayIndex=0, position=i) for i, (n, la, lo) in enumerate(ASAKUSA)]
    picked = dest("Asakusa cafe", 35.7120, 139.7950)
    untouched = dest(*SHINJUKU[0])
    r = by_id(optimize(job(seated + [picked, untouched], days=2, scope="SELECTION", destinationIds=["Asakusa cafe"])))
    assert r["Asakusa cafe"]["dayIndex"] == 0
    assert r["Shinjuku Gyoen"]["dayIndex"] is None


def test_multi_city_respects_city_dates():
    cities = [{"name": "Tokyo", "lat": 35.68, "lng": 139.76, "startDate": "2027-06-10", "endDate": "2027-06-11"},
              {"name": "Kyoto", "lat": 35.01, "lng": 135.77, "startDate": "2027-06-12", "endDate": "2027-06-12"}]
    kyoto = [dest("Fushimi Inari", 34.9671, 135.7727), dest("Kiyomizu", 34.9949, 135.7850)]
    r = by_id(optimize(job(kyoto + [dest(*p) for p in HARAJUKU], days=3, cities=cities)))
    assert r["Fushimi Inari"]["dayIndex"] == r["Kiyomizu"]["dayIndex"] == 2
    assert all(r[p[0]]["dayIndex"] in (0, 1) for p in HARAJUKU)


def test_places_without_location_need_review_and_stay_put():
    out = optimize(job([dest("Mystery bar", None, None, dayIndex=1, position=0), dest(*HARAJUKU[0])], days=2))
    assert by_id(out)["Mystery bar"]["dayIndex"] == 1
    assert out["needsReview"][0]["id"] == "Mystery bar"


def test_constraints_shift_the_day_and_lengthen_visits():
    dests = [dest(*p) for p in HARAJUKU]
    c = Constraints(start_time=hhmm("10:30"), slower_days=[0], extra_minutes={"meiji": 60})
    r = by_id(optimize(job(dests, days=1), c))
    first = min((i for i in r.values() if i["dayIndex"] == 0), key=lambda i: i["position"])
    assert first["startTime"] == "11:30"  # 10:30 start + slower-day hour
    assert sum(1 for i in r.values() if i["dayIndex"] == 0) == 4  # slower day: Balanced 6 -> 5, still fits 4


def test_more_clusters_than_days_and_empty_trips():
    spread = [dest(*p) for p in HARAJUKU[:1] + ASAKUSA[:1] + SHINJUKU[:1]]
    assert optimize(job(spread, days=1))["scheduled"] >= 1
    assert optimize(job([], days=2))["total"] == 0


def test_helpers():
    assert fmt(hhmm("08:05")) == "08:05" and hhmm(None) is None
    a = Stop("a", "a", None, None, 60, None, None, None, False)
    assert km(a, a) == 2.0
    pts = [Stop(str(i), str(i), 35.0, 139.0 + x, 60, None, None, None, False) for i, x in enumerate([0, 0.3, 0.1, 0.2])]
    assert [s.id for s in best_order(pts)] in (["0", "2", "3", "1"], ["1", "3", "2", "0"])
