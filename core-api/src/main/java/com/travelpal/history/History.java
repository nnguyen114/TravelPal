package com.travelpal.history;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Records every shared change. Recording bumps the trip version (stale previews/edits can detect it)
 * and, after commit, notifies live viewers of the trip.
 */
@Service
public class History {
    public static final Set<String> UNDOABLE = Set.of("DESTINATION_ADDED", "DESTINATION_UPDATED", "DESTINATION_REMOVED", "DAY_REORDERED", "PLAN_APPLIED");

    public record Changed(UUID tripId, UUID actorId) {}
    public record Entry(long id, UUID actorId, String actorName, String type, String summary, Instant createdAt,
                        boolean undoable, boolean undone) {}

    private final TripEventRepository events;
    private final EntityManager em;
    private final ApplicationEventPublisher publisher;
    private final JsonMapper json;

    History(TripEventRepository events, EntityManager em, ApplicationEventPublisher publisher, JsonMapper json) {
        this.events = events;
        this.em = em;
        this.publisher = publisher;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(UUID tripId, UUID actorId, String type, String summary, Object before, Object after) {
        events.save(new TripEvent(tripId, actorId, type, summary, write(before), write(after)));
        em.createQuery("update Trip t set t.version = t.version + 1 where t.id = ?1").setParameter(1, tripId).executeUpdate();
        publisher.publishEvent(new Changed(tripId, actorId));
    }

    @Transactional(readOnly = true)
    public List<Entry> page(UUID tripId, Long beforeId, int limit) {
        return events.page(tripId, beforeId == null ? Long.MAX_VALUE : beforeId, Limit.of(limit)).stream().map(r -> {
            TripEvent e = (TripEvent) r[0];
            return new Entry(e.getId(), e.getActorId(), (String) r[1], e.getType(), e.getSummary(), e.getCreatedAt(),
                UNDOABLE.contains(e.getType()) && !e.isUndone(), e.isUndone());
        }).toList();
    }

    /** Loads an undoable event and marks it undone; the caller applies the reversal in the same transaction. */
    @Transactional(propagation = Propagation.MANDATORY)
    public TripEvent claimUndo(UUID tripId, long eventId) {
        TripEvent e = events.findByIdAndTripId(eventId, tripId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Change not found"));
        if (!UNDOABLE.contains(e.getType()) || e.isUndone()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This change can't be undone");
        }
        e.markUndone();
        return e;
    }

    public <T> T read(String value, Class<T> type) {
        return json.readValue(value, type);
    }

    private String write(Object value) {
        return value == null ? null : json.writeValueAsString(value);
    }
}
