package com.travelpal.importer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.travelpal.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

class ImportApiTest extends IntegrationTest {
    static final String DRAFT = "{\"name\":\"Tokyo\",\"days\":[{\"date\":\"2026-12-25\",\"items\":[]}],\"undated\":[],\"issues\":[]}";

    @Autowired
    JdbcTemplate jdbc;
    Login who;
    String tripId;
    String base;
    final AtomicReference<String> sent = new AtomicReference<>();

    @BeforeEach
    void setUp() throws Exception {
        who = register();
        tripId = read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"Japan\",\"startDate\":\"2026-12-24\",\"endDate\":\"2026-12-26\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id");
        base = "/api/trips/" + tripId;
        answer(200, DRAFT);
    }

    @AfterEach
    void reset() {
        aiHandler = ex -> respond(ex, 500, "");
    }

    void answer(int status, String body) {
        aiHandler = ex -> {
            try {
                sent.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
            respond(ex, status, body);
        };
    }

    MockMultipartHttpServletRequestBuilder upload(Login as) {
        MockMultipartHttpServletRequestBuilder b = multipart("/api/imports/read");
        b.header("Authorization", "Bearer " + as.token());
        return b;
    }

    /** A read that got past validation: the whole event stream, once it has ended. */
    String stream(MockMultipartHttpServletRequestBuilder b) throws Exception {
        var started = mvc.perform(b).andExpect(request().asyncStarted()).andReturn();
        return mvc.perform(asyncDispatch(started)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    /** The data of the stream's {@code event} ({@code draft} or {@code error}). */
    static String data(String stream, String event) {
        String marker = "event: " + event + "\ndata: ";
        int at = stream.indexOf(marker);
        assertThat(at).as("no %s event in %s", event, stream).isNotNegative();
        return stream.substring(at + marker.length(), stream.indexOf('\n', at + marker.length()));
    }

    static MockMultipartFile pdf(String content) {
        return new MockMultipartFile("file", "plan.pdf", "application/pdf", content.getBytes(StandardCharsets.ISO_8859_1));
    }

    void viewer(Login v) {
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", tripId, v.userId());
    }

    // ---- read ----

    @Test
    void readForwardsTextWithTodayAndTripContextAndReturnsTheDraft() throws Exception {
        String body = stream(upload(who).param("text", "DEC 25\nSenso-ji").param("tripId", tripId));
        // Progress goes out first (a long read must not look idle to the edge), then the draft.
        assertThat(body).startsWith("event: status\n");
        assertThat(data(body, "draft")).isEqualTo(DRAFT);
        assertThat((String) JsonPath.read(sent.get(), "$.text")).isEqualTo("DEC 25\nSenso-ji");
        assertThat((String) JsonPath.read(sent.get(), "$.today")).isEqualTo(LocalDate.now().toString());
        assertThat((String) JsonPath.read(sent.get(), "$.trip.endDate")).isEqualTo("2026-12-26");
        assertThat((List<String>) JsonPath.read(sent.get(), "$.trip.cities")).containsExactly("Tokyo");

        data(stream(upload(who).file(pdf("%PDF-1.7\n/Type /Page\n"))), "draft");
        assertThat(Base64.getDecoder().decode((String) JsonPath.read(sent.get(), "$.pdfBase64"))).startsWith("%PDF-".getBytes());
        assertThat(sent.get()).doesNotContain("\"trip\"");
    }

    @Test
    void readValidatesInput() throws Exception {
        mvc.perform(multipart("/api/imports/read").param("text", "x").header("Authorization", "Bearer forged")).andExpect(status().isUnauthorized());
        mvc.perform(upload(who)).andExpect(status().isBadRequest());
        mvc.perform(upload(who).param("text", "  ")).andExpect(status().isBadRequest());
        mvc.perform(upload(who).param("text", "x").file(pdf("%PDF-1.7"))).andExpect(status().isBadRequest());
        mvc.perform(upload(who).param("text", "x".repeat(20_001))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail").value("That's more than 20,000 characters. Paste a shorter part of the plan."));
        mvc.perform(upload(who).file(pdf("<html>not a pdf"))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail").value("That file isn't a PDF."));
        mvc.perform(upload(who).file(new MockMultipartFile("file", "a.txt", "text/plain", "%PDF-1.7".getBytes()))).andExpect(status().isBadRequest());
        mvc.perform(upload(who).file(pdf("%PDF-1.7\n" + "/Type /Page\n".repeat(31) + "/Type /Pages\n"))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail").value("PDFs can have up to 30 pages."));
        byte[] big = new byte[(int) ImportService.MAX_PDF_BYTES + 1];
        System.arraycopy("%PDF-".getBytes(), 0, big, 0, 5);
        mvc.perform(upload(who).file(new MockMultipartFile("file", "big.pdf", "application/pdf", big))).andExpect(status().isBadRequest());
        assertThat(sent.get()).isNull(); // nothing invalid reached the AI
    }

    @Test
    void readNeedsEditorOfTheTripAndReportsUnreadablePlansAndOutages() throws Exception {
        Login v = register();
        viewer(v);
        mvc.perform(upload(v).param("text", "plan").param("tripId", tripId)).andExpect(status().isForbidden());
        mvc.perform(upload(register()).param("text", "plan").param("tripId", tripId)).andExpect(status().isNotFound());
        data(stream(upload(v).param("text", "plan")), "draft"); // a new trip needs only an account
        // Failures after validation arrive in the stream, with the status they'd have had.
        answer(200, "{\"days\":[],\"undated\":[],\"issues\":[]}");
        assertThat((Integer) JsonPath.read(data(stream(upload(who).param("text", "hello")), "error"), "$.status")).isEqualTo(422);
        answer(503, "");
        String outage = data(stream(upload(who).param("text", "plan")), "error");
        assertThat((Integer) JsonPath.read(outage, "$.status")).isEqualTo(503);
        assertThat((String) JsonPath.read(outage, "$.message")).isEqualTo("Reading your plan is unavailable right now.");
    }

    @Test
    void readSpendsTheImportQuota() throws Exception {
        Login heavy = register();
        for (int i = 0; i < 20; i++) {
            stream(upload(heavy).param("text", "plan"));
        }
        mvc.perform(upload(heavy).param("text", "plan")).andExpect(status().isTooManyRequests());
    }

    // ---- apply ----

    static String applyBody(UUID importId, String target, String places, String entries) {
        return "{\"importId\":\"%s\",%s,\"places\":[%s],\"entries\":[%s]}".formatted(importId, target, places, entries);
    }

    static final String NEW_TRIP = "\"newTrip\":{\"name\":\"Tokyo\",\"startDate\":\"2026-12-24\",\"endDate\":\"2026-12-29\","
        + "\"cities\":[{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76,\"startDate\":\"2026-12-25\",\"endDate\":\"2026-12-29\"}]}";
    static final String TOKYO_PLACES = String.join(",",
        "{\"date\":\"2026-12-25\",\"position\":2,\"name\":\"Senso-ji\",\"lat\":35.71,\"lng\":139.79,\"providerId\":\"geoapify:senso\"}",
        "{\"date\":\"2026-12-25\",\"position\":1,\"name\":\"Nakamise\",\"notes\":\"shopping street\"}",
        "{\"date\":\"2026-12-27\",\"position\":0,\"name\":\"Omakase\",\"startTime\":\"20:30\",\"locked\":true,\"notes\":\"$20 reserve\"}",
        "{\"date\":\"2026-12-27\",\"position\":1,\"name\":\"Sushi Rizaki Ebisu\",\"startTime\":\"20:30\",\"locked\":false}",
        "{\"date\":\"2026-12-28\",\"position\":0,\"name\":\"Kamakura\",\"dayTrip\":true}",
        "{\"date\":null,\"position\":0,\"name\":\"Someday\",\"startTime\":\"10:00\",\"locked\":true}");
    static final String TOKYO_ENTRIES = String.join(",",
        "{\"date\":\"2026-12-24\",\"position\":0,\"kind\":\"FLIGHT\",\"title\":\"LAX → HND\",\"startTime\":\"10:15\",\"details\":{\"from\":\"LAX\","
            + "\"to\":\"HND\",\"departs\":\"10:15\",\"arrivesDay\":1,\"arrives\":\"15:20\"},\"source\":\"Flight LAX → HND\"}",
        "{\"date\":\"2026-12-27\",\"position\":0,\"kind\":\"CHOICE\",\"title\":\"Something in between\",\"details\":{\"options\":["
            + "{\"label\":\"Shibuya Sky\",\"place\":{\"name\":\"Shibuya Sky\",\"lat\":35.658,\"lng\":139.702,\"providerId\":\"geoapify:sky\"}},"
            + "{\"label\":\"Pokemon Center\",\"place\":null}],\"resolved\":false}}",
        "{\"date\":\"2026-12-27\",\"position\":1,\"kind\":\"NOTE\",\"title\":\"Vincent bday\"}");

    String applyNew(UUID importId) throws Exception {
        return mvc.perform(json(post("/api/imports/apply"), who, applyBody(importId, NEW_TRIP, TOKYO_PLACES, TOKYO_ENTRIES)))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    @Test
    void applyToANewTripCreatesEverythingInOneEventAndARepeatAddsNothing() throws Exception {
        UUID importId = UUID.randomUUID();
        String result = applyNew(importId);
        String newTrip = JsonPath.read(result, "$.tripId");
        assertThat((Integer) JsonPath.read(result, "$.firstDayIndex")).isZero();
        assertThat((Integer) JsonPath.read(result, "$.added.places")).isEqualTo(6);
        assertThat((Integer) JsonPath.read(result, "$.added.entries")).isEqualTo(3);
        String t = "/api/trips/" + newTrip;
        mvc.perform(auth(get(t), who)).andExpect(jsonPath("$.startDate").value("2026-12-24")).andExpect(jsonPath("$.dayCount").value(6))
            .andExpect(jsonPath("$.role").value("OWNER")).andExpect(jsonPath("$.cities[0].name").value("Tokyo"))
            .andExpect(jsonPath("$.cities[0].startDate").value("2026-12-25"));
        mvc.perform(auth(get(t + "/destinations"), who))
            .andExpect(jsonPath("$[0].name").value("Nakamise")).andExpect(jsonPath("$[0].position").value(0)) // plan order kept
            .andExpect(jsonPath("$[1].name").value("Senso-ji")).andExpect(jsonPath("$[1].flexibility").value("SAME_DAY"))
            .andExpect(jsonPath("$[?(@.name=='Omakase')].flexibility").value("FIXED"))
            .andExpect(jsonPath("$[?(@.name=='Omakase')].locked").value(true))
            .andExpect(jsonPath("$[?(@.name=='Omakase')].notes").value("$20 reserve"))
            .andExpect(jsonPath("$[?(@.name=='Sushi Rizaki Ebisu')].flexibility").value("SAME_DAY"))
            .andExpect(jsonPath("$[?(@.name=='Sushi Rizaki Ebisu')].startTime").value("20:30:00"))
            .andExpect(jsonPath("$[?(@.name=='Kamakura')].dayTrip").value(true))
            .andExpect(jsonPath("$[?(@.name=='Someday')].dayIndex").value(org.hamcrest.Matchers.contains(org.hamcrest.Matchers.nullValue())))
            .andExpect(jsonPath("$[?(@.name=='Someday')].locked").value(false))
            .andExpect(jsonPath("$[?(@.name=='Someday')].flexibility").value("FLEXIBLE"));
        mvc.perform(auth(get(t + "/entries"), who)).andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].kind").value("FLIGHT")).andExpect(jsonPath("$[0].details.arrives").value("15:20"))
            .andExpect(jsonPath("$[0].source").value("Flight LAX → HND"))
            .andExpect(jsonPath("$[1].kind").value("CHOICE")).andExpect(jsonPath("$[2].title").value("Vincent bday"));
        mvc.perform(auth(get(t + "/events?limit=1"), who))
            .andExpect(jsonPath("$[0].type").value("IMPORT_APPLIED")).andExpect(jsonPath("$[0].summary").value("imported 6 places and 3 notes"))
            .andExpect(jsonPath("$[0].undoable").value(true))
            // The result names its own event, so the toast's Undo can't reach a different import.
            .andExpect(jsonPath("$[0].id").value(((Number) JsonPath.read(result, "$.eventId")).longValue()));

        assertThat(applyNew(importId)).isEqualTo(result);
        assertThat(jdbc.queryForObject("select count(*) from trip_member where user_id = ?", Long.class, who.userId())).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from destination where trip_id = ?::uuid", Long.class, newTrip)).isEqualTo(6);
        assertThat(jdbc.queryForObject("select count(*) from trip_event where trip_id = ?::uuid and type = 'IMPORT_APPLIED'", Long.class, newTrip)).isOne();
        // Someone else replaying the id learns nothing about the trip.
        mvc.perform(json(post("/api/imports/apply"), register(), applyBody(importId, NEW_TRIP, "", ""))).andExpect(status().isNotFound());
    }

    @Autowired
    ImportService imports;
    @Autowired
    org.springframework.transaction.support.TransactionTemplate tx;
    @Autowired
    tools.jackson.databind.json.JsonMapper mapper;

    @Test
    void overlappingAppliesOfOneNewTripImportCreateOneTrip() throws Exception {
        UUID importId = UUID.randomUUID();
        ImportController.ApplyRequest req = mapper.readValue(applyBody(importId, NEW_TRIP, TOKYO_PLACES, TOKYO_ENTRIES),
            ImportController.ApplyRequest.class);
        var second = new java.util.concurrent.CompletableFuture<Object>();
        ImportService.Result first = tx.execute(s -> {
            ImportService.Result r = imports.apply(who.userId(), req);
            // A retry arrives while the first Apply hasn't committed; it must wait for it, then return its result.
            Thread.ofVirtual().start(() -> {
                try {
                    second.complete(tx.execute(s2 -> imports.apply(who.userId(), req)));
                } catch (Throwable e) {
                    second.complete(e);
                }
            });
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                throw new IllegalStateException(e);
            }
            return r;
        });
        assertThat(second.get(10, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(first);
        assertThat(jdbc.queryForObject("select count(*) from trip_import where import_id = ?", Long.class, importId)).isOne();
        assertThat(jdbc.queryForObject("select count(*) from trip_member where user_id = ?", Long.class, who.userId())).isEqualTo(2);
    }

    @Test
    void applyToAnExistingTripAppendsSkipsDuplicatesAndCanExtendTheEnd() throws Exception {
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Senso-ji\",\"dayIndex\":1,\"providerId\":\"geoapify:senso\"}"));
        String places = "{\"date\":\"2026-12-25\",\"position\":0,\"name\":\"Senso-ji again\",\"providerId\":\"geoapify:senso\"},"
            + "{\"date\":\"2026-12-25\",\"position\":1,\"name\":\"Ueno Park\",\"providerId\":\"geoapify:ueno\"},"
            + "{\"date\":\"2026-12-28\",\"position\":0,\"name\":\"Kamakura\"}";
        String entries = "{\"date\":\"2026-12-25\",\"position\":0,\"kind\":\"MEAL\",\"title\":\"Breakfast\",\"details\":{\"slot\":\"BREAKFAST\",\"areas\":[\"Ueno\",\"Asakusa\"]}}";
        String target = "\"tripId\":\"%s\"".formatted(tripId);
        mvc.perform(json(post("/api/imports/apply"), who, applyBody(UUID.randomUUID(), target, places, entries))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.startsWith("“Kamakura” is on 2026-12-28, outside the trip")));
        mvc.perform(auth(get(base + "/entries"), who)).andExpect(jsonPath("$.length()").value(0)); // nothing half-applied

        String result = mvc.perform(json(post("/api/imports/apply"), who,
                applyBody(UUID.randomUUID(), target + ",\"extendEndTo\":\"2026-12-28\"", places, entries)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.tripId").value(tripId)).andExpect(jsonPath("$.firstDayIndex").value(1))
            .andExpect(jsonPath("$.added.places").value(2)).andExpect(jsonPath("$.skipped[0].name").value("Senso-ji again"))
            .andExpect(jsonPath("$.skipped[0].reason").value("Already in this trip")).andReturn().getResponse().getContentAsString();
        assertThat(result).isNotBlank();
        mvc.perform(auth(get(base), who)).andExpect(jsonPath("$.endDate").value("2026-12-28"));
        mvc.perform(auth(get(base + "/destinations"), who))
            .andExpect(jsonPath("$[0].name").value("Senso-ji")).andExpect(jsonPath("$[1].name").value("Ueno Park"))
            .andExpect(jsonPath("$[1].position").value(1)) // after what the day already had
            .andExpect(jsonPath("$[2].dayIndex").value(4));
    }

    @Test
    void applyValidatesTargetsDetailsAndAccess() throws Exception {
        Login v = register();
        viewer(v);
        String target = "\"tripId\":\"%s\"".formatted(tripId);
        mvc.perform(json(post("/api/imports/apply"), v, applyBody(UUID.randomUUID(), target, "", ""))).andExpect(status().isForbidden());
        mvc.perform(json(post("/api/imports/apply"), who, applyBody(UUID.randomUUID(), target + "," + NEW_TRIP, "", ""))).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/imports/apply"), who, "{\"importId\":\"%s\",\"places\":[],\"entries\":[]}".formatted(UUID.randomUUID())))
            .andExpect(status().isBadRequest());
        String unknownKey = "{\"date\":null,\"position\":0,\"kind\":\"NOTE\",\"title\":\"x\",\"details\":{\"script\":\"<b>\"}}";
        mvc.perform(json(post("/api/imports/apply"), who, applyBody(UUID.randomUUID(), target, "", unknownKey))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail").value("Unknown details for a note entry"));
        String badSlot = "{\"date\":null,\"position\":0,\"kind\":\"MEAL\",\"title\":\"x\",\"details\":{\"slot\":\"SUPPER\"}}";
        mvc.perform(json(post("/api/imports/apply"), who, applyBody(UUID.randomUUID(), target, "", badSlot))).andExpect(status().isBadRequest());
        String badOption = "{\"date\":null,\"position\":0,\"kind\":\"CHOICE\",\"title\":\"x\",\"details\":{\"options\":[{\"label\":\"a\",\"place\":{\"evil\":1}}]}}";
        mvc.perform(json(post("/api/imports/apply"), who, applyBody(UUID.randomUUID(), target, "", badOption))).andExpect(status().isBadRequest());
    }

    @Test
    void undoRemovesTheImportButKeepsWhatWasEditedSince() throws Exception {
        String t = "/api/trips/" + JsonPath.read(applyNew(UUID.randomUUID()), "$.tripId");
        long event = Long.parseLong(read(mvc.perform(auth(get(t + "/events?limit=1"), who)).andReturn(), "$[0].id"));
        String nakamise = read(mvc.perform(auth(get(t + "/destinations"), who)).andReturn(), "$[0].id");
        mvc.perform(json(put(t + "/destinations/" + nakamise), who, "{\"name\":\"Nakamise-dori\",\"dayIndex\":1,\"version\":0}")).andExpect(status().isOk());
        String note = read(mvc.perform(auth(get(t + "/entries"), who)).andReturn(), "$[2].id");
        mvc.perform(json(put(t + "/entries/" + note), who, "{\"title\":\"Vincent's birthday\",\"dayIndex\":3,\"version\":0}")).andExpect(status().isOk());

        mvc.perform(auth(post(t + "/events/" + event + "/undo"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(get(t + "/destinations"), who)).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].name").value("Nakamise-dori"));
        mvc.perform(auth(get(t + "/entries"), who)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(auth(get(t + "/events?limit=1"), who)).andExpect(jsonPath("$[0].summary")
            .value("undid: imported 6 places and 3 notes (kept Nakamise-dori, Vincent's birthday: changed since)"));
    }
}
