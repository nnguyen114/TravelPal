package com.travelpal.proposal;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Entity
public class Proposal {
    public enum Status { OPEN, MERGED, CLOSED }

    @Id
    private UUID id;
    private UUID tripId;
    private UUID authorId;
    private String title;
    private String description;
    private String changes;
    @Enumerated(EnumType.STRING)
    private Status status;
    private String impact;
    private UUID impactBy;
    private Instant createdAt;
    private Instant closedAt;
    private UUID closedBy;

    protected Proposal() {}

    Proposal(UUID tripId, UUID authorId, String title, String description, String changes) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.authorId = authorId;
        this.title = title.trim();
        this.description = description;
        this.changes = changes;
        this.status = Status.OPEN;
        // Postgres keeps microseconds; trimming here keeps the paging cursor identical before and after a reload.
        this.createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    void settle(Status status, UUID by) {
        this.status = status;
        this.closedBy = by;
        this.closedAt = Instant.now();
    }

    void impact(String impact, UUID by) {
        this.impact = impact;
        this.impactBy = by;
    }

    public UUID getId() { return id; }
    public UUID getTripId() { return tripId; }
    public UUID getAuthorId() { return authorId; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getChanges() { return changes; }
    public Status getStatus() { return status; }
    public String getImpact() { return impact; }
    public UUID getImpactBy() { return impactBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getClosedAt() { return closedAt; }
}
