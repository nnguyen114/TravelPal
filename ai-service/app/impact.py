"""Impact check for a proposal: would these changes fit, do they clash with locked plans, what else would shift?

Answers come from the same optimizer that schedules trips (run on the affected days only), so they agree with
what "Optimize Day" would do. Claude only tags new places with sensible visiting times, as in optimization.
"""

import copy

from app import claude
from app.optimizer import fmt, hhmm, km, optimize, point


def _apply(trip: dict, changes: list[dict]) -> tuple[dict, list[str]]:
    """The trip as it would look after merging; returns it plus the ids of the places being added."""
    job = copy.deepcopy(trip)
    dests = job["destinations"]
    added = []
    for i, c in enumerate(changes):
        if c["kind"] == "ADD":
            nid = f"new-{i}"
            dests.append({"id": nid, "name": c["name"], "address": c.get("address"), "lat": c.get("lat"), "lng": c.get("lng"),
                          "durationMin": c.get("durationMin"), "dayIndex": c.get("dayIndex"), "position": 999,
                          "startTime": c.get("startTime"), "locked": False, "flexibility": "FLEXIBLE"})
            added.append(nid)
        elif c["kind"] == "MOVE":
            for d in dests:
                if d["id"] == c["destinationId"]:
                    d["dayIndex"], d["position"], d["startTime"] = c.get("dayIndex"), 999, c.get("startTime")
        elif c["kind"] == "REMOVE":
            job["destinations"] = dests = [d for d in dests if d["id"] != c["destinationId"]]
    return job, added


def _best_day(job: dict, place: dict) -> int | None:
    """The day whose places are closest to this one; days with nothing planned come last."""
    days = range(job["trip"]["dayCount"])

    def dist(day: int) -> float:
        pts = [d for d in job["destinations"] if d.get("dayIndex") == day and d.get("lat") is not None and d["id"] != place["id"]]
        if not pts or place.get("lat") is None:
            return 10_000.0
        return min(km(point((place.get("lat"), place.get("lng"))), point((p.get("lat"), p.get("lng")))) for p in pts)

    return min(days, key=dist, default=None)


def analyze(trip: dict, changes: list[dict]) -> dict:
    job, added = _apply(trip, changes)
    for nid, hint in claude.place_hints({**job, "destinations": [d for d in job["destinations"] if d["id"] in added]}).items():
        next(d for d in job["destinations"] if d["id"] == nid).update(hint)

    suggested, unknown = None, []
    for nid in added:
        d = next(x for x in job["destinations"] if x["id"] == nid)
        if d.get("dayIndex") is None:
            if d.get("lat") is None:
                unknown.append(f"{d['name']} has no map location yet, so where it fits can't be checked")
                continue
            suggested = _best_day(job, d)
            d["dayIndex"] = suggested

    names = {d["id"]: d["name"] for d in job["destinations"]}
    before = {d["id"]: d.get("startTime") for d in trip["destinations"]}
    touched = set(added) | {c.get("destinationId") for c in changes if c["kind"] != "ADD"}
    days_after = {d.get("dayIndex") for d in job["destinations"] if d["id"] in touched}
    days_before = {d.get("dayIndex") for d in trip["destinations"] if d["id"] in touched}
    days = sorted((days_after | days_before) - {None})

    fits, shifts, conflicts = [], [], []
    for day in days:
        out = optimize({**job, "mode": "BALANCED", "scope": "DAY", "dayIndex": day})
        placed = {i["id"]: i for i in out["items"] if i["dayIndex"] == day}
        for n in out["needsReview"]:
            conflicts.append(f"{names[n['id']]}: {n['reason'].lower()}")
        for nid in added:
            if nid in placed:
                fits.append(f"{names[nid]} on Day {day + 1} at {placed[nid]['startTime']}")
        for sid, item in placed.items():
            if sid not in added and before.get(sid) and item["startTime"] and hhmm(item["startTime"]) != hhmm(before[sid]):
                shifts.append(f"{names[sid]} moves to {item['startTime']}")

    locked_hit = [c for c in changes if c["kind"] != "ADD"
                  and next((d for d in trip["destinations"] if d["id"] == c.get("destinationId") and d.get("locked")), None)]
    if locked_hit:
        conflicts.insert(0, "it changes a locked plan")
    conflicts += unknown
    return {
        "fits": ("Yes: " + "; ".join(fits)) if fits and not conflicts else ("Tight: " + "; ".join(fits)) if fits else
                ("Yes" if not conflicts else "Not cleanly"),
        "conflicts": "None with locks" if not conflicts else "; ".join(conflicts).capitalize(),
        "dayEffect": "; ".join(shifts) if shifts else "Nothing else moves",
        "days": [d + 1 for d in days],
        "suggestedDay": suggested + 1 if suggested is not None else None,
        "basis": f"Estimated with a Balanced day ({fmt(9 * 60)}-{fmt(19 * 60)}) if that day were re-optimized.",
    }
