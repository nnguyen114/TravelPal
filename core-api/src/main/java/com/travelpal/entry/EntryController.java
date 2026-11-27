package com.travelpal.entry;

import com.travelpal.common.Auth;
import com.travelpal.destination.DestinationController.DestinationDto;
import com.travelpal.destination.DestinationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/trips/{tripId}/entries")
public class EntryController {
    public record EntryRequest(@NotNull Long version, @NotBlank @Size(max = 200) String title, Integer dayIndex, LocalTime startTime) {}
    public record ChooseRequest(@NotNull @Min(0) Integer option) {}
    public record EntryDto(UUID id, Integer dayIndex, int position, ItineraryEntry.Kind kind, String title, LocalTime startTime,
                           JsonNode details, String source, long version) {}

    private final EntryService entries;
    private final DestinationService destinations;

    EntryController(EntryService entries, DestinationService destinations) {
        this.entries = entries;
        this.destinations = destinations;
    }

    @GetMapping
    List<EntryDto> list(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        return entries.list(Auth.userId(jwt), tripId).stream().map(this::dto).toList();
    }

    @PutMapping("/{id}")
    EntryDto update(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id, @Valid @RequestBody EntryRequest req) {
        return dto(entries.update(Auth.userId(jwt), tripId, id, req.version(), req.title(), req.dayIndex(), req.startTime()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id,
                @RequestParam(required = false) Long version) {
        entries.delete(Auth.userId(jwt), tripId, id, version);
    }

    /** Resolves a choice: the picked option becomes a place on the choice's day, and the choice goes away. */
    @PostMapping("/{id}/choose")
    DestinationDto choose(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id,
                          @Valid @RequestBody ChooseRequest req) {
        return DestinationDto.of(destinations.choose(Auth.userId(jwt), tripId, id, req.option()));
    }

    private EntryDto dto(ItineraryEntry e) {
        return new EntryDto(e.getId(), e.getDayIndex(), e.getPosition(), e.getKind(), e.getTitle(), e.getStartTime(),
            entries.detailsOf(e), e.getSource(), e.getVersion());
    }
}
