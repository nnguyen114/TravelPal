package com.travelpal.entry;

import com.travelpal.entry.ItineraryEntry.Kind;
import com.travelpal.history.History;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

interface EntryRepository extends JpaRepository<ItineraryEntry, UUID> {
    @Query("select e from ItineraryEntry e where e.tripId = ?1 order by e.dayIndex nulls last, e.position")
    List<ItineraryEntry> findByTrip(UUID tripId);

    Optional<ItineraryEntry> findByIdAndTripId(UUID id, UUID tripId);

    @Query("select coalesce(max(e.position), -1) from ItineraryEntry e where e.tripId = ?1 and (e.dayIndex = ?2 or (?2 is null and e.dayIndex is null))")
    int maxPosition(UUID tripId, Integer dayIndex);
}

/** Flights, lodging, meal slots, open choices and notes on a trip's days. Editors write, viewers read. */
@Service
public class EntryService {
    /** Full state of an entry; stored in the activity log. */
    public record Snapshot(UUID id, Integer dayIndex, int position, Kind kind, String title, LocalTime startTime, String details, long version) {
        public static Snapshot of(ItineraryEntry e) {
            return new Snapshot(e.getId(), e.getDayIndex(), e.getPosition(), e.getKind(), e.getTitle(), e.getStartTime(), e.getDetails(), e.getVersion());
        }
    }

    private static final Map<Kind, Set<String>> KEYS = Map.of(
        Kind.FLIGHT, Set.of("from", "to", "number", "departs", "departTz", "arrivesDay", "arrives", "arriveTz"),
        Kind.LODGING, Set.of("action", "hotel"),
        Kind.MEAL, Set.of("slot", "areas"),
        Kind.CHOICE, Set.of("options", "resolved"),
        Kind.NOTE, Set.of());
    private static final Set<String> PLACE_KEYS = Set.of("name", "address", "lat", "lng", "providerId");
    private static final String STALE = "Someone else changed this since you loaded it. Refresh and try again.";

    private final EntryRepository repo;
    private final TripAccess access;
    private final TripService trips;
    private final History history;
    private final JsonMapper json;

    EntryService(EntryRepository repo, TripAccess access, TripService trips, History history, JsonMapper json) {
        this.repo = repo;
        this.access = access;
        this.trips = trips;
        this.history = history;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public List<ItineraryEntry> list(UUID userId, UUID tripId) {
        access.require(tripId, userId, TripRole.VIEWER);
        return repo.findByTrip(tripId);
    }

    /** {@code version} must match what the editor saw. Moving to another day puts the entry last on that day. */
    @Transactional
    public ItineraryEntry update(UUID userId, UUID tripId, UUID id, long version, String title, Integer dayIndex, LocalTime startTime) {
        access.require(tripId, userId, TripRole.EDITOR);
        ItineraryEntry e = find(tripId, id);
        if (version != e.getVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, STALE);
        }
        checkDay(tripId, dayIndex);
        Snapshot before = Snapshot.of(e);
        boolean moved = !java.util.Objects.equals(dayIndex, e.getDayIndex());
        e.edit(title, dayIndex, moved ? repo.maxPosition(tripId, dayIndex) + 1 : e.getPosition(), startTime);
        repo.flush();
        history.record(tripId, userId, "ENTRY_UPDATED", "updated " + e.getTitle(), before, Snapshot.of(e));
        return e;
    }

    /** With a {@code version}, deletes only if nobody changed the entry since. */
    @Transactional
    public void delete(UUID userId, UUID tripId, UUID id, Long version) {
        access.require(tripId, userId, TripRole.EDITOR);
        ItineraryEntry e = find(tripId, id);
        if (version != null && version != e.getVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, STALE);
        }
        repo.delete(e);
        history.record(tripId, userId, "ENTRY_REMOVED", "removed " + e.getTitle(), Snapshot.of(e), null);
    }

    /**
     * Adds an entry last on its day (null = undated), without its own history event: the caller holds the trip lock,
     * has checked the caller is an editor, and records one event for the whole change.
     */
    public ItineraryEntry insert(UUID userId, UUID tripId, Integer dayIndex, Kind kind, String title, LocalTime startTime,
                                 JsonNode details, String source, UUID importId) {
        checkDay(tripId, dayIndex);
        ItineraryEntry e = new ItineraryEntry(tripId, userId, kind, details(kind, details), source, importId);
        e.edit(title, dayIndex, repo.maxPosition(tripId, dayIndex) + 1, startTime);
        return repo.saveAndFlush(e);
    }

    /** Undo of an import: removes each entry still exactly as created; returns the titles of those kept. */
    public List<String> removeUnchanged(UUID tripId, List<History.Ref> refs) {
        List<String> kept = new ArrayList<>();
        for (History.Ref r : refs) {
            repo.findByIdAndTripId(r.id(), tripId).ifPresent(e -> {
                if (e.getVersion() == r.version()) {
                    repo.delete(e);
                } else {
                    kept.add(e.getTitle());
                }
            });
        }
        repo.flush();
        return kept;
    }

    /** A CHOICE entry and its details, for resolving it (the caller holds the trip lock). */
    public ItineraryEntry choice(UUID tripId, UUID id) {
        ItineraryEntry e = find(tripId, id);
        if (e.getKind() != Kind.CHOICE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That isn't a choice");
        }
        return e;
    }

    public JsonNode detailsOf(ItineraryEntry e) {
        return json.readTree(e.getDetails());
    }

    /** Removes a resolved choice; the caller records the event. */
    public void resolved(ItineraryEntry e) {
        repo.delete(e);
        repo.flush();
    }

    /** Checks details against the kind's shape (unknown keys rejected) and returns them as stored JSON. */
    String details(Kind kind, JsonNode d) {
        if (d == null || d.isNull()) {
            d = json.createObjectNode();
        }
        if (!d.isObject() || !KEYS.get(kind).containsAll(d.propertyNames())) {
            throw bad("Unknown details for a " + kind.name().toLowerCase() + " entry");
        }
        for (var p : d.properties()) {
            JsonNode v = p.getValue();
            boolean ok = switch (p.getKey()) {
                case "areas" -> v.isArray() && v.size() <= 10 && v.valueStream().allMatch(JsonNode::isString);
                case "options" -> v.isArray() && v.size() >= 1 && v.size() <= 10 && v.valueStream().allMatch(EntryService::option);
                case "action" -> v.isString() && Set.of("CHECK_IN", "CHECK_OUT", "DROP_OFF").contains(v.stringValue());
                case "slot" -> v.isString() && Set.of("BREAKFAST", "LUNCH", "DINNER").contains(v.stringValue());
                default -> scalar(v);
            };
            if (!ok) {
                throw bad("Invalid " + p.getKey() + " for a " + kind.name().toLowerCase() + " entry");
            }
        }
        String out = json.writeValueAsString(d);
        if (out.length() > 10_000) {
            throw bad("Entry details are too long");
        }
        return out;
    }

    private static boolean option(JsonNode o) {
        JsonNode place = o.path("place");
        return o.isObject() && Set.of("label", "place").containsAll(o.propertyNames()) && o.path("label").isString()
            && (place.isMissingNode() || place.isNull() || (place.isObject() && PLACE_KEYS.containsAll(place.propertyNames())
                && place.valueStream().allMatch(EntryService::scalar)));
    }

    private static boolean scalar(JsonNode v) {
        return v.isNull() || v.isBoolean() || v.isNumber() || (v.isString() && v.stringValue().length() <= 300);
    }

    private void checkDay(UUID tripId, Integer dayIndex) {
        if (dayIndex != null && (dayIndex < 0 || dayIndex >= trips.dayCount(tripId))) {
            throw bad("Day is outside the trip");
        }
    }

    private ItineraryEntry find(UUID tripId, UUID id) {
        return repo.findByIdAndTripId(id, tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Entry not found"));
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
