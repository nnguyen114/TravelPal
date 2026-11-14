package com.travelpal.invite;

import com.travelpal.common.Auth;
import com.travelpal.common.Tokens;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Shareable trip links. Any editor can create one; holders join as editors. Only owners can revoke
 * (which kills every link for the trip). Tokens are stored hashed, so a link is shown once, at creation.
 */
@RestController
public class InviteController {
    static final Duration TTL = Duration.ofDays(30);

    public record Invite(String token, Instant expiresAt) {}
    public record Preview(UUID tripId, String name, LocalDate startDate, LocalDate endDate, List<String> cities,
                          long memberCount, boolean member) {}
    public record Joined(UUID tripId) {}

    private final InviteLinkRepository links;
    private final TripAccess access;
    private final TripService trips;

    InviteController(InviteLinkRepository links, TripAccess access, TripService trips) {
        this.links = links;
        this.access = access;
        this.trips = trips;
    }

    @PostMapping("/api/trips/{tripId}/invites")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Invite create(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        access.require(tripId, Auth.userId(jwt), TripRole.EDITOR);
        String token = Tokens.random();
        InviteLink link = links.save(new InviteLink(tripId, Tokens.sha256(token), Auth.userId(jwt), Instant.now().plus(TTL)));
        return new Invite(token, link.getExpiresAt());
    }

    @DeleteMapping("/api/trips/{tripId}/invites")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void revokeAll(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID tripId) {
        access.require(tripId, Auth.userId(jwt), TripRole.OWNER);
        links.revokeAll(tripId);
    }

    @GetMapping("/api/invites/{token}")
    @Transactional(readOnly = true)
    public Preview preview(@AuthenticationPrincipal Jwt jwt, @PathVariable String token) {
        UUID tripId = usable(token).getTripId();
        UUID me = Auth.userId(jwt);
        // Read as the system, not the user: they aren't a member yet. Only this summary is exposed.
        var summary = trips.summaryForInvite(tripId, me);
        return new Preview(tripId, summary.trip().getName(), summary.trip().getStartDate(), summary.trip().getEndDate(),
            summary.cities(), summary.memberCount(), summary.role() != null);
    }

    @PostMapping("/api/invites/{token}/join")
    @Transactional
    public Joined join(@AuthenticationPrincipal Jwt jwt, @PathVariable String token) {
        UUID tripId = usable(token).getTripId();
        trips.join(tripId, Auth.userId(jwt), TripRole.EDITOR);
        return new Joined(tripId);
    }

    private InviteLink usable(String token) {
        return links.findByTokenHash(Tokens.sha256(token)).filter(InviteLink::usable)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This invite link is invalid or has been turned off"));
    }
}
