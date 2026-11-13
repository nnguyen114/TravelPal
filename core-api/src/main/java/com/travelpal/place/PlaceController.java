package com.travelpal.place;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/** Place search proxied server-side so the provider can be swapped without touching clients. */
// ponytail: Photon (OSM) is free with fair-use limits; switch to Google Places/Foursquare with a key before real traffic.
@RestController
@Validated
public class PlaceController {
    public record Place(String name, String address, double lat, double lng, String providerId) {}

    private final RestClient http;

    PlaceController(RestClient.Builder builder, @Value("${travelpal.places-url}") String baseUrl) {
        this.http = builder.baseUrl(baseUrl).defaultHeader("User-Agent", "travelpal-core-api").build();
    }

    @GetMapping("/api/places/search")
    List<Place> search(@RequestParam @NotBlank @Size(max = 200) String q,
                       @RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng) {
        Map<?, ?> body = http.get().uri(u -> {
            u.path("/api/").queryParam("q", q).queryParam("limit", 8).queryParam("lang", "en");
            if (lat != null && lng != null) {
                u.queryParam("lat", lat).queryParam("lon", lng);
            }
            return u.build();
        }).retrieve().body(Map.class);
        if (body == null) {
            return List.of();
        }
        var seen = new java.util.HashSet<String>();
        return ((List<?>) body.get("features")).stream().map(f -> toPlace((Map<?, ?>) f)).filter(p -> seen.add(p.providerId())).toList();
    }

    static Place toPlace(Map<?, ?> feature) {
        Map<?, ?> p = (Map<?, ?>) feature.get("properties");
        List<?> c = (List<?>) ((Map<?, ?>) feature.get("geometry")).get("coordinates");
        String address = String.join(", ", java.util.stream.Stream.of("street", "district", "city", "country")
            .map(p::get).filter(v -> v != null).map(Object::toString).toList());
        return new Place(String.valueOf(p.get("name")), address, ((Number) c.get(1)).doubleValue(), ((Number) c.get(0)).doubleValue(),
            "osm:" + p.get("osm_type") + p.get("osm_id"));
    }
}
