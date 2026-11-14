package com.travelpal.destination;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.LocalTime;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.domain.Limit;

interface DestinationRepository extends JpaRepository<Destination, UUID> {
    @Query("select d from Destination d where d.tripId = ?1 order by d.dayIndex nulls last, d.position, d.name")
    List<Destination> findByTrip(UUID tripId);

    List<Destination> findByTripIdAndDayIndex(UUID tripId, int dayIndex);

    Optional<Destination> findByIdAndTripId(UUID id, UUID tripId);

    /** A traveler's own picks across all their trips: the strongest taste signal we have. */
    @Query("select d from Destination d where d.createdBy = ?1 order by d.createdAt desc")
    List<Destination> ownPicks(UUID userId, Limit limit);

    /** AI suggestions land only on places nobody has tagged; a bulk update so editors' versions aren't bumped. */
    @Modifying
    @Query("""
        update Destination d set d.visitAfter = ?3, d.visitBefore = ?4, d.dayTrip = ?5, d.hintsSource = 'AI'
        where d.id = ?2 and d.tripId = ?1 and d.hintsSource is null""")
    int suggestHints(UUID tripId, UUID id, LocalTime after, LocalTime before, boolean dayTrip);

    @Query("select coalesce(max(d.position), -1) from Destination d where d.tripId = ?1 and d.dayIndex = ?2")
    int maxPosition(UUID tripId, int dayIndex);
}
