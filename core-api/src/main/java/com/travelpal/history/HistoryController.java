package com.travelpal.history;

import com.travelpal.common.Auth;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/trips/{tripId}")
public class HistoryController {
    private final History history;
    private final TripStream stream;
    private final TripAccess access;

    HistoryController(History history, TripStream stream, TripAccess access) {
        this.history = history;
        this.stream = stream;
        this.access = access;
    }

    @GetMapping("/events")
    List<History.Entry> events(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId,
                               @RequestParam(required = false) Long before, @RequestParam(defaultValue = "50") int limit) {
        access.require(tripId, Auth.userId(jwt), TripRole.VIEWER);
        return history.page(tripId, before, Math.clamp(limit, 1, 100));
    }

    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    SseEmitter stream(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        access.require(tripId, Auth.userId(jwt), TripRole.VIEWER);
        return stream.subscribe(tripId);
    }
}
