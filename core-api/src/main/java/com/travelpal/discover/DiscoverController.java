package com.travelpal.discover;

import com.travelpal.common.Auth;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/trips/{tripId}")
public class DiscoverController {
    public record DiscoverRequest(@Size(max = 500) String query, Integer dayIndex, UUID likeDestinationId) {}
    public record NotInterested(@NotBlank @Size(max = 200) String providerId, @NotBlank @Size(max = 200) String name) {}
    public record LinkRequest(@NotBlank @Size(max = 2000) @Pattern(regexp = "(?i)https?://.+") String url) {}

    private final DiscoverService discover;

    DiscoverController(DiscoverService discover) {
        this.discover = discover;
    }

    @PostMapping(path = "/discover", produces = MediaType.APPLICATION_JSON_VALUE)
    String discover(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody DiscoverRequest req)
            throws InterruptedException {
        return discover.discover(Auth.userId(jwt), tripId, req.query(), req.dayIndex(), req.likeDestinationId());
    }

    @PostMapping("/discover/not-interested")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void notInterested(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody NotInterested req) {
        discover.notInterested(Auth.userId(jwt), tripId, req.providerId(), req.name());
    }

    @PostMapping(path = "/places/from-link", produces = MediaType.APPLICATION_JSON_VALUE)
    String fromLink(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody LinkRequest req)
            throws InterruptedException {
        return discover.fromLink(Auth.userId(jwt), tripId, req.url());
    }
}
