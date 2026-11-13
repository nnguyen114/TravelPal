package com.travelpal.trip;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import java.util.UUID;

@Entity
@IdClass(TripMember.Key.class)
public class TripMember {
    public record Key(UUID tripId, UUID userId) {}

    @Id
    private UUID tripId;
    @Id
    private UUID userId;
    @Enumerated(EnumType.STRING)
    private TripRole role;

    protected TripMember() {}

    TripMember(UUID tripId, UUID userId, TripRole role) {
        this.tripId = tripId;
        this.userId = userId;
        this.role = role;
    }

    public UUID getTripId() { return tripId; }
    public UUID getUserId() { return userId; }
    public TripRole getRole() { return role; }
}
