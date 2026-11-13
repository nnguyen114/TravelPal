package com.travelpal.history;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

class HistoryApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    TripStream stream;
    Login who;
    String base;
    UUID tripId;

    @BeforeEach
    void trip() throws Exception {
        who = register();
        tripId = UUID.fromString(read(mvc.perform(json(post("/api/trips"), who,
                "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id"));
        base = "/api/trips/" + tripId;
    }

    String add(String name, String day) throws Exception {
        return read(mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"%s\",\"dayIndex\":%s}".formatted(name, day)))
            .andExpect(status().isCreated()).andReturn(), "$.id");
    }

    long latestEvent() throws Exception {
        return Long.parseLong(read(mvc.perform(auth(get(base + "/events?limit=1"), who)).andReturn(), "$[0].id"));
    }

    long version() throws Exception {
        return Long.parseLong(read(mvc.perform(auth(get(base), who)).andReturn(), "$.version"));
    }

    void undo(long id, int expected) throws Exception {
        mvc.perform(auth(post(base + "/events/" + id + "/undo"), who)).andExpect(status().is(expected));
    }

    @Test
    void logsChangesNewestFirstAndBumpsTripVersion() throws Exception {
        long v0 = version();
        add("Meiji Jingu", "0");
        add("Idea", "null");
        mvc.perform(json(post(base + "/cities"), who, "{\"name\":\"Kyoto\"}"));
        mvc.perform(json(put(base), who, "{\"name\":\"T2\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\"}"));
        mvc.perform(json(put(base), who, "{\"name\":\"T2\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-13\"}"));
        assertThat(version()).isGreaterThan(v0 + 4);

        mvc.perform(auth(get(base + "/events"), who)).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].summary").value("changed the trip dates"))
            .andExpect(jsonPath("$[1].summary").value("renamed the trip to T2"))
            .andExpect(jsonPath("$[2].summary").value("added Kyoto"))
            .andExpect(jsonPath("$[3].summary").value("saved Idea as an idea")).andExpect(jsonPath("$[3].undoable").value(true))
            .andExpect(jsonPath("$[4].summary").value("added Meiji Jingu to Day 1"))
            .andExpect(jsonPath("$[5].summary").value("created the trip")).andExpect(jsonPath("$[5].undoable").value(false))
            .andExpect(jsonPath("$[5].actorName").value("Tester"));
        long third = Long.parseLong(read(mvc.perform(auth(get(base + "/events"), who)).andReturn(), "$[2].id"));
        mvc.perform(auth(get(base + "/events?before=" + third + "&limit=2"), who))
            .andExpect(jsonPath("$.length()").value(2)).andExpect(jsonPath("$[0].summary").value("saved Idea as an idea"));
    }

    @Test
    void undoAddAndUndoCannotRepeat() throws Exception {
        String id = add("A", "0");
        long ev = latestEvent();
        undo(ev, 204);
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(jsonPath("$.length()").value(0));
        undo(ev, 409);
        mvc.perform(auth(get(base + "/events?limit=2"), who))
            .andExpect(jsonPath("$[0].summary").value("undid: added A to Day 1")).andExpect(jsonPath("$[0].undoable").value(false))
            .andExpect(jsonPath("$[1].undone").value(true));
        undo(latestEvent(), 409);
        assertThat(id).isNotBlank();
    }

    @Test
    void undoUpdateRestoresUnlessChangedAgain() throws Exception {
        String id = add("A", "0");
        mvc.perform(json(put(base + "/destinations/" + id), who, "{\"name\":\"A\",\"dayIndex\":1,\"locked\":true,\"version\":0}"));
        long lockEvent = latestEvent();
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].summary").value("moved A to Day 2"));
        undo(lockEvent, 204);
        mvc.perform(auth(get(base + "/destinations"), who))
            .andExpect(jsonPath("$[0].dayIndex").value(0)).andExpect(jsonPath("$[0].locked").value(false));

        mvc.perform(json(put(base + "/destinations/" + id), who, "{\"name\":\"A\",\"dayIndex\":0,\"locked\":true,\"version\":2}"));
        long locked = latestEvent();
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].summary").value("locked A"));
        mvc.perform(json(put(base + "/destinations/" + id), who, "{\"name\":\"A!\",\"dayIndex\":null,\"locked\":false,\"version\":3}"));
        mvc.perform(auth(get(base + "/events?limit=1"), who)).andExpect(jsonPath("$[0].summary").value("moved A! to Unscheduled"));
        undo(locked, 409);
    }

    @Test
    void undoRemoveRestoresSameRecord() throws Exception {
        String id = add("Senso-ji", "2");
        mvc.perform(auth(delete(base + "/destinations/" + id), who)).andExpect(status().isNoContent());
        undo(latestEvent(), 204);
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(jsonPath("$[0].id").value(id)).andExpect(jsonPath("$[0].dayIndex").value(2));
    }

    @Test
    void undoAddAfterItWasRemovedConflicts() throws Exception {
        String id = add("A", "0");
        long added = latestEvent();
        mvc.perform(auth(delete(base + "/destinations/" + id), who));
        undo(added, 409);
    }

    @Test
    void undoReorderOnlyIfDayUnchanged() throws Exception {
        String a = add("A", "0");
        String b = add("B", "0");
        String c = add("C", "0");
        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\",\"%s\",\"%s\"]}".formatted(c, b, a))).andExpect(status().isOk());
        long first = latestEvent();
        undo(first, 204);
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(jsonPath("$[0].name").value("A"));

        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\",\"%s\",\"%s\"]}".formatted(b, a, c)));
        long second = latestEvent();
        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\",\"%s\",\"%s\"]}".formatted(c, a, b)));
        undo(second, 409);
    }

    @Test
    void accessRules() throws Exception {
        add("A", "0");
        Login viewer = register();
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?, ?, 'VIEWER')", tripId, viewer.userId());
        mvc.perform(auth(get(base + "/events"), viewer)).andExpect(status().isOk());
        mvc.perform(auth(post(base + "/events/" + latestEvent() + "/undo"), viewer)).andExpect(status().isForbidden());
        mvc.perform(auth(get(base + "/events"), register())).andExpect(status().isNotFound());
        undo(999_999_999L, 404);
    }

    @Test
    void streamPushesChangesToViewers() throws Exception {
        MvcResult sse = mvc.perform(auth(get(base + "/stream"), who)).andExpect(request().asyncStarted()).andReturn();
        assertThat(stream.subscriberCount(tripId)).isEqualTo(1);
        add("A", "0");
        stream.heartbeat();
        String body = sse.getResponse().getContentAsString();
        assertThat(body).contains(":connected").contains("event:changed").contains(who.userId().toString()).contains(":ping");
        mvc.perform(auth(get(base + "/stream"), register())).andExpect(status().isNotFound());
    }
}
