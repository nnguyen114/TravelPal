package com.travelpal.trip;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface TripRepository extends JpaRepository<Trip, UUID> {}

interface TripMemberRepository extends JpaRepository<TripMember, TripMember.Key> {
    Optional<TripMember> findByTripIdAndUserId(UUID tripId, UUID userId);

    List<TripMember> findByUserId(UUID userId);

    @Query("select m.tripId, count(m) from TripMember m where m.tripId in ?1 group by m.tripId")
    List<Object[]> countByTrip(Collection<UUID> tripIds);

    @Query("select m.userId, u.displayName, m.role from TripMember m, com.travelpal.auth.User u where u.id = m.userId and m.tripId = ?1 order by m.role desc, u.displayName")
    List<Object[]> membersOf(UUID tripId);
}

interface TripCityRepository extends JpaRepository<TripCity, UUID> {
    List<TripCity> findByTripIdInOrderByPosition(Collection<UUID> tripIds);

    Optional<TripCity> findByIdAndTripId(UUID id, UUID tripId);

    @Query("select coalesce(max(c.position), -1) from TripCity c where c.tripId = ?1")
    int maxPosition(UUID tripId);
}
