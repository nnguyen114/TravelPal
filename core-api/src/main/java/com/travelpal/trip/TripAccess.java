package com.travelpal.trip;

import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

/** The single RBAC gate for trip data. Non-members get 404 so trip ids can't be probed. */
@Component
public class TripAccess {
    private final TripMemberRepository members;
    private final EntityManager em;

    TripAccess(TripMemberRepository members, EntityManager em) {
        this.members = members;
        this.em = em;
    }

    /**
     * In a write transaction this first locks the trip (see {@link #lock}), so every change to a trip is checked
     * against what the previous change committed: the owner count, the day range, a preview's status.
     */
    public TripRole require(UUID tripId, UUID userId, TripRole min) {
        if (TransactionSynchronizationManager.isActualTransactionActive() && !TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            lock(tripId);
        }
        TripRole role = members.findByTripIdAndUserId(tripId, userId)
            .map(TripMember::getRole)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Trip not found"));
        if (!role.atLeast(min)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Requires " + min + " role");
        }
        return role;
    }

    /**
     * Locks the trip row until the transaction ends. Writes to one trip run one at a time, always trip first, so
     * they can't interleave (two owners leaving at once, a move racing a shorter trip) or deadlock on each other.
     */
    // ponytail: one lock per trip serializes its writes; fine at a trip's edit rate, finer locks if that ever shows.
    public void lock(UUID tripId) {
        em.createNativeQuery("select 1 from trip where id = ?1 for update").setParameter(1, tripId).getResultList();
    }
}
