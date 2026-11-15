package com.travelpal.proposal;

import com.travelpal.assistant.AiServiceClient;
import com.travelpal.destination.Destination;
import com.travelpal.destination.DestinationService;
import com.travelpal.history.History;
import com.travelpal.optimize.AiQuota;
import com.travelpal.optimize.TripSnapshot;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Proposals are optional: anyone in the trip can suggest a set of changes, everyone can discuss, and an editor
 * merges or closes them. Merging applies the changes as ordinary edits (so they're in Activity and undoable).
 */
@Service
public class ProposalService {
    public enum Kind { ADD, MOVE, REMOVE }

    /** One change. MOVE/REMOVE remember the place's version so a stale proposal can't overwrite newer edits. */
    /** Field limits match a direct add, so a merged proposal can't store what Add Destination would reject. */
    public record Change(Kind kind, UUID destinationId, Long destinationVersion, @Size(max = 200) String name,
                         @Size(max = 300) String address, @Min(-90) @Max(90) Double lat, @Min(-180) @Max(180) Double lng,
                         @Size(max = 300) String providerId, Integer dayIndex, LocalTime startTime,
                         @Min(5) @Max(1440) Integer durationMin) {}

    public record View(Proposal proposal, List<Change> changes, List<ProposalComment> comments, long commentCount, boolean stale,
                       Map<UUID, Destination> places, Map<UUID, String> names) {}

    static final int MAX_CHANGES = 20;
    // Cursor start: after every real row (Postgres can't store Instant.MAX).
    private static final Instant NEWEST = Instant.parse("9999-12-31T00:00:00Z");
    private static final UUID MAX_ID = new UUID(-1L, -1L);
    private static final TypeReference<List<Change>> CHANGES = new TypeReference<>() {};

    private final ProposalRepository proposals;
    private final ProposalCommentRepository comments;
    private final TripAccess access;
    private final TripService trips;
    private final DestinationService destinations;
    private final TripSnapshot snapshots;
    private final AiServiceClient ai;
    private final AiQuota quota;
    private final ApplicationEventPublisher events;
    private final JsonMapper json;
    private final TransactionTemplate tx;

    ProposalService(ProposalRepository proposals, ProposalCommentRepository comments, TripAccess access, TripService trips,
                    DestinationService destinations, TripSnapshot snapshots, AiServiceClient ai, AiQuota quota,
                    ApplicationEventPublisher events, JsonMapper json, TransactionTemplate tx) {
        this.proposals = proposals;
        this.comments = comments;
        this.access = access;
        this.trips = trips;
        this.destinations = destinations;
        this.snapshots = snapshots;
        this.ai = ai;
        this.quota = quota;
        this.events = events;
        this.json = json;
        this.tx = tx;
    }

    /** Viewers may propose too: proposing changes nothing until an editor merges. */
    @Transactional
    public View create(UUID userId, UUID tripId, String title, String description, List<Change> requested) {
        access.require(tripId, userId, TripRole.VIEWER);
        if (requested == null || requested.isEmpty() || requested.size() > MAX_CHANGES) {
            throw bad("A proposal needs 1 to " + MAX_CHANGES + " changes");
        }
        Map<UUID, Destination> places = places(userId, tripId);
        int days = trips.dayCount(tripId);
        List<Change> changes = new ArrayList<>();
        for (Change c : requested) {
            if (c.kind() == null) {
                throw bad("Each change needs a kind");
            }
            if (c.dayIndex() != null && (c.dayIndex() < 0 || c.dayIndex() >= days)) {
                throw bad("Day is outside the trip");
            }
            if (c.kind() == Kind.ADD) {
                if (c.name() == null || c.name().isBlank() || c.name().length() > 200) {
                    throw bad("A new place needs a name");
                }
                changes.add(new Change(Kind.ADD, null, null, c.name().trim(), c.address(), c.lat(), c.lng(), c.providerId(),
                    c.dayIndex(), c.startTime(), c.durationMin()));
            } else {
                Destination d = places.get(c.destinationId());
                if (d == null) {
                    throw bad("That place isn't in the trip");
                }
                changes.add(new Change(c.kind(), d.getId(), d.getVersion(), null, null, null, null, null,
                    c.kind() == Kind.MOVE ? c.dayIndex() : null, c.kind() == Kind.MOVE ? c.startTime() : null, null));
            }
        }
        Proposal p = proposals.save(new Proposal(tripId, userId, title, description, json.writeValueAsString(changes)));
        events.publishEvent(new History.Changed(tripId, userId));
        return view(p, places, tripId, userId, true);
    }

    @Transactional(readOnly = true)
    public List<View> list(UUID userId, UUID tripId, Proposal.Status status, Instant before, UUID beforeId, int limit) {
        access.require(tripId, userId, TripRole.VIEWER);
        List<Proposal> all = before == null
            ? proposals.page(tripId, status, NEWEST, MAX_ID, Limit.of(limit))
            : proposals.page(tripId, status, before, beforeId == null ? MAX_ID : beforeId, Limit.of(limit));
        Map<UUID, Long> counts = all.isEmpty() ? Map.of() : comments.countByProposal(all.stream().map(Proposal::getId).toList())
            .stream().collect(Collectors.toMap(r -> (UUID) r[0], r -> (Long) r[1]));
        Map<UUID, Destination> places = places(userId, tripId);
        Map<UUID, String> names = names(userId, tripId);
        return all.stream().map(p -> {
            List<Change> changes = changes(p);
            return new View(p, changes, null, counts.getOrDefault(p.getId(), 0L), stale(p, changes, places), places, names);
        }).toList();
    }

    /** How many proposals the trip has in each status, for the tab badge and filter counts. */
    @Transactional(readOnly = true)
    public Map<Proposal.Status, Long> counts(UUID userId, UUID tripId) {
        access.require(tripId, userId, TripRole.VIEWER);
        Map<Proposal.Status, Long> out = new EnumMap<>(Proposal.Status.class);
        for (Proposal.Status s : Proposal.Status.values()) out.put(s, 0L);
        for (Object[] r : proposals.countByStatus(tripId)) out.put((Proposal.Status) r[0], (Long) r[1]);
        return out;
    }

    @Transactional(readOnly = true)
    public View get(UUID userId, UUID tripId, UUID id) {
        access.require(tripId, userId, TripRole.VIEWER);
        return view(find(tripId, id), places(userId, tripId), tripId, userId, true);
    }

    @Transactional
    public View comment(UUID userId, UUID tripId, UUID id, String body) {
        access.require(tripId, userId, TripRole.VIEWER);
        Proposal p = find(tripId, id);
        comments.save(new ProposalComment(p.getId(), userId, body));
        events.publishEvent(new History.Changed(tripId, userId));
        return view(p, places(userId, tripId), tripId, userId, true);
    }

    /** Applies every change in one transaction; refuses if a place it touches changed since it was proposed. */
    @Transactional
    public View merge(UUID userId, UUID tripId, UUID id) {
        access.require(tripId, userId, TripRole.EDITOR);
        Proposal p = open(tripId, id);
        List<Change> changes = changes(p);
        if (stale(p, changes, places(userId, tripId))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A place in this proposal changed since it was made. Close it and propose again.");
        }
        for (Change c : changes) {
            switch (c.kind()) {
                case ADD -> destinations.add(userId, tripId, new DestinationService.Input(c.name(), c.address(), c.lat(), c.lng(),
                    c.providerId(), null, c.durationMin(), c.dayIndex(), c.startTime(), false, null, null, null, false));
                case MOVE -> destinations.move(userId, tripId, c.destinationId(), c.destinationVersion(), c.dayIndex(), c.startTime());
                case REMOVE -> destinations.delete(userId, tripId, c.destinationId());
            }
        }
        p.settle(Proposal.Status.MERGED, userId);
        return view(p, places(userId, tripId), tripId, userId, true);
    }

    /** Editors can close any proposal; authors can close their own. */
    @Transactional
    public View close(UUID userId, UUID tripId, UUID id) {
        access.require(tripId, userId, TripRole.VIEWER);
        Proposal p = open(tripId, id);
        access.require(tripId, userId, userId.equals(p.getAuthorId()) ? TripRole.VIEWER : TripRole.EDITOR);
        p.settle(Proposal.Status.CLOSED, userId);
        events.publishEvent(new History.Changed(tripId, userId));
        return view(p, places(userId, tripId), tripId, userId, true);
    }

    /** Asks ai-service whether the changes fit. No DB transaction is held during the AI call. */
    public View impact(UUID userId, UUID tripId, UUID id) throws InterruptedException {
        Proposal p = Objects.requireNonNull(tx.execute(s -> {
            access.require(tripId, userId, TripRole.VIEWER);
            return find(tripId, id);
        }));
        quota.spend(userId, AiQuota.Kind.OPTIMIZE);
        String body = json.writeValueAsString(Map.of("trip", snapshots.build(userId, tripId).data(), "changes", changes(p)));
        String result = ai.call("/internal/impact", body, userId, Duration.ofSeconds(90), "The impact check");
        return tx.execute(s -> {
            Proposal fresh = find(tripId, id);
            fresh.impact(result, userId);
            proposals.save(fresh);
            events.publishEvent(new History.Changed(tripId, userId));
            return view(fresh, places(userId, tripId), tripId, userId, true);
        });
    }

    private View view(Proposal p, Map<UUID, Destination> places, UUID tripId, UUID userId, boolean withComments) {
        List<Change> changes = changes(p);
        List<ProposalComment> cs = withComments ? comments.findByProposalIdOrderByCreatedAt(p.getId()) : null;
        return new View(p, changes, cs, cs == null ? 0 : cs.size(), stale(p, changes, places), places, names(userId, tripId));
    }

    private static boolean stale(Proposal p, List<Change> changes, Map<UUID, Destination> places) {
        return p.getStatus() == Proposal.Status.OPEN && changes.stream().filter(c -> c.kind() != Kind.ADD)
            .anyMatch(c -> !places.containsKey(c.destinationId()) || places.get(c.destinationId()).getVersion() != c.destinationVersion());
    }

    private List<Change> changes(Proposal p) {
        return json.readValue(p.getChanges(), CHANGES);
    }

    private Map<UUID, Destination> places(UUID userId, UUID tripId) {
        return destinations.list(userId, tripId).stream().collect(Collectors.toMap(Destination::getId, Function.identity()));
    }

    private Map<UUID, String> names(UUID userId, UUID tripId) {
        return trips.get(userId, tripId).members().stream().collect(Collectors.toMap(TripService.Member::userId, TripService.Member::displayName));
    }

    private Proposal open(UUID tripId, UUID id) {
        Proposal p = find(tripId, id);
        if (p.getStatus() != Proposal.Status.OPEN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This proposal is already " + p.getStatus().name().toLowerCase());
        }
        return p;
    }

    private Proposal find(UUID tripId, UUID id) {
        return proposals.findByIdAndTripId(id, tripId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proposal not found"));
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
