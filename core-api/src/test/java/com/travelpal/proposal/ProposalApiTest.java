package com.travelpal.proposal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.travelpal.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class ProposalApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    Login owner;
    Login viewer;
    String base;
    String sensoji;
    String dinner;

    @BeforeEach
    void trip() throws Exception {
        owner = register();
        viewer = register();
        String id = read(mvc.perform(json(post("/api/trips"), owner,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id");
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", id, viewer.userId());
        base = "/api/trips/" + id;
        sensoji = place("{\"name\":\"Senso-ji\",\"dayIndex\":2}");
        dinner = place("{\"name\":\"Dinner\",\"dayIndex\":0,\"startTime\":\"19:00\",\"locked\":true}");
    }

    @AfterEach
    void reset() {
        aiHandler = ex -> respond(ex, 500, "");
    }

    String place(String body) throws Exception {
        return read(mvc.perform(json(post(base + "/destinations"), owner, body)).andExpect(status().isCreated()).andReturn(), "$.id");
    }

    String propose(Login who, String changes) throws Exception {
        return read(mvc.perform(json(post(base + "/proposals"), who,
                "{\"title\":\"Add Tsukiji\",\"description\":\"Breakfast before Senso-ji?\",\"changes\":" + changes + "}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("OPEN")).andReturn(), "$.id");
    }

    @Test
    void listPagesNewestFirstByStatusWithCounts() throws Exception {
        String first = propose(owner, "[{\"kind\":\"ADD\",\"name\":\"A\"}]");
        String second = propose(owner, "[{\"kind\":\"ADD\",\"name\":\"B\"}]");
        String closed = propose(owner, "[{\"kind\":\"ADD\",\"name\":\"C\"}]");
        mvc.perform(auth(post(base + "/proposals/" + closed + "/close"), owner)).andExpect(status().isOk());
        mvc.perform(auth(get(base + "/proposals/counts"), viewer))
            .andExpect(jsonPath("$.OPEN").value(2)).andExpect(jsonPath("$.CLOSED").value(1)).andExpect(jsonPath("$.MERGED").value(0));

        var page1 = mvc.perform(auth(get(base + "/proposals?status=OPEN&limit=1"), viewer))
            .andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].id").value(second)).andReturn();
        String next = "&before=" + read(page1, "$[0].createdAt") + "&beforeId=" + second;
        mvc.perform(auth(get(base + "/proposals?status=OPEN&limit=1" + next), viewer))
            .andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].id").value(first));
        mvc.perform(auth(get(base + "/proposals?status=CLOSED"), viewer)).andExpect(jsonPath("$[0].id").value(closed));
        mvc.perform(auth(get(base + "/proposals?status=NOPE"), viewer)).andExpect(status().isBadRequest());
        mvc.perform(auth(get(base + "/proposals/counts"), register())).andExpect(status().isNotFound());
    }

    @Test
    void viewerProposesEveryoneDiscussesEditorMerges() throws Exception {
        String id = propose(viewer, "[{\"kind\":\"ADD\",\"name\":\"Tsukiji Outer Market\",\"dayIndex\":2,\"startTime\":\"08:00\"},"
            + "{\"kind\":\"MOVE\",\"destinationId\":\"" + sensoji + "\",\"dayIndex\":1}]");
        mvc.perform(auth(get(base + "/proposals"), owner)).andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].authorName").value("Tester")).andExpect(jsonPath("$[0].affectedDays[0]").value(1))
            .andExpect(jsonPath("$[0].affectedDays[1]").value(2)).andExpect(jsonPath("$[0].comments").doesNotExist())
            .andExpect(jsonPath("$[0].changes[1].name").value("Senso-ji")).andExpect(jsonPath("$[0].changes[1].fromDay").value(2));

        mvc.perform(json(post(base + "/proposals/" + id + "/comments"), owner, "{\"body\":\"In, keep the slow morning\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.comments[0].body").value("In, keep the slow morning"))
            .andExpect(jsonPath("$.commentCount").value(1));
        mvc.perform(json(post(base + "/proposals/" + id + "/comments"), viewer, "{\"body\":\"\"}")).andExpect(status().isBadRequest());

        mvc.perform(auth(post(base + "/proposals/" + id + "/merge"), viewer)).andExpect(status().isForbidden());
        mvc.perform(auth(post(base + "/proposals/" + id + "/merge"), owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("MERGED"));
        mvc.perform(auth(get(base + "/destinations"), owner))
            .andExpect(jsonPath("$[?(@.name=='Tsukiji Outer Market')].dayIndex").value(2))
            .andExpect(jsonPath("$[?(@.name=='Tsukiji Outer Market')].startTime").value("08:00:00"))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].dayIndex").value(1));
        mvc.perform(auth(get(base + "/events?limit=2"), owner)).andExpect(jsonPath("$[0].summary").value("moved Senso-ji to Day 2"));
        mvc.perform(auth(post(base + "/proposals/" + id + "/merge"), owner)).andExpect(status().isConflict());
    }

    @Test
    void staleProposalsCannotMergeAndRemovalsWork() throws Exception {
        String stale = propose(owner, "[{\"kind\":\"MOVE\",\"destinationId\":\"" + sensoji + "\",\"dayIndex\":0}]");
        String remove = propose(owner, "[{\"kind\":\"REMOVE\",\"destinationId\":\"" + dinner + "\"}]");
        mvc.perform(json(put(base + "/destinations/" + sensoji), owner, "{\"name\":\"Senso-ji!\",\"dayIndex\":2,\"version\":0}"));
        mvc.perform(auth(get(base + "/proposals/" + stale), owner)).andExpect(jsonPath("$.stale").value(true))
            .andExpect(jsonPath("$.changes[0].name").value("Senso-ji!"));
        mvc.perform(auth(post(base + "/proposals/" + stale + "/merge"), owner)).andExpect(status().isConflict());
        mvc.perform(auth(post(base + "/proposals/" + remove + "/merge"), owner)).andExpect(status().isOk());
        mvc.perform(auth(get(base + "/destinations"), owner)).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(auth(get(base + "/proposals/" + stale), owner)).andExpect(jsonPath("$.changes[0].name").value("Senso-ji!"));
    }

    @Test
    void authorsAndEditorsClose() throws Exception {
        String mine = propose(viewer, "[{\"kind\":\"ADD\",\"name\":\"A\"}]");
        String theirs = propose(owner, "[{\"kind\":\"ADD\",\"name\":\"B\"}]");
        mvc.perform(auth(post(base + "/proposals/" + theirs + "/close"), viewer)).andExpect(status().isForbidden());
        mvc.perform(auth(post(base + "/proposals/" + mine + "/close"), viewer)).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("CLOSED")).andExpect(jsonPath("$.closedAt").exists());
        mvc.perform(auth(post(base + "/proposals/" + theirs + "/close"), owner)).andExpect(status().isOk());
        mvc.perform(auth(post(base + "/proposals/" + mine + "/close"), owner)).andExpect(status().isConflict());
    }

    @Test
    void validationAndAccess() throws Exception {
        String bad = "{\"title\":\"x\",\"changes\":%s}";
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"kind\":\"ADD\"}]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"name\":\"x\"}]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"kind\":\"ADD\",\"name\":\"x\",\"dayIndex\":7}]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"kind\":\"ADD\",\"name\":\"x\",\"lat\":999}]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"kind\":\"ADD\",\"name\":\"x\",\"durationMin\":-5}]"))).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, bad.formatted("[{\"kind\":\"REMOVE\",\"destinationId\":\"" + UUID.randomUUID() + "\"}]")))
            .andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/proposals"), owner, "{\"title\":\"\",\"changes\":[{\"kind\":\"ADD\",\"name\":\"x\"}]}")).andExpect(status().isBadRequest());
        Login stranger = register();
        mvc.perform(auth(get(base + "/proposals"), stranger)).andExpect(status().isNotFound());
        mvc.perform(auth(get(base + "/proposals/" + UUID.randomUUID()), owner)).andExpect(status().isNotFound());
    }

    @Test
    void impactCheckCallsAiServiceAndIsStored() throws Exception {
        String id = propose(viewer, "[{\"kind\":\"ADD\",\"name\":\"Tsukiji\",\"dayIndex\":2}]");
        AtomicReference<String> sent = new AtomicReference<>();
        aiHandler = ex -> {
            try {
                sent.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
            respond(ex, 200, "{\"fits\":\"Yes: Tsukiji on Day 3 at 08:00\",\"conflicts\":\"None with locks\",\"dayEffect\":\"Senso-ji moves to 10:00\"}");
        };
        mvc.perform(auth(post(base + "/proposals/" + id + "/impact"), viewer)).andExpect(status().isOk())
            .andExpect(jsonPath("$.impact.fits").value("Yes: Tsukiji on Day 3 at 08:00"))
            .andExpect(jsonPath("$.impactByName").value("Tester"));
        assertThat((String) JsonPath.read(sent.get(), "$.changes[0].name")).isEqualTo("Tsukiji");
        assertThat((String) JsonPath.read(sent.get(), "$.trip.destinations[0].name")).isNotBlank();
        mvc.perform(auth(get(base + "/proposals"), owner)).andExpect(jsonPath("$[0].impact.dayEffect").value("Senso-ji moves to 10:00"));

        aiHandler = ex -> respond(ex, 500, "");
        mvc.perform(auth(post(base + "/proposals/" + id + "/impact"), viewer)).andExpect(status().isServiceUnavailable());
    }
}
