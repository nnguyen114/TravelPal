package com.travelpal.trip;

import com.travelpal.common.Auth;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
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
@RequestMapping("/api/trips")
public class TripController {
    public record CityRequest(@NotBlank @Size(max = 120) String name, Double lat, Double lng,
                              LocalDate startDate, LocalDate endDate, boolean locked) {
        TripService.CityInput input() { return new TripService.CityInput(name, lat, lng, startDate, endDate, locked); }
    }
    public record CreateTripRequest(@NotBlank @Size(max = 120) String name, @NotNull @Valid CityRequest destination,
                                    @NotNull LocalDate startDate, @NotNull LocalDate endDate) {}
    public record RoleRequest(@NotNull TripRole role) {}
    public record UpdateTripRequest(@NotBlank @Size(max = 120) String name, @NotNull LocalDate startDate, @NotNull LocalDate endDate) {}

    public record CityDto(UUID id, String name, Double lat, Double lng, LocalDate startDate, LocalDate endDate, boolean locked) {
        static CityDto of(TripCity c) {
            return new CityDto(c.getId(), c.getName(), c.getLat(), c.getLng(), c.getStartDate(), c.getEndDate(), c.isLocked());
        }
    }
    public record TripSummaryDto(UUID id, String name, LocalDate startDate, LocalDate endDate, TripRole role, long memberCount, List<String> cities) {}
    public record TripDto(UUID id, String name, LocalDate startDate, LocalDate endDate, long version, int dayCount, TripRole role,
                          List<CityDto> cities, List<TripService.Member> members) {}

    private final TripService trips;

    TripController(TripService trips) {
        this.trips = trips;
    }

    @GetMapping
    List<TripSummaryDto> list(@AuthenticationPrincipal Jwt jwt) {
        return trips.list(Auth.userId(jwt)).stream()
            .map(s -> new TripSummaryDto(s.trip().getId(), s.trip().getName(), s.trip().getStartDate(), s.trip().getEndDate(),
                s.role(), s.memberCount(), s.cities()))
            .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    TripDto create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateTripRequest req) {
        UUID user = Auth.userId(jwt);
        Trip t = trips.create(user, req.name(), req.startDate(), req.endDate(), req.destination().input());
        return get(jwt, t.getId());
    }

    @GetMapping("/{tripId}")
    TripDto get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        TripService.Detail d = trips.get(Auth.userId(jwt), tripId);
        Trip t = d.trip();
        return new TripDto(t.getId(), t.getName(), t.getStartDate(), t.getEndDate(), t.getVersion(), t.dayCount(), d.role(),
            d.cities().stream().map(CityDto::of).toList(), d.members());
    }

    @PutMapping("/{tripId}")
    TripDto update(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody UpdateTripRequest req) {
        trips.update(Auth.userId(jwt), tripId, req.name(), req.startDate(), req.endDate());
        return get(jwt, tripId);
    }

    @DeleteMapping("/{tripId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        trips.delete(Auth.userId(jwt), tripId);
    }

    @PutMapping("/{tripId}/members/{memberId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void changeRole(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID memberId,
                    @Valid @RequestBody RoleRequest req) {
        trips.changeRole(Auth.userId(jwt), tripId, memberId, req.role());
    }

    @DeleteMapping("/{tripId}/members/{memberId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeMember(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID memberId) {
        trips.removeMember(Auth.userId(jwt), tripId, memberId);
    }

    @PostMapping("/{tripId}/cities")
    @ResponseStatus(HttpStatus.CREATED)
    CityDto addCity(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @Valid @RequestBody CityRequest req) {
        return CityDto.of(trips.addCity(Auth.userId(jwt), tripId, req.input()));
    }

    @PutMapping("/{tripId}/cities/{cityId}")
    CityDto updateCity(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID cityId,
                       @Valid @RequestBody CityRequest req) {
        return CityDto.of(trips.updateCity(Auth.userId(jwt), tripId, cityId, req.input()));
    }

    @DeleteMapping("/{tripId}/cities/{cityId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteCity(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId, @PathVariable UUID cityId) {
        trips.deleteCity(Auth.userId(jwt), tripId, cityId);
    }
}
