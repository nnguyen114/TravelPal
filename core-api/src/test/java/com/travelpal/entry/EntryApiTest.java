package com.travelpal.entry;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class EntryApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    Login who;
    String tripId;
    String base;
    String note;
    String choice;

    @BeforeEach
    void trip() throws Exception {
        who = register();
        tripId = read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id");
        base = "/api/trips/" + tripId;
        mvc.perform(json(post("/api/imports/apply"), who, """
            {"importId":"%s","tripId":"%s","places":[],"entries":[
              {"date":"2027-06-12","position":0,"kind":"NOTE","title":"Birthday"},
              {"date":"2027-06-12","position":1,"kind":"CHOICE","title":"Something in between","details":{"options":[
                {"label":"Shibuya Sky","place":{"name":"Shibuya Sky","address":"Shibuya","lat":35.658,"lng":139.702,"providerId":"geoapify:sky"}},
                {"label":"Pokemon Center","place":null}],"resolved":false}}]}""".formatted(UUID.randomUUID(), tripId)))
            .andExpect(status().isOk());
        note = read(mvc.perform(auth(get(base + "/entries"), who)).andReturn(), "$[0].id");
        choice = read(mvc.perform(auth(get(base + "/entries"), who)).andReturn(), "$[1].id");
    }

    @Test
    void editMoveAndDeleteWithVersions() throws Exception {
        mvc.perform(json(put(base + "/entries/" + note), who, "{\"title\":\"Vincent bday\",\"dayIndex\":0,\"startTime\":\"19:00\",\"version\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.dayIndex").value(0)).andExpect(jsonPath("$.position").value(0))
            .andExpect(jsonPath("$.startTime").value("19:00:00")).andExpect(jsonPath("$.version").value(1));
        mvc.perform(json(put(base + "/entries/" + note), who, "{\"title\":\"Old\",\"dayIndex\":0,\"version\":0}")).andExpect(status().isConflict());
        mvc.perform(json(put(base + "/entries/" + note), who, "{\"title\":\"x\",\"dayIndex\":9,\"version\":1}")).andExpect(status().isBadRequest());
        mvc.perform(json(put(base + "/entries/" + note), who, "{\"title\":\"\",\"dayIndex\":0,\"version\":1}")).andExpect(status().isBadRequest());
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].summary").value("updated Vincent bday"));

        mvc.perform(auth(delete(base + "/entries/" + note + "?version=0"), who)).andExpect(status().isConflict());
        mvc.perform(auth(delete(base + "/entries/" + note + "?version=1"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(delete(base + "/entries/" + note), who)).andExpect(status().isNotFound());
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].type").value("ENTRY_REMOVED"));
        mvc.perform(auth(get(base + "/entries"), who)).andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void choosingAnOptionAddsItAsASameDayPlaceAndRemovesTheChoice() throws Exception {
        mvc.perform(json(post(base + "/entries/" + note + "/choose"), who, "{\"option\":0}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), who, "{\"option\":5}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), who, "{\"option\":0}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Shibuya Sky")).andExpect(jsonPath("$.dayIndex").value(2))
            .andExpect(jsonPath("$.flexibility").value("SAME_DAY")).andExpect(jsonPath("$.lat").value(35.658))
            .andExpect(jsonPath("$.providerId").value("geoapify:sky"));
        mvc.perform(auth(get(base + "/entries"), who)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].type").value("CHOICE_RESOLVED"))
            .andExpect(jsonPath("$[0].summary").value("chose Shibuya Sky for Something in between"));
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), who, "{\"option\":1}")).andExpect(status().isNotFound());
    }

    @Test
    void choosingAPlaceAlreadyInTheTripConflictsAndAnOptionWithoutAPlaceIsAddedByName() throws Exception {
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Sky\",\"providerId\":\"geoapify:sky\"}"));
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), who, "{\"option\":0}")).andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value("Shibuya Sky is already in this trip"));
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), who, "{\"option\":1}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Pokemon Center")).andExpect(jsonPath("$.lat").doesNotExist());
    }

    @Test
    void shorteningTheTripMovesEntriesToUndated() throws Exception {
        mvc.perform(json(put(base), who, "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\"}")).andExpect(status().isOk());
        mvc.perform(auth(get(base + "/entries"), who))
            .andExpect(jsonPath("$[0].dayIndex").doesNotExist()).andExpect(jsonPath("$[0].version").value(1));
        // An edit based on the old placement is now stale.
        mvc.perform(json(put(base + "/entries/" + note), who, "{\"title\":\"Birthday\",\"dayIndex\":1,\"version\":0}")).andExpect(status().isConflict());
    }

    @Test
    void viewersReadButNeverWrite() throws Exception {
        Login viewer = register();
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", tripId, viewer.userId());
        mvc.perform(auth(get(base + "/entries"), viewer)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        mvc.perform(json(put(base + "/entries/" + note), viewer, "{\"title\":\"x\",\"dayIndex\":0,\"version\":0}")).andExpect(status().isForbidden());
        mvc.perform(auth(delete(base + "/entries/" + note), viewer)).andExpect(status().isForbidden());
        mvc.perform(json(post(base + "/entries/" + choice + "/choose"), viewer, "{\"option\":0}")).andExpect(status().isForbidden());
        mvc.perform(auth(get(base + "/entries"), register())).andExpect(status().isNotFound());
    }
}
