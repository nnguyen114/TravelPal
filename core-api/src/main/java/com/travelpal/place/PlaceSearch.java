package com.travelpal.place;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Place search on OpenStreetMap data through Geoapify's geocoder. A failure (no key, outage, throttling, timeout:
 * see spring.http.clients.*) is a 503 the app can show, never an empty list that looks like "no matches".
 * The API key travels in the URL, so failures are logged by status or cause only, never by exception message.
 */
@Service
public class PlaceSearch {
    public record Place(String name, String address, double lat, double lng, String providerId) {}

    private static final Logger log = LoggerFactory.getLogger(PlaceSearch.class);
    private final RestClient http;
    private final String apiKey;

    PlaceSearch(RestClient.Builder builder, @Value("${travelpal.places-url}") String baseUrl,
                @Value("${travelpal.places-api-key}") String apiKey) {
        this.http = builder.baseUrl(baseUrl).defaultHeader("User-Agent", "travelpal-core-api").build();
        this.apiKey = apiKey;
    }

    public List<Place> search(String q, Double lat, Double lng) {
        if (apiKey.isBlank()) {
            log.error("PLACES_API_KEY is not set; place search is off");
            throw unavailable();
        }
        Map<?, ?> body;
        try {
            body = http.get().uri(u -> {
                u.path("/v1/geocode/search").queryParam("text", q).queryParam("format", "json").queryParam("limit", 8)
                    .queryParam("lang", "en").queryParam("apiKey", apiKey);
                if (lat != null && lng != null) {
                    u.queryParam("bias", "proximity:" + lng + "," + lat);
                }
                return u.build();
            }).retrieve().body(Map.class);
        } catch (RestClientResponseException e) {
            log.warn("Place search failed: HTTP {}", e.getStatusCode().value());
            throw unavailable();
        } catch (RestClientException e) {
            log.warn("Place search failed: {}", e.getMostSpecificCause().getClass().getSimpleName());
            throw unavailable();
        }
        if (body == null || !(body.get("results") instanceof List<?> results)) {
            return List.of();
        }
        var seen = new HashSet<String>();
        return results.stream().map(r -> toPlace((Map<?, ?>) r)).filter(Objects::nonNull).filter(p -> seen.add(p.providerId())).toList();
    }

    /** A geocoder result as a place, or null if it has no name (bare coordinates aren't places anyone picks). */
    static Place toPlace(Map<?, ?> r) {
        Object name = r.get("name") != null ? r.get("name") : r.get("address_line1");
        if (!(name instanceof String n) || n.isBlank() || !(r.get("lat") instanceof Number lat) || !(r.get("lon") instanceof Number lon)) {
            return null;
        }
        Object address = r.get("address_line2");
        return new Place(n.strip(), address == null ? "" : address.toString(), lat.doubleValue(), lon.doubleValue(),
            "geoapify:" + r.get("place_id"));
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Place search is unavailable right now. Try again in a minute.");
    }
}
