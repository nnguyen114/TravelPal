package com.travelpal.history;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface TripEventRepository extends JpaRepository<TripEvent, Long> {
    /** Keyset page, newest first, with the actor's display name. */
    @Query("""
        select e, u.displayName from TripEvent e left join com.travelpal.auth.User u on u.id = e.actorId
        where e.tripId = ?1 and e.id < ?2 order by e.id desc""")
    List<Object[]> page(UUID tripId, long beforeId, Limit limit);

    Optional<TripEvent> findByIdAndTripId(Long id, UUID tripId);
}
