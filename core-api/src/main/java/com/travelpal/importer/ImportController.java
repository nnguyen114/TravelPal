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
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;

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

    private final ImportService imports;

    ImportController(ImportService imports) {
        this.imports = imports;
    }

    /** Reads a pasted plan or a PDF into a draft to review. Nothing is stored. */
    @PostMapping(path = "/read", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    String read(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String text,
                @RequestParam(required = false) MultipartFile file, @RequestParam(required = false) UUID tripId) throws Exception {
        return imports.read(Auth.userId(jwt), text, file, tripId);
    }

    /** Applies a reviewed draft in one step, to a new trip or an existing one. Repeating an importId changes nothing. */
    @PostMapping("/apply")
    ImportService.Result apply(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ApplyRequest req) {
        return imports.apply(Auth.userId(jwt), req);
    }
}
