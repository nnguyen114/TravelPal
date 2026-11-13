package com.travelpal.assistant;

import com.travelpal.common.Auth;
import com.travelpal.optimize.AiProperties;
import com.travelpal.optimize.AiQuota;
import com.travelpal.optimize.TripSnapshot;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import tools.jackson.databind.json.JsonMapper;

/**
 * The browser never talks to ai-service: this checks access, attaches the trip context, and relays the
 * assistant's event stream byte-for-byte.
 */
@RestController
public class AssistantController {
    public record ChatMessage(@NotNull @Pattern(regexp = "user|assistant") String role, @NotNull @Size(max = 20_000) String content) {}
    public record ChatRequest(@NotNull @Size(min = 1, max = 40) List<@Valid ChatMessage> messages) {}

    private static final Logger log = LoggerFactory.getLogger(AssistantController.class);
    private final TripAccess access;
    private final TripSnapshot snapshots;
    private final AiQuota quota;
    private final InternalTokens tokens;
    private final AiProperties props;
    private final JsonMapper json;
    // HTTP/1.1: the default h2c upgrade attempt on plain HTTP is rejected by uvicorn.
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();

    AssistantController(TripAccess access, TripSnapshot snapshots, AiQuota quota, InternalTokens tokens, AiProperties props, JsonMapper json) {
        this.access = access;
        this.snapshots = snapshots;
        this.quota = quota;
        this.tokens = tokens;
        this.props = props;
        this.json = json;
    }

    @PostMapping(path = "/api/trips/{tripId}/assistant", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<StreamingResponseBody> chat(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId,
                                               @Valid @RequestBody ChatRequest req) throws InterruptedException {
        UUID user = Auth.userId(jwt);
        access.require(tripId, user, TripRole.VIEWER);
        quota.spend(user, AiQuota.Kind.ASSISTANT);
        String body = json.writeValueAsString(Map.of("trip", snapshots.build(user, tripId).data(), "messages", req.messages()));
        HttpResponse<InputStream> upstream;
        try {
            upstream = http.send(HttpRequest.newBuilder(URI.create(props.serviceUrl() + "/internal/chat"))
                .header("Authorization", "Bearer " + tokens.issue(user)).header("Content-Type", "application/json")
                .timeout(Duration.ofMinutes(5)).POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            log.warn("ai-service unreachable", e);
            throw unavailable();
        }
        if (upstream.statusCode() != 200) {
            log.warn("ai-service answered {}", upstream.statusCode());
            try (InputStream ignored = upstream.body()) { // release the connection
            } catch (IOException ignored) { // nothing to recover
            }
            throw unavailable();
        }
        StreamingResponseBody relay = out -> {
            try (InputStream in = upstream.body()) {
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) != -1; ) {
                    out.write(buf, 0, n);
                    out.flush();
                }
            }
        };
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).header("X-Accel-Buffering", "no").body(relay);
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "The assistant is unavailable right now.");
    }
}
