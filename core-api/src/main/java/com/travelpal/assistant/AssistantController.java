package com.travelpal.assistant;

import com.travelpal.common.Auth;
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
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import tools.jackson.databind.json.JsonMapper;

/**
 * The browser never talks to ai-service: this checks access, attaches the trip context, and relays the
 * assistant's event stream byte-for-byte.
 */
@RestController
public class AssistantController {
    public record ChatMessage(@NotNull @Pattern(regexp = "user|assistant") String role, @NotNull @Size(max = 20_000) String content) {}
    public record ChatRequest(@NotNull @Size(min = 1, max = 40) List<@Valid ChatMessage> messages) {}
    /** Long enough for a few search-and-pick rounds; Spring's default (30 s) cut multi-city plans off. */
    static final Duration RELAY_TIMEOUT = Duration.ofMinutes(3);

    private final TripAccess access;
    private final TripSnapshot snapshots;
    private final AiQuota quota;
    private final AiServiceClient ai;
    private final JsonMapper json;

    AssistantController(TripAccess access, TripSnapshot snapshots, AiQuota quota, AiServiceClient ai, JsonMapper json) {
        this.access = access;
        this.snapshots = snapshots;
        this.quota = quota;
        this.ai = ai;
        this.json = json;
    }

    @PostMapping(path = "/api/trips/{tripId}/assistant", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<ResponseBodyEmitter> chat(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId,
                                               @Valid @RequestBody ChatRequest req) throws InterruptedException {
        UUID user = Auth.userId(jwt);
        boolean canEdit = access.require(tripId, user, TripRole.VIEWER).atLeast(TripRole.EDITOR);
        quota.spend(user, AiQuota.Kind.ASSISTANT);
        String body = json.writeValueAsString(Map.of("trip", snapshots.build(user, tripId).data(), "messages", req.messages(), "canEdit", canEdit));
        InputStream upstream = ai.post("/internal/chat", body, user, Duration.ofMinutes(5), "The assistant");
        // Each chunk is sent (and flushed) as it arrives, so "Thinking…" and search progress show up live. A
        // StreamingResponseBody here held the whole reply until it finished.
        ResponseBodyEmitter relay = new ResponseBodyEmitter(RELAY_TIMEOUT.toMillis());
        Thread.startVirtualThread(() -> {
            try (InputStream in = upstream) {
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) != -1; ) {
                    relay.send(Arrays.copyOf(buf, n), MediaType.TEXT_EVENT_STREAM);
                }
                relay.complete();
            } catch (IOException | RuntimeException e) {
                relay.completeWithError(e); // the browser sees the stream end; it shows "try again"
            }
        });
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).header("X-Accel-Buffering", "no").body(relay);
    }
}
