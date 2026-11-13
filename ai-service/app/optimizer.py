"""Deterministic trip optimizer: groups places by distance, spreads groups over days, orders and times each day.

It only schedules places the user already added. Locked or fixed plans never move. Anything that doesn't fit
goes to a plain "couldn't fit" list; nothing is ranked by taste.
"""

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from itertools import pairwise

# Pace -> (max stops per day, day start, day end). Guidelines, not hard rules.
MODES = {
    "RELAXED": (4, 9 * 60 + 30, 17 * 60 + 30),
    "BALANCED": (6, 9 * 60, 19 * 60),
    "PACKED": (8, 8 * 60 + 30, 21 * 60),
}
DEFAULT_DURATION = 60
# ponytail: flat 12 min/km (min 10) between stops; replace with a real matrix if travel times start to matter.
MIN_PER_KM = 12


@dataclass
class Stop:
    id: str
    name: str
    lat: float | None
    lng: float | None
    duration: int
    day: int | None
    position: int | None
    start: int | None  # minutes after midnight
    pinned: bool  # locked or FIXED: never moves
    movable: bool = False

    @property
    def located(self) -> bool:
        return self.lat is not None and self.lng is not None


@dataclass
class Constraints:
    start_time: int | None = None
    end_time: int | None = None
    slower_days: list[int] = field(default_factory=list)
    extra_minutes: dict[str, int] = field(default_factory=dict)  # name fragment (lowercase) -> extra minutes


def hhmm(t: str | None) -> int | None:
    if not t:
        return None
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


def fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def km(a: Stop, b: Stop) -> float:
    if not (a.located and b.located):
        return 2.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def travel(a: Stop | None, b: Stop) -> int:
    return 0 if a is None else max(10, round(km(a, b) * MIN_PER_KM))


def route_length(stops: list[Stop]) -> float:
    return sum(km(a, b) for a, b in pairwise(stops))


def best_order(stops: list[Stop]) -> list[Stop]:
    """Nearest-neighbour from every start, then 2-opt; days are small so this is cheap and good."""
    if len(stops) < 3:
        return list(stops)
    best = None
    for first in stops:
        route, rest = [first], [s for s in stops if s is not first]
        while rest:
            nxt = min(rest, key=lambda s: km(route[-1], s))
            route.append(nxt)
            rest.remove(nxt)
        improved = True
        while improved:
            improved = False
            for i in range(1, len(route) - 1):
                for j in range(i + 1, len(route)):
                    cand = route[:i] + route[i:j + 1][::-1] + route[j + 1:]
                    if route_length(cand) < route_length(route) - 1e-9:
                        route, improved = cand, True
        if best is None or route_length(route) < route_length(best):
            best = route
    return best


def centroid(stops: list[Stop]) -> tuple[float, float]:
    pts = [s for s in stops if s.located]
    return (sum(s.lat for s in pts) / len(pts), sum(s.lng for s in pts) / len(pts))


def point(lat_lng: tuple[float, float]) -> Stop:
    return Stop("", "", lat_lng[0], lat_lng[1], 0, None, None, None, False)


def kmeans(stops: list[Stop], k: int) -> list[list[Stop]]:
    """Deterministic k-means on lat/lng (farthest-point seeding) for city-scale distances."""
    k = max(1, min(k, len(stops)))
    seeds = [min(stops, key=lambda s: (s.lat, s.lng))]
    while len(seeds) < k:
        seeds.append(max(stops, key=lambda s: min(km(s, c) for c in seeds)))
    centers = [(s.lat, s.lng) for s in seeds]
    groups: list[list[Stop]] = []
    for _ in range(20):
        groups = [[] for _ in centers]
        for s in stops:
            groups[min(range(len(centers)), key=lambda i: km(s, point(centers[i])))].append(s)
        new = [centroid(g) if g else centers[i] for i, g in enumerate(groups)]
        if new == centers:
            break
        centers = new
    return [g for g in groups if g]


def day_cities(job: dict) -> list[dict | None]:
    """The city allocated to each day: fixed dates first, else the first undated city, else the first city."""
    start = date.fromisoformat(job["trip"]["startDate"])
    cities = job["trip"].get("cities", [])
    out = []
    for i in range(job["trip"]["dayCount"]):
        d = (start + timedelta(days=i)).isoformat()
        out.append(next((c for c in cities if c.get("startDate") and c["startDate"] <= d <= c["endDate"]), None)
                   or next((c for c in cities if not c.get("startDate")), None)
                   or (cities[0] if cities else None))
    return out


def optimize(job: dict, constraints: Constraints | None = None) -> dict:
    c = constraints or Constraints()
    cap, day_start, day_end = MODES[job.get("mode", "BALANCED")]
    day_start = c.start_time or day_start
    day_end = c.end_time or day_end
    n_days = job["trip"]["dayCount"]
    scope = job.get("scope", "TRIP")
    selected = set(job.get("destinationIds") or [])

    stops = []
    for d in job["destinations"]:
        dur = d.get("durationMin") or DEFAULT_DURATION
        for frag, extra in c.extra_minutes.items():
            if frag and frag in d["name"].lower():
                dur += extra
        stops.append(Stop(d["id"], d["name"], d.get("lat"), d.get("lng"), dur, d.get("dayIndex"), d.get("position"),
                          hhmm(d.get("startTime")), d.get("locked") or d.get("flexibility") == "FIXED"))
    before = {s.id: (s.day, s.position, s.start) for s in stops}

    for s in stops:
        in_scope = (scope == "TRIP" or (scope == "DAY" and s.day == job.get("dayIndex"))
                    or (scope == "SELECTION" and s.id in selected))
        s.movable = in_scope and not s.pinned

    needs_review = []
    for s in stops:
        if s.movable and not s.located and scope != "DAY":
            s.movable = False
            needs_review.append({"id": s.id, "reason": "No map location yet, so it can't be placed by distance"})

    # 1. Which days each movable stop may go on (respecting city/day allocation).
    cities = day_cities(job)
    located_cities = {c["name"]: c for c in cities if c and c.get("lat") is not None}

    def eligible_days(s: Stop) -> list[int]:
        if scope == "DAY":
            return [s.day]
        if len(located_cities) < 2 or not s.located:
            return list(range(n_days))
        home = min(located_cities.values(), key=lambda city: km(s, point((city["lat"], city["lng"]))))
        return [i for i, city in enumerate(cities) if city and city["name"] == home["name"]] or list(range(n_days))

    plan: dict[int, list[Stop]] = {i: [s for s in stops if s.day == i and not s.movable] for i in range(n_days)}
    movable = [s for s in stops if s.movable]

    def dist_to_day(s: Stop, day: int) -> float:
        """Distance to the day's existing stops; days with no located stops count as far but usable."""
        pts = [x for x in plan[day] if x.located]
        return km(s, point(centroid(pts))) if pts and s.located else 50.0

    def capacity(day: int) -> int:
        return max(1, cap - (1 if day in c.slower_days else 0))

    if scope == "DAY":
        plan[job["dayIndex"]] += movable
    else:
        by_days: dict[tuple[int, ...], list[Stop]] = {}
        for s in movable:
            by_days.setdefault(tuple(eligible_days(s)), []).append(s)
        for days, group in by_days.items():
            if scope == "SELECTION":
                for s in group:
                    open_days = [d for d in days if len(plan[d]) < capacity(d)] or list(days)
                    plan[min(open_days, key=lambda d: dist_to_day(s, d))].append(s)
                continue
            clusters = kmeans(group, len(days))
            free = list(days)
            # Days that already hold fixed plans claim the cluster closest to them first.
            for d in sorted(days, key=lambda d: -len(plan[d])):
                if not clusters or not any(x.located for x in plan[d]):
                    continue
                cl = min(clusters, key=lambda g: km(point(centroid(g)), point(centroid(plan[d]))))
                plan[d] += cl
                clusters.remove(cl)
                free.remove(d)
            clusters.sort(key=lambda g: (-len(g), centroid(g)))
            for d, cl in zip(sorted(free, key=lambda d: len(plan[d])), clusters):
                plan[d] += cl
            for cl in clusters[len(free):]:  # more clusters than free days: fold into nearest day
                for s in cl:
                    plan[min(days, key=lambda d: dist_to_day(s, d))].append(s)

        # 2. Over-full days spill their farthest movable stops to a nearby day with room, else to "couldn't fit".
        for d in range(n_days):
            while len(plan[d]) > capacity(d) and any(s.movable for s in plan[d]):
                s = max((s for s in plan[d] if s.movable), key=lambda s: dist_to_day(s, d))
                plan[d].remove(s)
                room = [o for o in eligible_days(s) if o != d and len(plan[o]) < capacity(o)]
                if room and scope == "TRIP":
                    plan[min(room, key=lambda o: dist_to_day(s, o))].append(s)
                else:
                    s.day = None

    # 3. Order and time each day around fixed-time plans.
    result: dict[str, tuple[int | None, int | None, int | None]] = {}
    planned = {s.id for day in plan.values() for s in day}
    overflow: set[str] = {s.id for s in movable if s.id not in planned}
    for d in range(n_days):
        day_stops = plan[d]
        touched = scope != "DAY" or d == job.get("dayIndex")
        if not touched and not any(s.movable for s in day_stops):
            for s in day_stops:
                result[s.id] = before[s.id]
            continue
        anchors = sorted([s for s in day_stops if s.pinned and s.start is not None], key=lambda s: s.start)
        loose = best_order([s for s in day_stops if not (s.pinned and s.start is not None)])
        start = day_start + (60 if d in c.slower_days else 0)
        t, prev, seq = start, None, []
        queue = list(loose)
        while queue or anchors:
            if anchors and (not queue or t + travel(prev, queue[0]) + queue[0].duration + travel(queue[0], anchors[0]) > anchors[0].start):
                a = anchors.pop(0)
                seq.append((a, a.start))
                t, prev = max(t, a.start + a.duration), a
                continue
            s = queue.pop(0)
            st = t + travel(prev, s)
            if st + s.duration > day_end and s.movable and scope != "DAY":
                overflow.add(s.id)
                continue
            if st + s.duration > day_end:
                needs_review.append({"id": s.id, "reason": f"Runs past {fmt(day_end)} at this pace"})
            seq.append((s, st))
            t, prev = st + s.duration, s
        for pos, (s, st) in enumerate(seq):
            result[s.id] = (d, pos, st)
    for sid in overflow:
        result[sid] = (None, None, None)
    for s in stops:  # untouched unscheduled ideas stay where they are
        result.setdefault(s.id, before[s.id])

    items, moved, added, unscheduled, kept = [], [], [], [], []
    for s in stops:
        day, pos, st = result[s.id]
        items.append({"id": s.id, "dayIndex": day, "position": pos, "startTime": fmt(st) if st is not None else None})
        b_day = before[s.id][0]
        if s.pinned:
            kept.append(s.id)
        elif day is None and s.id in overflow:
            unscheduled.append(s.id)
        elif day is not None and b_day is None:
            added.append(s.id)
        elif day is not None and (day, pos) != before[s.id][:2]:
            moved.append(s.id)
    scheduled = sum(1 for i in items if i["dayIndex"] is not None)
    return {
        "items": items,
        "moved": moved,
        "added": added,
        "unscheduled": unscheduled,
        "keptLocked": kept,
        "needsReview": needs_review,
        "scheduled": scheduled,
        "total": len(items),
    }
