package com.travelpal.proposal;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.travelpal.common.Auth;
import com.travelpal.destination.Destination;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.TreeSet;
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
@RequestMapping("/api/trips/{tripId}/proposals")
public class ProposalController {
    public record CreateRequest(@NotBlank @Size(max = 140) String title, @Size(max = 4000) String description,
                                @NotNull @Size(min = 1, max = ProposalService.MAX_CHANGES) List<ProposalService.Change> changes) {}
    public record CommentRequest(@NotBlank @Size(max = 2000) String body) {}

    public record ChangeDto(ProposalService.Kind kind, UUID destinationId, String name, Integer fromDay, Integer dayIndex, LocalTime startTime) {}
    public record CommentDto(UUID id, UUID authorId, String authorName, String body, Instant createdAt) {}
    public record ProposalDto(UUID id, String title, String description, String status, UUID authorId, String authorName,
                              Instant createdAt, Instant closedAt, List<ChangeDto> changes, List<Integer> affectedDays,
                              long commentCount, boolean stale, @JsonRawValue String impact, String impactByName,
                              List<CommentDto> comments) {}

    private final ProposalService service;

    ProposalController(ProposalService service) {
        this.service = service;
    }

    @GetMapping
    List<ProposalDto> list(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        return service.list(Auth.userId(jwt), tripId).stream().map(ProposalController::dto).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ProposalDto create(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody CreateRequest req) {
        return dto(service.create(Auth.userId(jwt), tripId, req.title(), req.description(), req.changes()));
    }

    @GetMapping("/{id}")
    ProposalDto get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id) {
        return dto(service.get(Auth.userId(jwt), tripId, id));
    }

    @PostMapping("/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    ProposalDto comment(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id,
                        @Valid @RequestBody CommentRequest req) {
        return dto(service.comment(Auth.userId(jwt), tripId, id, req.body()));
    }

    @PostMapping("/{id}/merge")
    ProposalDto merge(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id) {
        return dto(service.merge(Auth.userId(jwt), tripId, id));
    }

    @PostMapping("/{id}/close")
    ProposalDto close(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id) {
        return dto(service.close(Auth.userId(jwt), tripId, id));
    }

    @PostMapping("/{id}/impact")
    ProposalDto impact(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID id) throws InterruptedException {
        return dto(service.impact(Auth.userId(jwt), tripId, id));
    }

    static ProposalDto dto(ProposalService.View v) {
        Proposal p = v.proposal();
        TreeSet<Integer> days = new TreeSet<>();
        List<ChangeDto> changes = v.changes().stream().map(c -> {
            Destination d = c.destinationId() == null ? null : v.places().get(c.destinationId());
            Integer from = d == null ? null : d.getDayIndex();
            if (c.dayIndex() != null) {
                days.add(c.dayIndex());
            }
            if (from != null) {
                days.add(from);
            }
            String name = c.kind() == ProposalService.Kind.ADD ? c.name() : d == null ? "A place that was removed" : d.getName();
            return new ChangeDto(c.kind(), c.destinationId(), name, from, c.dayIndex(), c.startTime());
        }).toList();
        List<CommentDto> comments = v.comments() == null ? null : v.comments().stream()
            .map(c -> new CommentDto(c.getId(), c.getAuthorId(), v.names().getOrDefault(c.getAuthorId(), "Former member"), c.getBody(), c.getCreatedAt()))
            .toList();
        return new ProposalDto(p.getId(), p.getTitle(), p.getDescription(), p.getStatus().name(), p.getAuthorId(),
            v.names().getOrDefault(p.getAuthorId(), "Former member"), p.getCreatedAt(), p.getClosedAt(), changes, List.copyOf(days),
            v.commentCount(), v.stale(), p.getImpact(), p.getImpactBy() == null ? null : v.names().getOrDefault(p.getImpactBy(), "Former member"),
            comments);
    }
}
