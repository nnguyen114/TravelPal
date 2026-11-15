package com.travelpal.optimize;

import com.travelpal.destination.DestinationService;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.time.LocalTime;
import java.util.LinkedHashMap;

/**
 * Optimization is preview-first: a request becomes a PENDING preview and a queued job; the result is stored for
 * review; nothing in the itinerary changes until someone applies it, and only if the trip hasn't changed since.
 */
@Service
public class OptimizeService {
    public enum Mode { RELAXED, BALANCED, PACKED }
    public enum Scope { TRIP, DAY, SELECTION }
    public record Request(Mode mode, Scope scope, Integer dayIndex, List<UUID> destinationIds, String instructions) {}
    record JobRequested(UUID previewId, String body) {}

    private static final Logger log = LoggerFactory.getLogger(OptimizeService.class);

    private final OptimizationPreviewRepository previews;
    private final TripAccess access;
    private final TripService trips;
    private final TripSnapshot snapshots;
    private final DestinationService destinations;
    private final OptimizeQueue queue;
    private final AiQuota quota;
    private final ApplicationEventPublisher events;
    private final JsonMapper json;

    OptimizeService(OptimizationPreviewRepository previews, TripAccess access, TripService trips, TripSnapshot snapshots,
                    DestinationService destinations, OptimizeQueue queue, AiQuota quota, ApplicationEventPublisher events, JsonMapper json) {
        this.previews = previews;
        this.access = access;
        this.trips = trips;
        this.snapshots = snapshots;
        this.destinations = destinations;
        this.queue = queue;
        this.quota = quota;
        this.events = events;
        this.json = json;
    }

    @Transactional
    public OptimizationPreview request(UUID userId, UUID tripId, Request req) {
        access.require(tripId, userId, TripRole.EDITOR);
        TripSnapshot.Snapshot snap = snapshots.build(userId, tripId);
        int days = trips.dayCount(tripId);
        if (req.scope() == Scope.DAY && (req.dayIndex() == null || req.dayIndex() < 0 || req.dayIndex() >= days)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Pick a day inside the trip");
        }
        if (req.scope() == Scope.SELECTION && (req.destinationIds() == null || req.destinationIds().isEmpty())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one place");
        }
        quota.spend(userId, AiQuota.Kind.OPTIMIZE);
        UUID id = UUID.randomUUID();
        Map<String, Object> job = new HashMap<>(snap.data());
        job.put("previewId", id.toString());
        job.put("mode", req.mode().name());
        job.put("scope", req.scope().name());
        job.put("dayIndex", req.dayIndex());
        job.put("destinationIds", req.destinationIds() == null ? List.of() : req.destinationIds().stream().map(UUID::toString).toList());
        job.put("instructions", req.instructions());
        String body = json.writeValueAsString(job);
        OptimizationPreview p = previews.save(new OptimizationPreview(id, tripId, userId, snap.version(), body));
        events.publishEvent(new JobRequested(id, body));
        return p;
    }

    /** Sent only after the preview row commits, so a fast worker can never answer an unknown preview. */
    @TransactionalEventListener
    void dispatch(JobRequested e) {
        try {
            queue.send(e.body());
        } catch (RuntimeException ex) {
            log.error("Could not queue optimize job {}", e.previewId(), ex);
            fail(e.previewId(), "Couldn't start the optimizer. Try again.");
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void fail(UUID previewId, String error) {
        previews.findById(previewId).ifPresent(p -> p.complete(OptimizationPreview.Status.FAILED, null, error));
    }

    /** Results are idempotent: duplicates or late answers for settled previews are ignored. */
    @EventListener
    @Transactional
    public void onResult(OptimizeQueue.ResultReceived msg) {
        JsonNode node = json.readTree(msg.body());
        UUID id = UUID.fromString(node.path("previewId").asString());
        previews.findById(id).filter(p -> p.getStatus() == OptimizationPreview.Status.PENDING).ifPresent(p -> {
            if ("READY".equals(node.path("status").asString())) {
                p.complete(OptimizationPreview.Status.READY, json.writeValueAsString(node.path("result")), null);
                destinations.suggestHints(p.getTripId(), node.path("result").path("hints").valueStream().map(h -> new DestinationService.Hint(
                    UUID.fromString(h.path("id").asString()), time(h.path("visitAfter")), time(h.path("visitBefore")),
                    h.path("dayTrip").asBoolean())).toList());
            } else {
                p.complete(OptimizationPreview.Status.FAILED, null, node.path("error").asString("The optimizer failed."));
            }
        });
    }

    private static LocalTime time(JsonNode n) {
        return n.isNull() || n.isMissingNode() ? null : LocalTime.parse(n.asString());
    }

    @Transactional(readOnly = true)
    public OptimizationPreview get(UUID userId, UUID tripId, UUID previewId) {
        access.require(tripId, userId, TripRole.VIEWER);
        return find(tripId, previewId);
    }

    /** The knobs the preview was made with (mode, scope, day, places, instructions), without the trip snapshot. */
    public String params(OptimizationPreview p) {
        JsonNode r = json.readTree(p.getRequest());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("mode", r.path("mode").asString());
        m.put("scope", r.path("scope").asString());
        m.put("dayIndex", r.path("dayIndex").isNull() ? null : r.path("dayIndex").asInt());
        // A selection re-run needs the same places; older previews have none, which reads as an empty list.
        m.put("destinationIds", r.path("destinationIds").valueStream().map(JsonNode::asString).toList());
        m.put("instructions", r.path("instructions").isNull() ? null : r.path("instructions").asString());
        return json.writeValueAsString(m);
    }

    @Transactional(readOnly = true)
    public boolean stale(OptimizationPreview p) {
        return trips.version(p.getTripId()) != p.getBaseVersion();
    }

    @Transactional
    public void apply(UUID userId, UUID tripId, UUID previewId) {
        access.require(tripId, userId, TripRole.EDITOR);
        OptimizationPreview p = find(tripId, previewId);
        if (p.getStatus() != OptimizationPreview.Status.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This preview can't be applied (" + p.getStatus().name().toLowerCase() + ")");
        }
        // Atomic check-and-claim: fails if anyone changed the trip after the preview was made.
        trips.claimVersion(tripId, p.getBaseVersion());
        JsonNode result = json.readTree(p.getResult());
        List<DestinationService.PlanItem> items = result.path("items").valueStream().map(i -> new DestinationService.PlanItem(
            UUID.fromString(i.path("id").asString()),
            i.path("dayIndex").isNull() ? null : i.path("dayIndex").asInt(),
            i.path("position").isNull() ? null : i.path("position").asInt(),
            time(i.path("startTime")))).toList();
        String mode = json.readTree(p.getRequest()).path("mode").asString().toLowerCase();
        destinations.applyPlan(userId, tripId, items, "applied the optimizer (%s pace): %d of %d places scheduled"
            .formatted(mode, result.path("scheduled").asInt(), result.path("total").asInt()));
        p.setStatus(OptimizationPreview.Status.APPLIED);
    }

    @Transactional
    public void discard(UUID userId, UUID tripId, UUID previewId) {
        access.require(tripId, userId, TripRole.EDITOR);
        OptimizationPreview p = find(tripId, previewId);
        if (p.getStatus() == OptimizationPreview.Status.PENDING || p.getStatus() == OptimizationPreview.Status.READY) {
            p.setStatus(OptimizationPreview.Status.DISCARDED);
        }
    }

    private OptimizationPreview find(UUID tripId, UUID previewId) {
        return previews.findByIdAndTripId(previewId, tripId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Preview not found"));
    }
}
