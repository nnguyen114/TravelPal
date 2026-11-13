package com.travelpal.destination;

import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class DestinationService {
    public record Input(String name, String address, Double lat, Double lng, String providerId, String notes,
                        Integer durationMin, Integer dayIndex, LocalTime startTime, boolean locked, Flexibility flexibility) {}

    private final DestinationRepository repo;
    private final TripAccess access;
    private final TripService trips;

    DestinationService(DestinationRepository repo, TripAccess access, TripService trips) {
        this.repo = repo;
        this.access = access;
        this.trips = trips;
    }

    @Transactional(readOnly = true)
    public List<Destination> list(UUID userId, UUID tripId) {
        access.require(tripId, userId, TripRole.VIEWER);
        return repo.findByTrip(tripId);
    }

    /** Adding to a day appends it; nothing else in the trip moves (optimization only runs on request). */
    @Transactional
    public Destination add(UUID userId, UUID tripId, Input in) {
        access.require(tripId, userId, TripRole.EDITOR);
        Destination d = new Destination(tripId, userId, in.providerId());
        apply(d, in);
        return repo.save(d);
    }

    @Transactional
    public Destination update(UUID userId, UUID tripId, UUID id, Input in) {
        access.require(tripId, userId, TripRole.EDITOR);
        Destination d = find(tripId, id);
        apply(d, in);
        return d;
    }

    @Transactional
    public void delete(UUID userId, UUID tripId, UUID id) {
        access.require(tripId, userId, TripRole.EDITOR);
        repo.delete(find(tripId, id));
    }

    /** Sets the visit order of one day; ids must be exactly the stops currently on that day. */
    @Transactional
    public List<Destination> reorder(UUID userId, UUID tripId, int dayIndex, List<UUID> ids) {
        access.require(tripId, userId, TripRole.EDITOR);
        Map<UUID, Destination> onDay = repo.findByTripIdAndDayIndex(tripId, dayIndex).stream()
            .collect(Collectors.toMap(Destination::getId, Function.identity()));
        if (ids.size() != onDay.size() || !onDay.keySet().equals(new HashSet<>(ids))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Day changed since you loaded it; refresh and retry");
        }
        for (int i = 0; i < ids.size(); i++) {
            onDay.get(ids.get(i)).schedule(dayIndex, i);
        }
        return ids.stream().map(onDay::get).toList();
    }

    private void apply(Destination d, Input in) {
        Integer day = in.dayIndex();
        if (day != null && (day < 0 || day >= trips.dayCount(d.getTripId()))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Day is outside the trip");
        }
        if (day == null) {
            d.schedule(null, null);
        } else if (!day.equals(d.getDayIndex())) {
            d.schedule(day, repo.maxPosition(d.getTripId(), day) + 1);
        }
        d.details(in.name(), in.address(), in.lat(), in.lng(), in.notes(), in.durationMin(), in.startTime(), in.locked(), in.flexibility());
    }

    private Destination find(UUID tripId, UUID id) {
        return repo.findByIdAndTripId(id, tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Destination not found"));
    }
}
