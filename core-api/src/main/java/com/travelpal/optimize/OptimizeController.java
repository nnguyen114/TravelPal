package com.travelpal.optimize;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.travelpal.common.Auth;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/trips/{tripId}")
public class OptimizeController {
    public record OptimizeRequest(@NotNull OptimizeService.Mode mode, @NotNull OptimizeService.Scope scope, Integer dayIndex,
                                  @Size(max = 200) List<UUID> destinationIds, @Size(max = 2000) String instructions) {}
    public record PreviewDto(UUID id, String status, boolean stale, @JsonRawValue String request, @JsonRawValue String result,
                             String error, Instant createdAt) {}

    private final OptimizeService service;

    OptimizeController(OptimizeService service) {
        this.service = service;
    }

    @PostMapping("/optimize")
    @ResponseStatus(HttpStatus.ACCEPTED)
    PreviewDto optimize(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody OptimizeRequest req) {
        OptimizationPreview p = service.request(Auth.userId(jwt), tripId,
            new OptimizeService.Request(req.mode(), req.scope(), req.dayIndex(), req.destinationIds(), req.instructions()));
        return dto(p);
    }

    @GetMapping("/previews/{previewId}")
    PreviewDto get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID previewId) {
        return dto(service.get(Auth.userId(jwt), tripId, previewId));
    }

    @PostMapping("/previews/{previewId}/apply")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void apply(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID previewId) {
        service.apply(Auth.userId(jwt), tripId, previewId);
    }

    @PostMapping("/previews/{previewId}/discard")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void discard(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID previewId) {
        service.discard(Auth.userId(jwt), tripId, previewId);
    }

    private PreviewDto dto(OptimizationPreview p) {
        return new PreviewDto(p.getId(), p.getStatus().name(), service.stale(p), service.params(p), p.getResult(), p.getError(), p.getCreatedAt());
    }
}
