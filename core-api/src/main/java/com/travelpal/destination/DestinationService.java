package com.travelpal.destination;

import com.travelpal.history.History;
import com.travelpal.history.TripEvent;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class DestinationService {
    public record Input(String name, String address, Double lat, Double lng, String providerId, String notes,
                        Integer durationMin, Integer dayIndex, LocalTime startTime, boolean locked, Flexibility flexibility,
                        LocalTime visitAfter, LocalTime visitBefore, boolean dayTrip) {}

    public record Hint(UUID id, LocalTime visitAfter, LocalTime visitBefore, boolean dayTrip) {}

    /** Full state of a destination at one moment; stored in the activity log for undo. */
    public record Snapshot(UUID id, String name, String address, Double lat, Double lng, String providerId, String notes,
                           Integer durationMin, Integer dayIndex, LocalTime startTime, boolean locked, Flexibility flexibility,
                           long version, LocalTime visitAfter, LocalTime visitBefore, boolean dayTrip) {
        static Snapshot of(Destination d) {
            return new Snapshot(d.getId(), d.getName(), d.getAddress(), d.getLat(), d.getLng(), d.getProviderId(), d.getNotes(),
                d.getDurationMin(), d.getDayIndex(), d.getStartTime(), d.isLocked(), d.getFlexibility(), d.getVersion(),
                d.getVisitAfter(), d.getVisitBefore(), d.isDayTrip());
        }

        Input input() {
            return new Input(name, address, lat, lng, providerId, notes, durationMin, dayIndex, startTime, locked, flexibility,
                visitAfter, visitBefore, dayTrip);
        }
    }

    private static final String STALE = "Someone else changed this since you loaded it. Refresh and try again.";

    private final DestinationRepository repo;
    private final TripAccess access;
    private final TripService trips;
    private final History history;

    DestinationService(DestinationRepository repo, TripAccess access, TripService trips, History history) {
        this.repo = repo;
        this.access = access;
        this.trips = trips;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public List<Destination> list(UUID userId, UUID tripId) {
        access.require(tripId, userId, TripRole.VIEWER);
        return repo.findByTrip(tripId);
    }

    /** Adding to a day appends it; nothing else in the trip moves (optimization only runs on request). */
    @Transactional
    public Destination add(UUID userId, UUID tripId, Input in) {
        access.require(tripId, userId, TripRole.EDITOR);
        Destination d = new Destination(tripId, userId, in.providerId());
        apply(d, in);
        repo.saveAndFlush(d);
        history.record(tripId, userId, "DESTINATION_ADDED",
            d.getDayIndex() == null ? "saved " + d.getName() + " as an idea" : "added " + d.getName() + " to Day " + (d.getDayIndex() + 1),
            null, Snapshot.of(d));
        return d;
    }

    /** {@code version} must match what the editor saw, so a concurrent edit is never silently overwritten. */
    @Transactional
    public Destination update(UUID userId, UUID tripId, UUID id, Long version, Input in) {
        access.require(tripId, userId, TripRole.EDITOR);
        Destination d = find(tripId, id);
        if (version == null || version != d.getVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, STALE);
        }
        Snapshot before = Snapshot.of(d);
        apply(d, in);
        repo.flush();
        history.record(tripId, userId, "DESTINATION_UPDATED", describeUpdate(before, d), before, Snapshot.of(d));
        return d;
    }

    @Transactional
    public void delete(UUID userId, UUID tripId, UUID id) {
        access.require(tripId, userId, TripRole.EDITOR);
        Destination d = find(tripId, id);
        repo.delete(d);
        history.record(tripId, userId, "DESTINATION_REMOVED", "removed " + d.getName(), Snapshot.of(d), null);
    }

    /** Sets the visit order of one day; ids must be exactly the stops currently on that day. */
    @Transactional
    public List<Destination> reorder(UUID userId, UUID tripId, int dayIndex, List<UUID> ids) {
        access.require(tripId, userId, TripRole.EDITOR);
        List<UUID> before = order(tripId, dayIndex);
        List<Destination> result = setOrder(tripId, dayIndex, ids);
        history.record(tripId, userId, "DAY_REORDERED", "reordered Day " + (dayIndex + 1), new DayOrder(dayIndex, before), new DayOrder(dayIndex, ids));
        return result;
    }

    record DayOrder(int dayIndex, List<UUID> ids) {}

    public record PlanItem(UUID id, Integer dayIndex, Integer position, LocalTime startTime) {}

    record Placement(UUID id, Integer dayIndex, Integer position, LocalTime startTime, long version) {
        static Placement of(Destination d) {
            return new Placement(d.getId(), d.getDayIndex(), d.getPosition(), d.getStartTime(), d.getVersion());
        }
    }

    record PlanState(List<Placement> placements) {}

    /** Applies a reviewed optimizer plan. Locked and fixed plans are never touched, whatever the plan says. */
    @Transactional
    public void applyPlan(UUID userId, UUID tripId, List<PlanItem> items, String summary) {
        access.require(tripId, userId, TripRole.EDITOR);
        Map<UUID, Destination> all = repo.findByTrip(tripId).stream().collect(Collectors.toMap(Destination::getId, Function.identity()));
        int days = trips.dayCount(tripId);
        List<Placement> before = new java.util.ArrayList<>();
        List<Destination> changed = new java.util.ArrayList<>();
        for (PlanItem i : items) {
            Destination d = all.get(i.id());
            if (d == null || (i.dayIndex() != null && (i.dayIndex() < 0 || i.dayIndex() >= days))) {
                continue;
            }
            boolean pinned = d.isLocked() || d.getFlexibility() == Flexibility.FIXED;
            // A pinned plan keeps its day and time; it may only shift position as stops are ordered around it.
            if (pinned && (i.dayIndex() == null || !i.dayIndex().equals(d.getDayIndex()) || !Objects.equals(i.startTime(), d.getStartTime()))) {
                continue;
            }
            if (Objects.equals(d.getDayIndex(), i.dayIndex()) && Objects.equals(d.getPosition(), i.position())
                && Objects.equals(d.getStartTime(), i.startTime())) {
                continue;
            }
            before.add(Placement.of(d));
            d.scheduleAt(i.dayIndex(), i.dayIndex() == null ? null : i.position(), i.startTime());
            changed.add(d);
        }
        repo.flush();
        history.record(tripId, userId, "PLAN_APPLIED", summary, new PlanState(before),
            new PlanState(changed.stream().map(Placement::of).toList()));
    }

    /** Reverses one logged change, refusing if the item changed again since (so nobody's later edit is lost). */
    @Transactional
    public void undo(UUID userId, UUID tripId, long eventId) {
        access.require(tripId, userId, TripRole.EDITOR);
        TripEvent e = history.claimUndo(tripId, eventId);
        switch (e.getType()) {
            case "DESTINATION_ADDED" -> {
                Snapshot after = history.read(e.getAfter(), Snapshot.class);
                repo.delete(current(tripId, after));
            }
            case "DESTINATION_UPDATED" -> {
                Snapshot after = history.read(e.getAfter(), Snapshot.class);
                apply(current(tripId, after), history.read(e.getBefore(), Snapshot.class).input());
            }
            case "DESTINATION_REMOVED" -> {
                Snapshot before = history.read(e.getBefore(), Snapshot.class);
                if (repo.existsById(before.id())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "It has already been restored");
                }
                Destination d = new Destination(before.id(), tripId, userId, before.providerId());
                apply(d, before.input());
                repo.save(d);
            }
            case "PLAN_APPLIED" -> {
                List<Placement> after = history.read(e.getAfter(), PlanState.class).placements();
                Map<UUID, Destination> now = repo.findByTrip(tripId).stream().collect(Collectors.toMap(Destination::getId, Function.identity()));
                for (Placement p : after) {
                    Destination d = now.get(p.id());
                    if (d == null || d.getVersion() != p.version()) {
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "Places changed since; undo would overwrite newer edits");
                    }
                }
                for (Placement p : history.read(e.getBefore(), PlanState.class).placements()) {
                    now.get(p.id()).scheduleAt(p.dayIndex(), p.position(), p.startTime());
                }
            }
            default -> { // DAY_REORDERED
                DayOrder before = history.read(e.getBefore(), DayOrder.class);
                DayOrder after = history.read(e.getAfter(), DayOrder.class);
                if (!order(tripId, after.dayIndex()).equals(after.ids())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "That day changed since; undo would overwrite newer edits");
                }
                setOrder(tripId, before.dayIndex(), before.ids());
            }
        }
        repo.flush();
        history.record(tripId, userId, "UNDO", "undid: " + e.getSummary(), null, Map.of("eventId", eventId));
    }

    private Destination current(UUID tripId, Snapshot expected) {
        Destination d = repo.findByIdAndTripId(expected.id(), tripId).orElseThrow(
            () -> new ResponseStatusException(HttpStatus.CONFLICT, "It was removed since; nothing to undo"));
        if (d.getVersion() != expected.version()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "It changed since; undo would overwrite newer edits");
        }
        return d;
    }

    private List<UUID> order(UUID tripId, int dayIndex) {
        return repo.findByTripIdAndDayIndex(tripId, dayIndex).stream()
            .sorted((a, b) -> Integer.compare(a.getPosition(), b.getPosition())).map(Destination::getId).toList();
    }

    private List<Destination> setOrder(UUID tripId, int dayIndex, List<UUID> ids) {
        Map<UUID, Destination> onDay = repo.findByTripIdAndDayIndex(tripId, dayIndex).stream()
            .collect(Collectors.toMap(Destination::getId, Function.identity()));
        if (ids.size() != onDay.size() || !onDay.keySet().equals(new HashSet<>(ids))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Day changed since you loaded it; refresh and retry");
        }
        for (int i = 0; i < ids.size(); i++) {
            onDay.get(ids.get(i)).schedule(dayIndex, i);
        }
        return ids.stream().map(onDay::get).toList();
    }

    private void apply(Destination d, Input in) {
        Integer day = in.dayIndex();
        if (day != null && (day < 0 || day >= trips.dayCount(d.getTripId()))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Day is outside the trip");
        }
        if (day == null) {
            d.schedule(null, null);
        } else if (!day.equals(d.getDayIndex())) {
            d.schedule(day, repo.maxPosition(d.getTripId(), day) + 1);
        }
        d.details(in.name(), in.address(), in.lat(), in.lng(), in.notes(), in.durationMin(), in.startTime(), in.locked(), in.flexibility());
        if (in.visitAfter() != null && in.visitBefore() != null && !in.visitAfter().isBefore(in.visitBefore())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Best-time window must start before it ends");
        }
        d.hints(in.visitAfter(), in.visitBefore(), in.dayTrip());
    }

    /** Stores the optimizer's suggestions; never overwrites what a traveler set. */
    @Transactional
    public void suggestHints(UUID tripId, List<Hint> hints) {
        hints.forEach(h -> repo.suggestHints(tripId, h.id(), h.visitAfter(), h.visitBefore(), h.dayTrip()));
    }

    private static String describeUpdate(Snapshot before, Destination d) {
        if (!Objects.equals(before.dayIndex(), d.getDayIndex())) {
            return d.getDayIndex() == null ? "moved " + d.getName() + " to Unscheduled" : "moved " + d.getName() + " to Day " + (d.getDayIndex() + 1);
        }
        if (before.locked() != d.isLocked()) {
            return (d.isLocked() ? "locked " : "unlocked ") + d.getName();
        }
        return "updated " + d.getName();
    }

    private Destination find(UUID tripId, UUID id) {
        return repo.findByIdAndTripId(id, tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Destination not found"));
    }
}
