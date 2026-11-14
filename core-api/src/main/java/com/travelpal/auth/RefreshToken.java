package com.travelpal.auth;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.Instant;
import java.util.UUID;

@Entity
public class RefreshToken {
    @Id
    private UUID id;
    private UUID userId;
    private UUID familyId;
    private String tokenHash;
    private Instant expiresAt;
    private boolean revoked;

    protected RefreshToken() {}

    RefreshToken(UUID userId, UUID familyId, String tokenHash, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.familyId = familyId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    UUID getId() { return id; }
    UUID getUserId() { return userId; }
    UUID getFamilyId() { return familyId; }
    Instant getExpiresAt() { return expiresAt; }
}
