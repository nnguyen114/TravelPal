package com.travelpal.place;

import com.travelpal.common.Auth;
import com.travelpal.common.Counters;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class PlaceController {
    static final int SEARCHES_PER_HOUR = 300;

    private final PlaceSearch places;
    private final Counters counters;

    PlaceController(PlaceSearch places, Counters counters) {
        this.places = places;
        this.counters = counters;
    }

    @GetMapping("/api/places/search")
    List<PlaceSearch.Place> search(@AuthenticationPrincipal Jwt jwt, @RequestParam @NotBlank @Size(max = 200) String q,
                                   @RequestParam(required = false) @Min(-90) @Max(90) Double lat,
                                   @RequestParam(required = false) @Min(-180) @Max(180) Double lng) {
        // A shared provider: cap each account so one script can't get everyone throttled.
        if (!counters.allow("places:" + Auth.userId(jwt), SEARCHES_PER_HOUR, Duration.ofHours(1))) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many searches. Try again later.");
        }
        return places.search(q, lat, lng);
    }
}
