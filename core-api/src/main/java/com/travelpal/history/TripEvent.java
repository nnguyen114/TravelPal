package com.travelpal.history;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import java.time.Instant;
import java.util.UUID;

@Entity
public class TripEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private UUID tripId;
    private UUID actorId;
    private String type;
    private String summary;
    private String before;
    private String after;
    private boolean undone;
    private Instant createdAt;

    protected TripEvent() {}

    TripEvent(UUID tripId, UUID actorId, String type, String summary, String before, String after) {
        this.tripId = tripId;
        this.actorId = actorId;
        this.type = type;
        this.summary = summary;
        this.before = before;
        this.after = after;
        this.createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public UUID getTripId() { return tripId; }
    public UUID getActorId() { return actorId; }
    public String getType() { return type; }
    public String getSummary() { return summary; }
    public String getBefore() { return before; }
    public String getAfter() { return after; }
    public boolean isUndone() { return undone; }
    public Instant getCreatedAt() { return createdAt; }
    void markUndone() { undone = true; }
}
