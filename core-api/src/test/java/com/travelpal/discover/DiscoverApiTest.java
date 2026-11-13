package com.travelpal.discover;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.travelpal.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class DiscoverApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    Login me;
    Login friend;
    String base;
    String fuglen;
    final AtomicReference<String> sent = new AtomicReference<>();

    @BeforeEach
    void trip() throws Exception {
        me = register();
        friend = register();
        // An earlier trip of mine: my picks there are part of my taste.
        String old = read(mvc.perform(json(post("/api/trips"), me,
            "{\"name\":\"Old\",\"startDate\":\"2026-01-01\",\"endDate\":\"2026-01-02\",\"destination\":{\"name\":\"Oslo\"}}")).andReturn(), "$.id");
        mvc.perform(json(post("/api/trips/" + old + "/destinations"), me, "{\"name\":\"Tim Wendelboe\",\"address\":\"Grunerlokka\"}"));
        String id = read(mvc.perform(json(post("/api/trips"), me,
            "{\"name\":\"Japan\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76}}"))
            .andReturn(), "$.id");
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'EDITOR')", id, friend.userId());
        base = "/api/trips/" + id;
        fuglen = read(mvc.perform(json(post(base + "/destinations"), me,
            "{\"name\":\"Fuglen\",\"lat\":35.666,\"lng\":139.690,\"dayIndex\":0,\"providerId\":\"osm:N1\"}")).andReturn(), "$.id");
        mvc.perform(json(post(base + "/destinations"), friend, "{\"name\":\"Robot Restaurant\",\"lat\":35.69,\"lng\":139.70,\"dayIndex\":1}"));
        aiHandler = ex -> {
            try {
                sent.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
            respond(ex, 200, "{\"vibe\":\"design-led coffee\",\"suggestions\":[{\"name\":\"Koffee Mameya\",\"why\":\"Close to Fuglen.\"}],\"note\":\"Check hours.\"}");
        };
    }

    @AfterEach
    void reset() {
        aiHandler = ex -> respond(ex, 500, "");
    }

    @Test
    void sendsMyTasteNotMyFriendsAndSearchesAroundTheDay() throws Exception {
        mvc.perform(json(post(base + "/discover"), me, "{\"query\":\"chic cafes\",\"dayIndex\":0}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.suggestions[0].name").value("Koffee Mameya")).andExpect(jsonPath("$.note").value("Check hours."));
        String body = sent.get();
        List<String> taste = JsonPath.read(body, "$.taste[*].name");
        assertThat(taste).contains("Fuglen", "Tim Wendelboe").doesNotContain("Robot Restaurant");
        assertThat((Double) JsonPath.read(body, "$.center.lat")).isEqualTo(35.666);
        assertThat((Double) JsonPath.read(body, "$.radiusKm")).isEqualTo(2.5);
        List<String> excluded = JsonPath.read(body, "$.exclude[*].name");
        assertThat(excluded).contains("Fuglen", "Robot Restaurant");
        assertThat((String) JsonPath.read(body, "$.request")).isEqualTo("chic cafes");
    }

    @Test
    void moreLikeThisSeedsFromThePlaceAndNotInterestedIsRemembered() throws Exception {
        mvc.perform(json(post(base + "/discover/not-interested"), me, "{\"providerId\":\"osm:N77\",\"name\":\"Chain Coffee\"}"))
            .andExpect(status().isNoContent());
        mvc.perform(json(post(base + "/discover/not-interested"), me, "{\"providerId\":\"osm:N77\",\"name\":\"Chain Coffee\"}"))
            .andExpect(status().isNoContent());
        mvc.perform(json(post(base + "/discover"), me, "{\"likeDestinationId\":\"%s\"}".formatted(fuglen))).andExpect(status().isOk());
        assertThat((String) JsonPath.read(sent.get(), "$.seeds[0].name")).isEqualTo("Fuglen");
        List<String> excludedIds = JsonPath.read(sent.get(), "$.exclude[*].providerId");
        assertThat(excludedIds).contains("osm:N77", "osm:N1");
        // whole-trip search falls back to the city, with a wider radius
        mvc.perform(json(post(base + "/discover"), friend, "{\"query\":\"bars\"}")).andExpect(status().isOk());
        assertThat((Double) JsonPath.read(sent.get(), "$.center.lat")).isEqualTo(35.68);
        assertThat((Double) JsonPath.read(sent.get(), "$.radiusKm")).isEqualTo(6.0);
        List<String> friendExcluded = JsonPath.read(sent.get(), "$.exclude[*].providerId");
        assertThat(friendExcluded).doesNotContain("osm:N77");  // my Not interested stays mine
    }

    @Test
    void validationAccessAndFailures() throws Exception {
        mvc.perform(json(post(base + "/discover"), me, "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/discover"), me, "{\"likeDestinationId\":\"00000000-0000-0000-0000-000000000000\"}")).andExpect(status().isNotFound());
        mvc.perform(json(post(base + "/discover"), register(), "{\"query\":\"x\"}")).andExpect(status().isNotFound());
        aiHandler = ex -> respond(ex, 503, "");
        mvc.perform(json(post(base + "/discover"), me, "{\"query\":\"x\"}")).andExpect(status().isServiceUnavailable());
        Login solo = register();
        String bare = read(mvc.perform(json(post("/api/trips"), solo,
            "{\"name\":\"Nowhere\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Somewhere\"}}")).andReturn(), "$.id");
        mvc.perform(json(post("/api/trips/" + bare + "/discover"), solo, "{\"query\":\"x\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips/" + bare + "/destinations"), solo, "{\"name\":\"P\",\"lat\":1.0,\"lng\":2.0,\"dayIndex\":1}"));
        aiHandler = ex -> respond(ex, 200, "{\"suggestions\":[]}");
        mvc.perform(json(post("/api/trips/" + bare + "/discover"), solo, "{\"query\":\"x\",\"dayIndex\":0}")).andExpect(status().isOk());
    }

    @Test
    void linkImportPassesTheTripCity() throws Exception {
        aiHandler = ex -> {
            try {
                sent.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
            respond(ex, 200, "{\"readable\":true,\"guess\":\"Senso-ji\",\"candidates\":[]}");
        };
        mvc.perform(json(post(base + "/places/from-link"), me, "{\"url\":\"https://www.tiktok.com/@x/video/1\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.guess").value("Senso-ji"));
        assertThat((Double) JsonPath.read(sent.get(), "$.near.lat")).isEqualTo(35.68);
        mvc.perform(json(post(base + "/places/from-link"), me, "{\"url\":\"javascript:alert(1)\"}")).andExpect(status().isBadRequest());
    }
}
