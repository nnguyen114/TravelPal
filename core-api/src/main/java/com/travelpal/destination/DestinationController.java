package com.travelpal.destination;

import com.travelpal.common.Auth;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/trips/{tripId}")
public class DestinationController {
    public record DestinationRequest(@NotBlank @Size(max = 200) String name, @Size(max = 300) String address,
                                     @Min(-90) @Max(90) Double lat, @Min(-180) @Max(180) Double lng,
                                     @Size(max = 120) String providerId, @Size(max = 2000) String notes,
                                     @Min(5) @Max(1440) Integer durationMin, Integer dayIndex, LocalTime startTime,
                                     boolean locked, Flexibility flexibility, Long version) {
        DestinationService.Input input() {
            return new DestinationService.Input(name, address, lat, lng, providerId, notes, durationMin, dayIndex, startTime, locked, flexibility);
        }
    }
    public record ReorderRequest(@NotNull @Size(max = 200) List<UUID> ids) {}
    public record DestinationDto(UUID id, String name, String address, Double lat, Double lng, String providerId, String notes,
                                 Integer durationMin, Integer dayIndex, Integer position, LocalTime startTime, boolean locked,
                                 Flexibility flexibility, long version) {
        static DestinationDto of(Destination d) {
            return new DestinationDto(d.getId(), d.getName(), d.getAddress(), d.getLat(), d.getLng(), d.getProviderId(), d.getNotes(),
                d.getDurationMin(), d.getDayIndex(), d.getPosition(), d.getStartTime(), d.isLocked(), d.getFlexibility(), d.getVersion());
        }
    }

    private final DestinationService service;

    DestinationController(DestinationService service) {
        this.service = service;
    }

    @GetMapping("/destinations")
    List<DestinationDto> list(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        return service.list(Auth.userId(jwt), tripId).stream().map(DestinationDto::of).toList();
    }

    @PostMapping("/destinations")
    @ResponseStatus(HttpStatus.CREATED)
    DestinationDto add(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody DestinationRequest req) {
        return DestinationDto.of(service.add(Auth.userId(jwt), tripId, req.input()));
    }

    @PutMapping("/destinations/{id}")
    DestinationDto update(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id,
                          @Valid @RequestBody DestinationRequest req) {
        return DestinationDto.of(service.update(Auth.userId(jwt), tripId, id, req.version(), req.input()));
    }

    @DeleteMapping("/destinations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id) {
        service.delete(Auth.userId(jwt), tripId, id);
    }

    @PostMapping("/events/{eventId}/undo")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void undo(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable long eventId) {
        service.undo(Auth.userId(jwt), tripId, eventId);
    }

    @PutMapping("/days/{dayIndex}/order")
    List<DestinationDto> reorder(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable int dayIndex,
                                 @Valid @RequestBody ReorderRequest req) {
        return service.reorder(Auth.userId(jwt), tripId, dayIndex, req.ids()).stream().map(DestinationDto::of).toList();
    }
}
