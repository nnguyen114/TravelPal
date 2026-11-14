package com.travelpal.trip;

import com.travelpal.history.History;
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
    private final History history;

    TripService(TripRepository trips, TripMemberRepository members, TripCityRepository cities, TripAccess access, EntityManager em,
                History history) {
        this.trips = trips;
        this.members = members;
        this.cities = cities;
        this.access = access;
        this.em = em;
        this.history = history;
    }

    @Transactional
    public Trip create(UUID userId, String name, LocalDate start, LocalDate end, CityInput city) {
        checkDates(start, end);
        Trip trip = trips.save(new Trip(name, start, end, userId));
        members.save(new TripMember(trip.getId(), userId, TripRole.OWNER));
        saveCity(trip, new TripCity(trip.getId(), 0), city);
        history.record(trip.getId(), userId, "TRIP_CREATED", "created the trip", null, null);
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

    /** Invite preview: trip summary plus the caller's role (null if not a member). Callers must have validated the invite. */
    @Transactional(readOnly = true)
    public Summary summaryForInvite(UUID tripId, UUID userId) {
        Trip t = load(tripId);
        TripRole role = members.findByTripIdAndUserId(tripId, userId).map(TripMember::getRole).orElse(null);
        long count = members.countByTrip(List.of(tripId)).stream().mapToLong(r -> (Long) r[1]).sum();
        List<String> names = cities.findByTripIdInOrderByPosition(List.of(tripId)).stream().map(TripCity::getName).toList();
        return new Summary(t, role, count, names);
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
        boolean datesChanged = !trip.getStartDate().equals(start) || !trip.getEndDate().equals(end);
        trip.update(name, start, end);
        em.flush();
        history.record(tripId, userId, "TRIP_UPDATED", datesChanged ? "changed the trip dates" : "renamed the trip to " + trip.getName(), null, null);
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
        TripCity c = saveCity(load(tripId), new TripCity(tripId, cities.maxPosition(tripId) + 1), in);
        history.record(tripId, userId, "CITY_ADDED", "added " + c.getName(), null, null);
        return c;
    }

    @Transactional
    public TripCity updateCity(UUID userId, UUID tripId, UUID cityId, CityInput in) {
        access.require(tripId, userId, TripRole.EDITOR);
        TripCity c = saveCity(load(tripId), city(tripId, cityId), in);
        history.record(tripId, userId, "CITY_UPDATED", "updated " + c.getName(), null, null);
        return c;
    }

    @Transactional
    public void deleteCity(UUID userId, UUID tripId, UUID cityId) {
        access.require(tripId, userId, TripRole.EDITOR);
        TripCity c = city(tripId, cityId);
        cities.delete(c);
        history.record(tripId, userId, "CITY_REMOVED", "removed " + c.getName(), null, null);
    }

    /** Idempotent: joining a trip you're already in keeps your current role. */
    @Transactional
    public void join(UUID tripId, UUID userId, TripRole role) {
        if (members.findByTripIdAndUserId(tripId, userId).isEmpty()) {
            members.save(new TripMember(tripId, userId, role));
            history.record(tripId, userId, "MEMBER_JOINED", "joined the trip", null, null);
        }
    }

    @Transactional
    public void changeRole(UUID userId, UUID tripId, UUID memberId, TripRole role) {
        access.require(tripId, userId, TripRole.OWNER);
        if (userId.equals(memberId)) {
            throw bad("You can't change your own role");
        }
        TripMember m = member(tripId, memberId);
        m.setRole(role);
        history.record(tripId, userId, "MEMBER_ROLE_CHANGED", "made " + name(tripId, memberId) + " " + role.name().toLowerCase(), null, null);
    }

    /** Owners can remove anyone; anyone can leave. The last owner can't leave. */
    @Transactional
    public void removeMember(UUID userId, UUID tripId, UUID memberId) {
        access.require(tripId, userId, userId.equals(memberId) ? TripRole.VIEWER : TripRole.OWNER);
        TripMember m = member(tripId, memberId);
        if (m.getRole() == TripRole.OWNER && members.countByTripIdAndRole(tripId, TripRole.OWNER) == 1) {
            throw bad("Make someone else an owner first");
        }
        String who = name(tripId, memberId);
        members.delete(m);
        history.record(tripId, userId, "MEMBER_REMOVED", userId.equals(memberId) ? "left the trip" : "removed " + who, null, null);
    }

    /** Account deletion: each trip this user solely owns goes to its longest-standing member, or is deleted if they're alone. */
    @Transactional
    public void releaseAll(UUID userId) {
        for (TripMember m : members.findByUserId(userId)) {
            UUID tripId = m.getTripId();
            var next = members.findFirstByTripIdAndUserIdNotOrderByJoinedAtAsc(tripId, userId);
            if (next.isEmpty()) {
                trips.deleteById(tripId);
                continue;
            }
            if (m.getRole() == TripRole.OWNER && members.countByTripIdAndRole(tripId, TripRole.OWNER) == 1) {
                next.get().setRole(TripRole.OWNER);
            }
            history.record(tripId, userId, "MEMBER_REMOVED", "left the trip", null, null);
        }
    }

    private TripMember member(UUID tripId, UUID memberId) {
        return members.findByTripIdAndUserId(tripId, memberId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Member not found"));
    }

    private String name(UUID tripId, UUID memberId) {
        return members.membersOf(tripId).stream().filter(r -> r[0].equals(memberId)).map(r -> (String) r[1]).findFirst().orElse("a member");
    }

    public long version(UUID tripId) {
        return load(tripId).getVersion();
    }

    /** Bumps the version only if it still equals {@code expected}; otherwise someone changed the trip: 409. */
    @Transactional
    public void claimVersion(UUID tripId, long expected) {
        int n = em.createQuery("update Trip t set t.version = t.version + 1 where t.id = ?1 and t.version = ?2")
            .setParameter(1, tripId).setParameter(2, expected).executeUpdate();
        if (n == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The trip changed since this preview was made. Run it again to include the latest edits.");
        }
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
