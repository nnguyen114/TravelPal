package com.travelpal.place;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Place search on OpenStreetMap data through Photon. A provider failure (outage, throttling, timeout: see
 * spring.http.clients.* for timeouts) is a 503 the app can show, never an empty list that looks like "no matches".
 */
// ponytail: Photon's public server is free with fair-use throttling; self-host it or switch provider before real traffic.
@Service
public class PlaceSearch {
    public record Place(String name, String address, double lat, double lng, String providerId) {}

    private static final Logger log = LoggerFactory.getLogger(PlaceSearch.class);
    private final RestClient http;

    PlaceSearch(RestClient.Builder builder, @Value("${travelpal.places-url}") String baseUrl) {
        this.http = builder.baseUrl(baseUrl).defaultHeader("User-Agent", "travelpal-core-api").build();
    }

    public List<Place> search(String q, Double lat, Double lng) {
        Map<?, ?> body;
        try {
            body = http.get().uri(u -> {
                u.path("/api/").queryParam("q", q).queryParam("limit", 8).queryParam("lang", "en");
                if (lat != null && lng != null) {
                    u.queryParam("lat", lat).queryParam("lon", lng);
                }
                return u.build();
            }).retrieve().body(Map.class);
        } catch (RestClientException e) {
            log.warn("Place search failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Place search is unavailable right now. Try again in a minute.");
        }
        if (body == null || !(body.get("features") instanceof List<?> features)) {
            return List.of();
        }
        var seen = new HashSet<String>();
        return features.stream().map(f -> toPlace((Map<?, ?>) f)).filter(Objects::nonNull).filter(p -> seen.add(p.providerId())).toList();
    }

    /** A Photon feature as a place, or null if it has no name (bare addresses aren't places anyone picks). */
    static Place toPlace(Map<?, ?> feature) {
        Map<?, ?> p = (Map<?, ?>) feature.get("properties");
        if (!(p.get("name") instanceof String name) || name.isBlank()) {
            return null;
        }
        List<?> c = (List<?>) ((Map<?, ?>) feature.get("geometry")).get("coordinates");
        String address = String.join(", ", Stream.of("street", "district", "city", "country")
            .map(p::get).filter(Objects::nonNull).map(Object::toString).toList());
        return new Place(name.strip(), address, ((Number) c.get(1)).doubleValue(), ((Number) c.get(0)).doubleValue(),
            "osm:" + p.get("osm_type") + p.get("osm_id"));
    }
}
