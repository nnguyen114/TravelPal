package com.travelpal.destination;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DestinationApiTest extends IntegrationTest {
    Login who;
    String base;

    @BeforeEach
    void trip() throws Exception {
        who = register();
        String id = read(mvc.perform(json(post("/api/trips"), who,
                "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}"))
            .andExpect(status().isCreated()).andReturn(), "$.id");
        base = "/api/trips/" + id;
    }

    String add(String name, String day) throws Exception {
        return read(mvc.perform(json(post(base + "/destinations"), who,
                "{\"name\":\"%s\",\"dayIndex\":%s,\"durationMin\":60,\"lat\":35.6,\"lng\":139.7}".formatted(name, day)))
            .andExpect(status().isCreated()).andReturn(), "$.id");
    }

    @Test
    void scheduleUnscheduleAndList() throws Exception {
        String a = add("Meiji Jingu", "0");
        String b = add("Cat Street", "0");
        add("Idea", "null");
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(3)))
            .andExpect(jsonPath("$[0].name").value("Meiji Jingu")).andExpect(jsonPath("$[0].position").value(0))
            .andExpect(jsonPath("$[1].position").value(1))
            .andExpect(jsonPath("$[2].dayIndex").doesNotExist());

        // move b to day 1 with a fixed time and lock
        mvc.perform(json(put(base + "/destinations/" + b), who,
                "{\"name\":\"Cat Street\",\"dayIndex\":1,\"startTime\":\"12:00\",\"locked\":true,\"flexibility\":\"FIXED\",\"version\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.dayIndex").value(1)).andExpect(jsonPath("$.position").value(0))
            .andExpect(jsonPath("$.locked").value(true)).andExpect(jsonPath("$.flexibility").value("FIXED"));
        // same day keeps position; unschedule clears it
        mvc.perform(json(put(base + "/destinations/" + a), who, "{\"name\":\"Meiji\",\"dayIndex\":0,\"version\":0}"))
            .andExpect(jsonPath("$.position").value(0)).andExpect(jsonPath("$.flexibility").value("FLEXIBLE"));
        mvc.perform(json(put(base + "/destinations/" + a), who, "{\"name\":\"Meiji\",\"dayIndex\":null,\"version\":1}"))
            .andExpect(jsonPath("$.position").doesNotExist());
        mvc.perform(auth(delete(base + "/destinations/" + a), who)).andExpect(status().isNoContent());
        mvc.perform(auth(delete(base + "/destinations/" + a), who)).andExpect(status().isNotFound());
    }

    @Test
    void staleOrMissingVersionIsRejected() throws Exception {
        String a = add("A", "0");
        mvc.perform(json(put(base + "/destinations/" + a), who, "{\"name\":\"A2\",\"version\":0}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.version").value(1));
        // a second editor still holding version 0 must not overwrite
        mvc.perform(json(put(base + "/destinations/" + a), who, "{\"name\":\"A3\",\"version\":0}")).andExpect(status().isConflict());
        mvc.perform(json(put(base + "/destinations/" + a), who, "{\"name\":\"A3\"}")).andExpect(status().isConflict());
    }

    @Test
    void travelersCanSetBestTimesAndDayTrips() throws Exception {
        String id = read(mvc.perform(json(post(base + "/destinations"), who,
                "{\"name\":\"Golden Gai\",\"visitAfter\":\"20:00\",\"visitBefore\":\"23:30\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.hintsSource").value("USER"))
            .andExpect(jsonPath("$.visitBefore").value("23:30:00")).andReturn(), "$.id");
        mvc.perform(json(put(base + "/destinations/" + id), who, "{\"name\":\"Golden Gai\",\"dayTrip\":true,\"version\":0}"))
            .andExpect(jsonPath("$.dayTrip").value(true)).andExpect(jsonPath("$.visitAfter").doesNotExist());
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Plain\"}")).andExpect(jsonPath("$.hintsSource").doesNotExist());
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Bad\",\"visitAfter\":\"20:00\",\"visitBefore\":\"10:00\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void dayOutsideTripAndBadInputRejected() throws Exception {
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"X\",\"dayIndex\":3}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"X\",\"dayIndex\":-1}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"X\",\"lat\":120}")).andExpect(status().isBadRequest());
    }

    @Test
    void reorderNeedsExactSetOfTheDay() throws Exception {
        String a = add("A", "0");
        String b = add("B", "0");
        String c = add("C", "1");
        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\",\"%s\"]}".formatted(b, a)))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("B")).andExpect(jsonPath("$[1].position").value(1));
        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\",\"%s\"]}".formatted(b, c))).andExpect(status().isConflict());
        mvc.perform(json(put(base + "/days/0/order"), who, "{\"ids\":[\"%s\"]}".formatted(b))).andExpect(status().isConflict());
    }

    @Test
    void sameProviderPlaceCannotBeAddedTwice() throws Exception {
        String body = "{\"name\":\"Senso-ji\",\"providerId\":\"osm:N123\"}";
        mvc.perform(json(post(base + "/destinations"), who, body)).andExpect(status().isCreated());
        mvc.perform(json(post(base + "/destinations"), who, body)).andExpect(status().isConflict());
    }

    @Test
    void shorteningTripUnschedulesInsteadOfDeleting() throws Exception {
        String late = add("Late stop", "2");
        mvc.perform(json(put(base), who, "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\"}")).andExpect(status().isOk());
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(jsonPath("$[0].id").value(late))
            .andExpect(jsonPath("$[0].dayIndex").doesNotExist());
    }

    @Test
    void strangersCannotSeeOrEdit() throws Exception {
        Login stranger = register();
        mvc.perform(auth(get(base + "/destinations"), stranger)).andExpect(status().isNotFound());
        mvc.perform(json(post(base + "/destinations"), stranger, "{\"name\":\"X\"}")).andExpect(status().isNotFound());
    }
}
