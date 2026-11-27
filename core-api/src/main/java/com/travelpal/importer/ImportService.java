package com.travelpal.importer;

import com.travelpal.assistant.AiServiceClient;
import com.travelpal.destination.Destination;
import com.travelpal.destination.DestinationService;
import com.travelpal.destination.Flexibility;
import com.travelpal.entry.EntryService;
import com.travelpal.entry.ItineraryEntry;
import com.travelpal.history.History;
import com.travelpal.importer.ImportController.ApplyRequest;
import com.travelpal.importer.ImportController.EntryRow;
import com.travelpal.importer.ImportController.PlaceRow;
import com.travelpal.optimize.AiQuota;
import com.travelpal.trip.Trip;
import com.travelpal.trip.TripAccess;
import com.travelpal.trip.TripCity;
import com.travelpal.trip.TripRole;
import com.travelpal.trip.TripService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Import a traveler's own plan. {@code read} sends the text or PDF to ai-service and returns its draft as-is (nothing
 * is stored, the PDF is held in memory for the one request); {@code apply} saves the reviewed draft in one transaction
 * with one history event, so one Undo takes it back. Plan text, PDF bytes and titles are never logged.
 */
@Service
public class ImportService {
    private static final Logger log = LoggerFactory.getLogger(ImportService.class);
    static final int MAX_TEXT = 20_000;
    static final long MAX_PDF_BYTES = 10L * 1024 * 1024;
    static final int MAX_PAGES = 30;
    // ponytail: counts page objects in the raw bytes; pages inside compressed object streams aren't seen, so this
    // undercounts some PDFs. The 10 MB cap still bounds the cost; parse the page tree if that ever matters.
    private static final Pattern PAGE = Pattern.compile("/Type\\s*/Page(?![A-Za-z])");

    public record Added(int places, int entries) {}
    public record Skipped(String name, String reason) {}
    public record Result(UUID tripId, Integer firstDayIndex, Added added, List<Skipped> skipped) {}
    /** The IMPORT_APPLIED event's "after": what was created (for undo) and the result (for a repeated apply). */
    record Applied(UUID importId, List<History.Ref> destinations, List<History.Ref> entries, Result result) {}

    private final TripAccess access;
    private final TripService trips;
    private final DestinationService destinations;
    private final EntryService entries;
    private final History history;
    private final AiQuota quota;
    private final AiServiceClient ai;
    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    ImportService(TripAccess access, TripService trips, DestinationService destinations, EntryService entries, History history,
                  AiQuota quota, AiServiceClient ai, JdbcTemplate jdbc, JsonMapper json) {
        this.access = access;
        this.trips = trips;
        this.destinations = destinations;
        this.entries = entries;
        this.history = history;
        this.quota = quota;
        this.ai = ai;
        this.jdbc = jdbc;
        this.json = json;
    }

    public String read(UUID user, String text, MultipartFile file, UUID tripId) throws InterruptedException, IOException {
        boolean hasText = text != null && !text.isBlank();
        if (hasText == (file != null && !file.isEmpty())) {
            throw bad("Paste your plan or choose a PDF, not both.");
        }
        Map<String, Object> body = new HashMap<>();
        if (hasText) {
            if (text.length() > MAX_TEXT) {
                throw bad("That's more than 20,000 characters. Paste a shorter part of the plan.");
            }
            body.put("text", text);
        } else {
            if (file.getSize() > MAX_PDF_BYTES) {
                throw bad("PDFs can be up to 10 MB.");
            }
            byte[] pdf = file.getBytes();
            if (!"application/pdf".equals(file.getContentType()) || !Arrays.equals(pdf, 0, Math.min(5, pdf.length), "%PDF-".getBytes(), 0, 5)) {
                throw bad("That file isn't a PDF.");
            }
            if (PAGE.matcher(new String(pdf, StandardCharsets.ISO_8859_1)).results().count() > MAX_PAGES) {
                throw bad("PDFs can have up to " + MAX_PAGES + " pages.");
            }
            body.put("pdfBase64", Base64.getEncoder().encodeToString(pdf));
        }
        if (tripId != null) {
            access.require(tripId, user, TripRole.EDITOR);
            TripService.Detail d = trips.get(user, tripId);
            body.put("trip", Map.of("startDate", d.trip().getStartDate().toString(), "endDate", d.trip().getEndDate().toString(),
                "cities", d.cities().stream().map(TripCity::getName).toList()));
        }
        body.put("today", LocalDate.now().toString());
        quota.spend(user, AiQuota.Kind.IMPORT);
        log.info("import read: {} chars of text, {} PDF bytes", hasText ? text.length() : 0, hasText ? 0 : file.getSize());
        String draft = ai.call("/internal/import", json.writeValueAsString(body), user, Duration.ofMinutes(3), "Reading your plan");
        JsonNode d = json.readTree(draft);
        if (d.path("days").size() == 0 && d.path("undated").size() == 0) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                "We couldn't find a plan in that. Check it has dates and places, or paste the text instead.");
        }
        return draft;
    }

    @Transactional
    public Result apply(UUID user, ApplyRequest req) {
        if ((req.tripId() == null) == (req.newTrip() == null)) {
            throw bad("Import into one trip: an existing one or a new one.");
        }
        UUID tripId = req.tripId();
        if (tripId != null) {
            access.require(tripId, user, TripRole.EDITOR); // takes the trip lock: a retried Apply waits for the first one
        }
        Optional<Result> again = previous(user, req.importId());
        if (again.isPresent()) {
            return again.get();
        }
        if (tripId == null) {
            var n = req.newTrip();
            tripId = trips.create(user, n.name(), n.startDate(), n.endDate(), n.cities().stream()
                .map(c -> new TripService.CityInput(c.name(), c.lat(), c.lng(), c.startDate(), c.endDate(), c.locked())).toList()).getId();
        } else if (req.extendEndTo() != null) {
            Trip t = trips.get(user, tripId).trip();
            if (req.extendEndTo().isAfter(t.getEndDate())) {
                trips.update(user, tripId, t.getName(), t.getStartDate(), req.extendEndTo());
            }
        }
        Trip trip = trips.get(user, tripId).trip();
        Function<LocalDate, Integer> day = d -> d == null ? null : (int) ChronoUnit.DAYS.between(trip.getStartDate(), d);
        for (PlaceRow p : req.places()) {
            inside(trip, p.date(), p.name());
        }
        for (EntryRow e : req.entries()) {
            inside(trip, e.date(), e.title());
        }

        List<History.Ref> placeRefs = new ArrayList<>();
        List<History.Ref> entryRefs = new ArrayList<>();
        List<Skipped> skipped = new ArrayList<>();
        List<Integer> days = new ArrayList<>();
        Set<String> taken = new HashSet<>(destinations.providerIds(tripId));
        for (PlaceRow p : req.places().stream().sorted(Comparator.comparing(PlaceRow::date, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparingInt(PlaceRow::position)).toList()) {
            if (p.providerId() != null && !taken.add(p.providerId())) {
                skipped.add(new Skipped(p.name(), "Already in this trip"));
                continue;
            }
            // A plan's time is locked unless the traveler turned Lock time off; untimed places keep their day.
            boolean dated = p.date() != null;
            boolean locked = dated && p.locked() && p.startTime() != null;
            Flexibility flex = locked ? Flexibility.FIXED : dated ? Flexibility.SAME_DAY : Flexibility.FLEXIBLE;
            Destination d = destinations.insert(user, tripId, new DestinationService.Input(p.name(), p.address(), p.lat(), p.lng(),
                p.providerId(), p.notes(), null, day.apply(p.date()), dated ? p.startTime() : null, locked, flex, null, null, p.dayTrip()));
            placeRefs.add(new History.Ref(d.getId(), d.getVersion()));
            if (d.getDayIndex() != null) {
                days.add(d.getDayIndex());
            }
        }
        for (EntryRow e : req.entries().stream().sorted(Comparator.comparing(EntryRow::date, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparingInt(EntryRow::position)).toList()) {
            ItineraryEntry x = entries.insert(user, tripId, day.apply(e.date()), e.kind(), e.title(), e.startTime(), e.details(), e.source(), req.importId());
            entryRefs.add(new History.Ref(x.getId(), x.getVersion()));
            if (x.getDayIndex() != null) {
                days.add(x.getDayIndex());
            }
        }
        Result result = new Result(tripId, days.stream().min(Integer::compare).orElse(null),
            new Added(placeRefs.size(), entryRefs.size()), skipped);
        long eventId = history.record(tripId, user, "IMPORT_APPLIED", "imported " + count(placeRefs.size(), "place") + " and "
            + count(entryRefs.size(), "note"), null, new Applied(req.importId(), placeRefs, entryRefs, result));
        jdbc.update("insert into trip_import (import_id, trip_id, event_id) values (?, ?, ?)", req.importId(), tripId, eventId);
        log.info("import applied: {} places, {} entries, {} skipped", placeRefs.size(), entryRefs.size(), skipped.size());
        return result;
    }

    /** The first result for an importId that was already applied (if the caller can see that trip). */
    private Optional<Result> previous(UUID user, UUID importId) {
        return jdbc.query("select i.trip_id, e.after from trip_import i join trip_event e on e.id = i.event_id where i.import_id = ?",
            (rs, n) -> {
                access.require(rs.getObject(1, UUID.class), user, TripRole.VIEWER);
                return history.read(rs.getString(2), Applied.class).result();
            }, importId).stream().findFirst();
    }

    private static void inside(Trip trip, LocalDate date, String what) {
        if (date != null && (date.isBefore(trip.getStartDate()) || date.isAfter(trip.getEndDate()))) {
            throw bad("“" + what + "” is on " + date + ", outside the trip (" + trip.getStartDate() + " to " + trip.getEndDate()
                + "). Move it, remove it, or extend the trip.");
        }
    }

    private static String count(int n, String noun) {
        return n + " " + noun + (n == 1 ? "" : "s");
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
