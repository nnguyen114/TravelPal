package com.travelpal.trip;

import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TripService {
    static final int MAX_DAYS = 60;

    public record CityInput(String name, Double lat, Double lng, LocalDate startDate, LocalDate endDate, boolean locked) {}
    public record Summary(Trip trip, TripRole role, long memberCount, List<String> cities) {}
    public record Member(UUID userId, String displayName, TripRole role) {}
    public record Detail(Trip trip, TripRole role, List<TripCity> cities, List<Member> members) {}

    private final TripRepository trips;
    private final TripMemberRepository members;
    private final TripCityRepository cities;
    private final TripAccess access;
    private final EntityManager em;

    TripService(TripRepository trips, TripMemberRepository members, TripCityRepository cities, TripAccess access, EntityManager em) {
        this.trips = trips;
        this.members = members;
        this.cities = cities;
        this.access = access;
        this.em = em;
    }

    @Transactional
    public Trip create(UUID userId, String name, LocalDate start, LocalDate end, CityInput city) {
        checkDates(start, end);
        Trip trip = trips.save(new Trip(name, start, end, userId));
        members.save(new TripMember(trip.getId(), userId, TripRole.OWNER));
        saveCity(trip, new TripCity(trip.getId(), 0), city);
        return trip;
    }

    @Transactional(readOnly = true)
    public List<Summary> list(UUID userId) {
        Map<UUID, TripRole> roles = members.findByUserId(userId).stream()
            .collect(Collectors.toMap(TripMember::getTripId, TripMember::getRole));
        if (roles.isEmpty()) {
            return List.of();
        }
        Map<UUID, Long> counts = members.countByTrip(roles.keySet()).stream()
            .collect(Collectors.toMap(r -> (UUID) r[0], r -> (Long) r[1]));
        Map<UUID, List<String>> cityNames = cities.findByTripIdInOrderByPosition(roles.keySet()).stream()
            .collect(Collectors.groupingBy(TripCity::getTripId, Collectors.mapping(TripCity::getName, Collectors.toList())));
        return trips.findAllById(roles.keySet()).stream()
            .sorted((a, b) -> a.getStartDate().compareTo(b.getStartDate()))
            .map(t -> new Summary(t, roles.get(t.getId()), counts.get(t.getId()), cityNames.getOrDefault(t.getId(), List.of())))
            .toList();
    }

    @Transactional(readOnly = true)
    public Detail get(UUID userId, UUID tripId) {
        TripRole role = access.require(tripId, userId, TripRole.VIEWER);
        List<Member> ms = members.membersOf(tripId).stream()
            .map(r -> new Member((UUID) r[0], (String) r[1], (TripRole) r[2]))
            .toList();
        return new Detail(load(tripId), role, cities.findByTripIdInOrderByPosition(List.of(tripId)), ms);
    }

    /** Shortening a trip moves stops on removed days back to Unscheduled rather than deleting them. */
    @Transactional
    public Trip update(UUID userId, UUID tripId, String name, LocalDate start, LocalDate end) {
        access.require(tripId, userId, TripRole.EDITOR);
        checkDates(start, end);
        Trip trip = load(tripId);
        trip.update(name, start, end);
        em.createQuery("update Destination d set d.dayIndex = null, d.position = null where d.tripId = ?1 and d.dayIndex >= ?2")
            .setParameter(1, tripId).setParameter(2, trip.dayCount()).executeUpdate();
        return trip;
    }

    @Transactional
    public void delete(UUID userId, UUID tripId) {
        access.require(tripId, userId, TripRole.OWNER);
        trips.deleteById(tripId);
    }

    @Transactional
    public TripCity addCity(UUID userId, UUID tripId, CityInput in) {
        access.require(tripId, userId, TripRole.EDITOR);
        return saveCity(load(tripId), new TripCity(tripId, cities.maxPosition(tripId) + 1), in);
    }

    @Transactional
    public TripCity updateCity(UUID userId, UUID tripId, UUID cityId, CityInput in) {
        access.require(tripId, userId, TripRole.EDITOR);
        return saveCity(load(tripId), city(tripId, cityId), in);
    }

    @Transactional
    public void deleteCity(UUID userId, UUID tripId, UUID cityId) {
        access.require(tripId, userId, TripRole.EDITOR);
        cities.delete(city(tripId, cityId));
    }

    public int dayCount(UUID tripId) {
        return load(tripId).dayCount();
    }

    private TripCity saveCity(Trip trip, TripCity c, CityInput in) {
        if ((in.startDate() == null) != (in.endDate() == null)) {
            throw bad("City dates need both start and end, or neither");
        }
        if (in.startDate() != null && (in.endDate().isBefore(in.startDate())
                || in.startDate().isBefore(trip.getStartDate()) || in.endDate().isAfter(trip.getEndDate()))) {
            throw bad("City dates must fall within the trip");
        }
        c.update(in.name(), in.lat(), in.lng(), in.startDate(), in.endDate(), in.locked());
        return cities.save(c);
    }

    private TripCity city(UUID tripId, UUID cityId) {
        return cities.findByIdAndTripId(cityId, tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "City not found"));
    }

    private Trip load(UUID tripId) {
        return trips.findById(tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Trip not found"));
    }

    private static void checkDates(LocalDate start, LocalDate end) {
        if (end.isBefore(start)) {
            throw bad("End date is before start date");
        }
        if (start.plusDays(MAX_DAYS).isBefore(end.plusDays(1))) {
            throw bad("Trips can be at most " + MAX_DAYS + " days");
        }
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
