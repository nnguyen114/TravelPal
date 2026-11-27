package com.travelpal.optimize;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
public class OptimizationPreview {
    public enum Status { PENDING, READY, FAILED, APPLIED, DISCARDED }

    @Id
    private UUID id;
    private UUID tripId;
    private UUID requestedBy;
    private long baseVersion;
    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    private Status status;
    private String request;
    private String result;
    private String error;
    private Instant createdAt;
    /** A worker's result, an expiry, apply and discard can race; the loser's write fails instead of overwriting. */
    @Version
    private Long version;

    protected OptimizationPreview() {}

    OptimizationPreview(UUID id, UUID tripId, UUID requestedBy, long baseVersion, String request) {
        this.id = id;
        this.tripId = tripId;
        this.requestedBy = requestedBy;
        this.baseVersion = baseVersion;
        this.request = request;
        this.status = Status.PENDING;
        this.createdAt = Instant.now();
    }

    void complete(Status status, String result, String error) {
        this.status = status;
        this.result = result;
        this.error = error;
    }

    void setStatus(Status status) { this.status = status; }

    public UUID getId() { return id; }
    public UUID getTripId() { return tripId; }
    public long getBaseVersion() { return baseVersion; }
    public Status getStatus() { return status; }
    public String getRequest() { return request; }
    public String getResult() { return result; }
    public String getError() { return error; }
    public Instant getCreatedAt() { return createdAt; }
}
