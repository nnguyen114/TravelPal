package com.travelpal.trip;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** The single RBAC gate for trip data. Non-members get 404 so trip ids can't be probed. */
@Component
public class TripAccess {
    private final TripMemberRepository members;

    TripAccess(TripMemberRepository members) {
        this.members = members;
    }

    public TripRole require(UUID tripId, UUID userId, TripRole min) {
        TripRole role = members.findByTripIdAndUserId(tripId, userId)
            .map(TripMember::getRole)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Trip not found"));
        if (!role.atLeast(min)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Requires " + min + " role");
        }
        return role;
    }
}
