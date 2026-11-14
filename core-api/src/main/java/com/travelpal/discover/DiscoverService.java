package com.travelpal.discover;

import com.travelpal.assistant.AiServiceClient;
import com.travelpal.destination.Destination;
import com.travelpal.destination.DestinationService;
import com.travelpal.optimize.AiQuota;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripCity;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;
import java.util.Optional;

/**
 * Personalized suggestions, only on request. Taste comes from the places this traveler added (any trip) plus what
 * they marked Not interested; other members' additions only set the location, never this traveler's taste.
 */
@Service
public class DiscoverService {
    private final TripAccess access;
    private final TripService trips;
    private final DestinationService destinations;
    private final AiServiceClient ai;
    private final AiQuota quota;
    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    DiscoverService(TripAccess access, TripService trips, DestinationService destinations, AiServiceClient ai, AiQuota quota,
                    JdbcTemplate jdbc, JsonMapper json) {
        this.access = access;
        this.trips = trips;
        this.destinations = destinations;
        this.ai = ai;
        this.quota = quota;
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Suggestions as JSON from ai-service: for a typed request, or "more like" one of the trip's places. */
    public String discover(UUID user, UUID tripId, String query, Integer dayIndex, UUID likeId) throws InterruptedException {
        access.require(tripId, user, TripRole.VIEWER);
        List<Destination> inTrip = destinations.list(user, tripId);
        Destination like = likeId == null ? null : inTrip.stream().filter(d -> d.getId().equals(likeId)).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Place not found"));
        if ((query == null || query.isBlank()) && like == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Say what you're looking for");
        }
        double[] center = center(user, tripId, inTrip, dayIndex, like);
        quota.spend(user, AiQuota.Kind.DISCOVER);

        List<Map<String, Object>> exclude = new ArrayList<>();
        inTrip.forEach(d -> exclude.add(place(d.getName(), d.getProviderId(), null)));
        jdbc.query("select provider_id, name from taste_signal where user_id = ?",
            rs -> { exclude.add(place(rs.getString(2), rs.getString(1), null)); }, user);
        Map<String, Object> body = new HashMap<>();
        body.put("request", query);
        body.put("center", Map.of("lat", center[0], "lng", center[1]));
        body.put("radiusKm", dayIndex != null || like != null ? 2.5 : 6);
        body.put("taste", destinations.ownPicks(user, 40).stream().map(d -> place(d.getName(), null, d.getAddress())).toList());
        body.put("seeds", like == null ? List.of() : List.of(place(like.getName(), null, like.getAddress())));
        body.put("exclude", exclude);
        return ai.call("/internal/discover", json.writeValueAsString(body), user, Duration.ofSeconds(90), "Find More Places");
    }

    /** "Not interested": personal to the traveler, kept across trips, never suggested again. */
    public void notInterested(UUID user, UUID tripId, String providerId, String name) {
        access.require(tripId, user, TripRole.VIEWER);
        jdbc.update("insert into taste_signal (user_id, provider_id, name) values (?, ?, ?) on conflict do nothing",
            user, providerId, name);
    }

    /** Candidate places for a pasted link (maps, website, social post), biased to the trip's first located city. */
    public String fromLink(UUID user, UUID tripId, String url) throws InterruptedException {
        access.require(tripId, user, TripRole.VIEWER);
        quota.spend(user, AiQuota.Kind.ASSISTANT);
        Map<String, Object> body = new HashMap<>();
        body.put("url", url);
        firstLocatedCity(user, tripId).ifPresent(c -> body.put("near", Map.of("lat", c.getLat(), "lng", c.getLng())));
        return ai.call("/internal/link", json.writeValueAsString(body), user, Duration.ofSeconds(60), "Link import");
    }

    /** Near the place being matched, else that day's stops, else the trip's first located city, else any located place. */
    private double[] center(UUID user, UUID tripId, List<Destination> inTrip, Integer day, Destination like) {
        if (like != null && like.getLat() != null) {
            return new double[] {like.getLat(), like.getLng()};
        }
        List<Destination> located = inTrip.stream().filter(d -> d.getLat() != null).toList();
        List<Destination> onDay = located.stream().filter(d -> day != null && day.equals(d.getDayIndex())).toList();
        if (!onDay.isEmpty()) {
            return new double[] {onDay.stream().mapToDouble(Destination::getLat).average().orElseThrow(),
                onDay.stream().mapToDouble(Destination::getLng).average().orElseThrow()};
        }
        return firstLocatedCity(user, tripId).map(c -> new double[] {c.getLat(), c.getLng()})
            .or(() -> located.stream().findFirst().map(d -> new double[] {d.getLat(), d.getLng()}))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Add a place with a map location first, so we know where to look"));
    }

    private Optional<TripCity> firstLocatedCity(UUID user, UUID tripId) {
        return trips.get(user, tripId).cities().stream().filter(c -> c.getLat() != null).findFirst();
    }

    private static Map<String, Object> place(String name, String providerId, String address) {
        Map<String, Object> m = new HashMap<>(); // HashMap: values may be null
        m.put("name", name);
        m.put("providerId", providerId);
        m.put("address", address);
        return m;
    }
}
