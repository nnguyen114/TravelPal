package com.travelpal.invite;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.Instant;
import java.util.UUID;

@Entity
public class InviteLink {
    @Id
    private UUID id;
    private UUID tripId;
    private String tokenHash;
    private UUID createdBy;
    private Instant expiresAt;
    private boolean revoked;

    protected InviteLink() {}

    InviteLink(UUID tripId, String tokenHash, UUID createdBy, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.tokenHash = tokenHash;
        this.createdBy = createdBy;
        this.expiresAt = expiresAt;
    }

    UUID getTripId() { return tripId; }
    Instant getExpiresAt() { return expiresAt; }

    boolean usable() {
        return !revoked && expiresAt.isAfter(Instant.now());
    }
}
