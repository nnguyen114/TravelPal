package com.travelpal.importer;

import com.travelpal.common.Auth;
import com.travelpal.entry.ItineraryEntry;
import com.travelpal.trip.TripController.CityRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping("/api/imports")
public class ImportController {
    public record NewTrip(@NotBlank @Size(max = 120) String name, @NotNull LocalDate startDate, @NotNull LocalDate endDate,
                          @NotEmpty @Size(max = 20) List<@Valid CityRequest> cities) {}
    /** {@code date} null = an idea (no day). */
    public record PlaceRow(LocalDate date, @Min(0) int position, @NotBlank @Size(max = 200) String name, @Size(max = 300) String address,
                           @Min(-90) @Max(90) Double lat, @Min(-180) @Max(180) Double lng, @Size(max = 300) String providerId,
                           LocalTime startTime, boolean locked, @Size(max = 2000) String notes, boolean dayTrip) {}
    public record EntryRow(LocalDate date, @Min(0) int position, @NotNull ItineraryEntry.Kind kind, @NotBlank @Size(max = 200) String title,
                           LocalTime startTime, JsonNode details, @Size(max = 1000) String source) {}
    public record ApplyRequest(@NotNull UUID importId, UUID tripId, @Valid NewTrip newTrip, LocalDate extendEndTo,
                               @NotNull @Size(max = 300) List<@Valid PlaceRow> places, @NotNull @Size(max = 300) List<@Valid EntryRow> entries) {}

    private static final Logger log = LoggerFactory.getLogger(ImportController.class);
    /** Under the edge's 60 s origin read timeout (infra/terraform/edge.tf), so a long read keeps its connection. */
    static final Duration HEARTBEAT = Duration.ofSeconds(15);

    private final ImportService imports;
    private final JsonMapper json;

    ImportController(ImportService imports, JsonMapper json) {
        this.imports = imports;
        this.json = json;
    }

    /**
     * Reads a pasted plan or a PDF into a draft to review. Nothing is stored. Bad input is a plain 4xx; then the
     * answer streams: a status right away and every {@link #HEARTBEAT} while the AI reads (often over a minute for a
     * long PDF), then {@code draft} with the draft, or {@code error} with {@code {status, message}}.
     */
    @PostMapping(path = "/read", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<ResponseBodyEmitter> read(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String text,
                                             @RequestParam(required = false) MultipartFile file, @RequestParam(required = false) UUID tripId)
            throws IOException {
        UUID user = Auth.userId(jwt);
        String prepared = imports.prepare(user, text, file, tripId);
        ResponseBodyEmitter out = new ResponseBodyEmitter(Duration.ofMinutes(4).toMillis());
        Thread.startVirtualThread(() -> {
            CompletableFuture<String> draft = new CompletableFuture<>();
            Thread.startVirtualThread(() -> {
                try {
                    draft.complete(imports.extract(user, prepared));
                } catch (Exception e) {
                    draft.completeExceptionally(e);
                }
            });
            try {
                event(out, "status", "{\"text\":\"Reading your plan…\"}");
                for (;;) {
                    try {
                        event(out, "draft", draft.get(HEARTBEAT.toSeconds(), TimeUnit.SECONDS));
                        break;
                    } catch (TimeoutException still) {
                        event(out, "status", "{\"text\":\"Still reading your plan…\"}");
                    }
                }
            } catch (ExecutionException e) {
                int status = e.getCause() instanceof ResponseStatusException r ? r.getStatusCode().value() : 500;
                String message = e.getCause() instanceof ResponseStatusException r && r.getReason() != null
                    ? r.getReason() : "Reading your plan failed. Try again.";
                if (status == 500) {
                    log.warn("import read failed", e.getCause());
                }
                send(out, "error", json.writeValueAsString(Map.of("status", status, "message", message)));
            } catch (IOException | InterruptedException gone) {
                draft.cancel(true); // the browser left
            }
            out.complete();
        });
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).body(out);
    }

    private static void event(ResponseBodyEmitter out, String name, String data) throws IOException {
        out.send("event: " + name + "\ndata: " + data + "\n\n", MediaType.TEXT_EVENT_STREAM);
    }

    private static void send(ResponseBodyEmitter out, String name, String data) {
        try {
            event(out, name, data);
        } catch (IOException gone) {
            // the browser left; nothing to tell it
        }
    }

    /** Applies a reviewed draft in one step, to a new trip or an existing one. Repeating an importId changes nothing. */
    @PostMapping("/apply")
    ImportService.Result apply(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ApplyRequest req) {
        return imports.apply(Auth.userId(jwt), req);
    }
}
