package com.travelpal.trip;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class TripApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;

    static final String TRIP = """
        {"name":"Japan 2027","startDate":"2027-06-10","endDate":"2027-06-17",
         "destination":{"name":"Tokyo","lat":35.68,"lng":139.76}}""";

    String createTrip(Login who) throws Exception {
        return read(mvc.perform(json(post("/api/trips"), who, TRIP))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.dayCount").value(8))
            .andExpect(jsonPath("$.role").value("OWNER"))
            .andExpect(jsonPath("$.cities[0].name").value("Tokyo"))
            .andExpect(jsonPath("$.members", hasSize(1)))
            .andReturn(), "$.id");
    }

    void addMember(String tripId, Login who, TripRole role) {
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, ?)", tripId, who.userId(), role.name());
    }

    @Test
    void ownerCreatesListsUpdatesAndDeletes() throws Exception {
        Login owner = register();
        String id = createTrip(owner);
        mvc.perform(auth(get("/api/trips"), owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].memberCount").value(1))
            .andExpect(jsonPath("$[0].cities[0]").value("Tokyo"));
        mvc.perform(json(put("/api/trips/" + id), owner, "{\"name\":\"Japan!\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.dayCount").value(3)).andExpect(jsonPath("$.name").value("Japan!"));
        mvc.perform(auth(delete("/api/trips/" + id), owner)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/trips/" + id), owner)).andExpect(status().isNotFound());
    }

    @Test
    void emptyDashboard() throws Exception {
        mvc.perform(auth(get("/api/trips"), register())).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void nonMemberGets404AndViewerCannotEdit() throws Exception {
        Login owner = register();
        Login stranger = register();
        Login viewer = register();
        Login editor = register();
        String id = createTrip(owner);
        addMember(id, viewer, TripRole.VIEWER);
        addMember(id, editor, TripRole.EDITOR);
        String update = "{\"name\":\"X\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-17\"}";

        mvc.perform(auth(get("/api/trips/" + id), stranger)).andExpect(status().isNotFound());
        mvc.perform(json(put("/api/trips/" + id), stranger, update)).andExpect(status().isNotFound());

        mvc.perform(auth(get("/api/trips/" + id), viewer)).andExpect(status().isOk()).andExpect(jsonPath("$.role").value("VIEWER"))
            .andExpect(jsonPath("$.members", hasSize(3)));
        mvc.perform(json(put("/api/trips/" + id), viewer, update)).andExpect(status().isForbidden());

        mvc.perform(json(put("/api/trips/" + id), editor, update)).andExpect(status().isOk());
        mvc.perform(auth(delete("/api/trips/" + id), editor)).andExpect(status().isForbidden());
    }

    @Test
    void invalidDatesRejected() throws Exception {
        Login who = register();
        mvc.perform(json(post("/api/trips"), who, TRIP.replace("2027-06-17", "2027-06-01"))).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips"), who, TRIP.replace("2027-06-17", "2027-09-30"))).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips"), who, "{\"name\":\"\"}")).andExpect(status().isBadRequest());
    }

    @Test
    void citiesWithDateAllocation() throws Exception {
        Login who = register();
        Login viewer = register();
        String id = createTrip(who);
        addMember(id, viewer, TripRole.VIEWER);
        String kyoto = "{\"name\":\"Kyoto\",\"startDate\":\"2027-06-14\",\"endDate\":\"2027-06-16\",\"locked\":true}";
        String cityId = read(mvc.perform(json(post("/api/trips/" + id + "/cities"), who, kyoto))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.locked").value(true)).andReturn(), "$.id");

        mvc.perform(json(put("/api/trips/" + id + "/cities/" + cityId), who, kyoto.replace("Kyoto", "Osaka")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Osaka"));
        mvc.perform(json(post("/api/trips/" + id + "/cities"), who, "{\"name\":\"Nara\",\"startDate\":\"2027-07-01\",\"endDate\":\"2027-07-02\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips/" + id + "/cities"), who, "{\"name\":\"Nara\",\"startDate\":\"2027-06-12\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips/" + id + "/cities"), who, "{\"name\":\"Nara\",\"startDate\":\"2027-06-12\",\"endDate\":\"2027-06-11\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/trips/" + id + "/cities"), viewer, kyoto)).andExpect(status().isForbidden());

        mvc.perform(auth(get("/api/trips/" + id), who)).andExpect(jsonPath("$.cities[1].name").value("Osaka"));
        mvc.perform(auth(delete("/api/trips/" + id + "/cities/" + cityId), who)).andExpect(status().isNoContent());
        mvc.perform(auth(delete("/api/trips/" + id + "/cities/" + cityId), who)).andExpect(status().isNotFound());
    }
}
