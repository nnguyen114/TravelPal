package com.travelpal.destination;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface DestinationRepository extends JpaRepository<Destination, UUID> {
    @Query("select d from Destination d where d.tripId = ?1 order by d.dayIndex nulls last, d.position, d.name")
    List<Destination> findByTrip(UUID tripId);

    List<Destination> findByTripIdAndDayIndex(UUID tripId, int dayIndex);

    Optional<Destination> findByIdAndTripId(UUID id, UUID tripId);

    @Query("select coalesce(max(d.position), -1) from Destination d where d.tripId = ?1 and d.dayIndex = ?2")
    int maxPosition(UUID tripId, int dayIndex);
}
