package com.travelpal.optimize;

import com.travelpal.destination.Destination;
import com.travelpal.destination.DestinationService;
import com.travelpal.trip.TripService;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The trip as the AI service sees it: days, cities and every destination. Access-checked as the caller. */
@Component
public class TripSnapshot {
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm");

    public record Snapshot(Map<String, Object> data, long version) {}

    private final TripService trips;
    private final DestinationService destinations;

    TripSnapshot(TripService trips, DestinationService destinations) {
        this.trips = trips;
        this.destinations = destinations;
    }

    public Snapshot build(UUID userId, UUID tripId) {
        TripService.Detail d = trips.get(userId, tripId);
        List<Map<String, Object>> cities = d.cities().stream().map(c -> {
            Map<String, Object> m = new HashMap<>();
            m.put("name", c.getName());
            m.put("lat", c.getLat());
            m.put("lng", c.getLng());
            m.put("startDate", c.getStartDate() == null ? null : c.getStartDate().toString());
            m.put("endDate", c.getEndDate() == null ? null : c.getEndDate().toString());
            m.put("locked", c.isLocked());
            return m;
        }).toList();
        List<Map<String, Object>> dests = destinations.list(userId, tripId).stream().map(TripSnapshot::destination).toList();
        Map<String, Object> trip = Map.of("name", d.trip().getName(), "startDate", d.trip().getStartDate().toString(),
            "dayCount", d.trip().dayCount(), "cities", cities);
        return new Snapshot(Map.of("trip", trip, "destinations", dests), d.trip().getVersion());
    }

    private static Map<String, Object> destination(Destination x) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", x.getId().toString());
        m.put("name", x.getName());
        m.put("address", x.getAddress());
        m.put("lat", x.getLat());
        m.put("lng", x.getLng());
        m.put("durationMin", x.getDurationMin());
        m.put("dayIndex", x.getDayIndex());
        m.put("position", x.getPosition());
        m.put("startTime", x.getStartTime() == null ? null : x.getStartTime().format(HHMM));
        m.put("locked", x.isLocked());
        m.put("flexibility", x.getFlexibility().name());
        return m;
    }
}
