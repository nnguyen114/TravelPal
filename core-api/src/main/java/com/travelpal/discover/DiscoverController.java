package com.travelpal.discover;

import com.travelpal.assistant.AiServiceClient;
import com.travelpal.common.Auth;
import com.travelpal.destination.Destination;
import com.travelpal.destination.DestinationService;
import com.travelpal.optimize.AiQuota;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripCity;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Personalized suggestions, only on request. Taste comes from the places this traveler added (any trip) plus what
 * they marked Not interested; other members' additions only set the location, never this traveler's taste.
 */
@RestController
@RequestMapping("/api/trips/{tripId}")
public class DiscoverController {
    public record DiscoverRequest(@Size(max = 500) String query, Integer dayIndex, UUID likeDestinationId) {}
    public record NotInterested(@NotBlank @Size(max = 200) String providerId, @NotBlank @Size(max = 200) String name) {}
    public record LinkRequest(@NotBlank @Size(max = 2000) @Pattern(regexp = "(?i)https?://.+") String url) {}

    private final TripAccess access;
    private final TripService trips;
    private final DestinationService destinations;
    private final AiServiceClient ai;
    private final AiQuota quota;
    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    DiscoverController(TripAccess access, TripService trips, DestinationService destinations, AiServiceClient ai, AiQuota quota,
                       JdbcTemplate jdbc, JsonMapper json) {
        this.access = access;
        this.trips = trips;
        this.destinations = destinations;
        this.ai = ai;
        this.quota = quota;
        this.jdbc = jdbc;
        this.json = json;
    }

    @PostMapping("/discover")
    ResponseEntity<String> discover(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody DiscoverRequest req)
            throws InterruptedException {
        UUID user = Auth.userId(jwt);
        access.require(tripId, user, TripRole.VIEWER);
        List<Destination> inTrip = destinations.list(user, tripId);
        Destination like = req.likeDestinationId() == null ? null
            : inTrip.stream().filter(d -> d.getId().equals(req.likeDestinationId())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Place not found"));
        if ((req.query() == null || req.query().isBlank()) && like == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Say what you're looking for");
        }
        double[] center = center(user, tripId, inTrip, req.dayIndex(), like);
        quota.spend(user, AiQuota.Kind.DISCOVER);

        List<Map<String, Object>> exclude = new ArrayList<>();
        inTrip.forEach(d -> exclude.add(place(d.getName(), d.getProviderId(), null)));
        jdbc.query("select provider_id, name from taste_signal where user_id = ?",
            rs -> { exclude.add(place(rs.getString(2), rs.getString(1), null)); }, user);
        Map<String, Object> body = new HashMap<>();
        body.put("request", req.query());
        body.put("center", Map.of("lat", center[0], "lng", center[1]));
        body.put("radiusKm", req.dayIndex() != null || like != null ? 2.5 : 6);
        body.put("taste", destinations.ownPicks(user, 40).stream().map(d -> place(d.getName(), null, d.getAddress())).toList());
        body.put("seeds", like == null ? List.of() : List.of(place(like.getName(), null, like.getAddress())));
        body.put("exclude", exclude);
        try (InputStream in = ai.post("/internal/discover", json.writeValueAsString(body), user, Duration.ofSeconds(90), "Find More Places")) {
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @PostMapping("/discover/not-interested")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void notInterested(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody NotInterested req) {
        UUID user = Auth.userId(jwt);
        access.require(tripId, user, TripRole.VIEWER);
        jdbc.update("insert into taste_signal (user_id, provider_id, name) values (?, ?, ?) on conflict do nothing",
            user, req.providerId(), req.name());
    }

    @PostMapping("/places/from-link")
    ResponseEntity<String> fromLink(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody LinkRequest req)
            throws InterruptedException {
        UUID user = Auth.userId(jwt);
        access.require(tripId, user, TripRole.VIEWER);
        quota.spend(user, AiQuota.Kind.ASSISTANT);
        Map<String, Object> body = new HashMap<>();
        body.put("url", req.url());
        trips.get(user, tripId).cities().stream().filter(c -> c.getLat() != null).findFirst()
            .ifPresent(c -> body.put("near", Map.of("lat", c.getLat(), "lng", c.getLng())));
        try (InputStream in = ai.post("/internal/link", json.writeValueAsString(body), user, Duration.ofSeconds(60), "Link import")) {
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Near the place being matched, else that day's stops, else the trip's first located city, else any located place. */
    private double[] center(UUID user, UUID tripId, List<Destination> inTrip, Integer day, Destination like) {
        if (like != null && like.getLat() != null) {
            return new double[] {like.getLat(), like.getLng()};
        }
        List<Destination> pts = inTrip.stream().filter(d -> d.getLat() != null && (day == null || day.equals(d.getDayIndex()))).toList();
        if (day != null && !pts.isEmpty()) {
            return new double[] {pts.stream().mapToDouble(Destination::getLat).average().orElseThrow(),
                pts.stream().mapToDouble(Destination::getLng).average().orElseThrow()};
        }
        TripCity city = trips.get(user, tripId).cities().stream().filter(c -> c.getLat() != null).findFirst().orElse(null);
        if (city != null) {
            return new double[] {city.getLat(), city.getLng()};
        }
        Destination any = inTrip.stream().filter(d -> d.getLat() != null).findFirst().orElse(null);
        if (any != null) {
            return new double[] {any.getLat(), any.getLng()};
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Add a place with a map location first, so we know where to look");
    }

    private static Map<String, Object> place(String name, String providerId, String address) {
        Map<String, Object> m = new HashMap<>();
        m.put("name", name);
        m.put("providerId", providerId);
        m.put("address", address);
        return m;
    }
}
