package com.travelpal.optimize;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.travelpal.IntegrationTest;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;

class OptimizeApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    static final SqsClient SQS = SqsClient.builder().endpointOverride(URI.create(LOCALSTACK.getEndpoint().toString()))
        .region(Region.of(LOCALSTACK.getRegion()))
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test"))).build();

    Login who;
    String base;
    String a;
    String b;
    String locked;

    @BeforeEach
    void trip() throws Exception {
        who = register();
        base = "/api/trips/" + read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76}}"))
            .andReturn(), "$.id");
        a = add("{\"name\":\"Senso-ji\",\"lat\":35.71,\"lng\":139.79,\"dayIndex\":0}");
        b = add("{\"name\":\"Idea\",\"lat\":35.66,\"lng\":139.70}");
        locked = add("{\"name\":\"Dinner\",\"dayIndex\":1,\"startTime\":\"19:00\",\"locked\":true}");
    }

    String add(String body) throws Exception {
        return read(mvc.perform(json(post(base + "/destinations"), who, body)).andExpect(status().isCreated()).andReturn(), "$.id");
    }

    String request(String body) throws Exception {
        return read(mvc.perform(json(post(base + "/optimize"), who, body)).andExpect(status().isAccepted())
            .andExpect(jsonPath("$.status").value("PENDING")).andReturn(), "$.id");
    }

    String takeJob(String previewId) throws Exception {
        String url = SQS.getQueueUrl(r -> r.queueName("optimize-jobs")).queueUrl();
        for (int i = 0; i < 20; i++) {
            for (Message m : SQS.receiveMessage(r -> r.queueUrl(url).maxNumberOfMessages(10).waitTimeSeconds(1)).messages()) {
                SQS.deleteMessage(r -> r.queueUrl(url).receiptHandle(m.receiptHandle()));
                if (m.body().contains(previewId)) {
                    return m.body();
                }
            }
        }
        throw new AssertionError("job not queued");
    }

    void answer(String body) {
        String url = SQS.createQueue(r -> r.queueName("optimize-results")).queueUrl();
        SQS.sendMessage(r -> r.queueUrl(url).messageBody(body));
    }

    void awaitStatus(String previewId, String status) throws Exception {
        for (int i = 0; i < 100; i++) {
            String s = read(mvc.perform(auth(get(base + "/previews/" + previewId), who)).andReturn(), "$.status");
            if (s.equals(status)) {
                return;
            }
            Thread.sleep(200);
        }
        throw new AssertionError("preview never became " + status);
    }

    String plan(String previewId) {
        return plan(previewId, 1);
    }

    /** a -> Day 2, b -> Day 1; the locked dinner is placed on {@code lockedDay} (anything but Day 2 must be ignored). */
    String plan(String previewId, int lockedDay) {
        return """
            {"previewId":"%s","status":"READY","result":{"items":[
              {"id":"%s","dayIndex":1,"position":0,"startTime":"09:00"},
              {"id":"%s","dayIndex":0,"position":0,"startTime":"10:30"},
              {"id":"%s","dayIndex":%d,"position":1,"startTime":"19:00"}],
             "scheduled":3,"total":3,"moved":["%s"],"added":["%s"],"unscheduled":[],"keptLocked":["%s"],"needsReview":[],
             "explanation":"Grouped by area.","notes":[]}}""".formatted(previewId, a, b, locked, lockedDay, a, b, locked);
    }

    @Test
    void previewThenApplyThenUndo() throws Exception {
        String id = request("{\"mode\":\"RELAXED\",\"scope\":\"TRIP\",\"instructions\":\"slow mornings\"}");
        String job = takeJob(id);
        assertThat((List<?>) JsonPath.read(job, "$.destinations")).hasSize(3);
        assertThat((String) JsonPath.read(job, "$.mode")).isEqualTo("RELAXED");
        assertThat((String) JsonPath.read(job, "$.trip.startDate")).isEqualTo("2027-06-10");

        answer(plan(id));
        awaitStatus(id, "READY");
        mvc.perform(auth(get(base + "/previews/" + id), who)).andExpect(jsonPath("$.stale").value(false))
            .andExpect(jsonPath("$.result.explanation").value("Grouped by area."))
            .andExpect(jsonPath("$.request.mode").value("RELAXED")).andExpect(jsonPath("$.request.instructions").value("slow mornings"))
            .andExpect(jsonPath("$.request.destinations").doesNotExist());

        mvc.perform(auth(post(base + "/previews/" + id + "/apply"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base + "/destinations"), who))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].dayIndex").value(1))
            .andExpect(jsonPath("$[?(@.name=='Idea')].startTime").value("10:30:00"))
            .andExpect(jsonPath("$[?(@.name=='Dinner')].dayIndex").value(1))
            .andExpect(jsonPath("$[?(@.name=='Dinner')].position").value(1))   // locked stop may shift position only
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].position").value(0));
        mvc.perform(auth(get(base + "/previews/" + id), who)).andExpect(jsonPath("$.status").value("APPLIED"));
        mvc.perform(auth(post(base + "/previews/" + id + "/apply"), who)).andExpect(status().isConflict());

        String ev = read(mvc.perform(auth(get(base + "/events?limit=1"), who))
            .andExpect(jsonPath("$[0].summary").value("applied the optimizer (relaxed pace): 3 of 3 places scheduled"))
            .andExpect(jsonPath("$[0].undoable").value(true)).andReturn(), "$[0].id");
        mvc.perform(auth(post(base + "/events/" + ev + "/undo"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base + "/destinations"), who))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].dayIndex").value(0))
            .andExpect(jsonPath("$[?(@.name=='Idea')].dayIndex").value(org.hamcrest.Matchers.contains(org.hamcrest.Matchers.nullValue())));
    }

    @Test
    void aiTimingHintsAreSavedOnUntaggedPlacesOnly() throws Exception {
        mvc.perform(json(put(base + "/destinations/" + b), who,
            "{\"name\":\"Idea\",\"lat\":35.66,\"lng\":139.70,\"visitAfter\":\"15:00\",\"version\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.hintsSource").value("USER"));
        String id = request("{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}");
        String job = takeJob(id);
        assertThat((String) JsonPath.read(job, "$.destinations[?(@.name=='Idea')].visitAfter").toString()).contains("15:00");
        answer("""
            {"previewId":"%s","status":"READY","result":{"items":[],"scheduled":0,"total":0,"hints":[
              {"id":"%s","visitAfter":"20:00","visitBefore":null,"dayTrip":false},
              {"id":"%s","visitAfter":"21:00","visitBefore":null,"dayTrip":true}]}}""".formatted(id, a, b));
        awaitStatus(id, "READY");
        mvc.perform(auth(get(base + "/destinations"), who))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].visitAfter").value("20:00:00"))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].hintsSource").value("AI"))
            .andExpect(jsonPath("$[?(@.name=='Senso-ji')].version").value(0))       // editors' versions untouched
            .andExpect(jsonPath("$[?(@.name=='Idea')].visitAfter").value("15:00:00"))  // the traveler's choice wins
            .andExpect(jsonPath("$[?(@.name=='Idea')].dayTrip").value(false));
    }

    @Test
    void stalePreviewCannotBeApplied() throws Exception {
        String id = request("{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}");
        takeJob(id);
        add("{\"name\":\"Someone else's edit\"}");
        answer(plan(id));
        awaitStatus(id, "READY");
        mvc.perform(auth(get(base + "/previews/" + id), who)).andExpect(jsonPath("$.stale").value(true));
        mvc.perform(auth(post(base + "/previews/" + id + "/apply"), who)).andExpect(status().isConflict());
    }

    @Test
    void failuresDuplicatesAndDiscard() throws Exception {
        String id = request("{\"mode\":\"PACKED\",\"scope\":\"DAY\",\"dayIndex\":0}");
        takeJob(id);
        answer("{\"previewId\":\"%s\",\"status\":\"FAILED\",\"error\":\"boom\"}".formatted(id));
        awaitStatus(id, "FAILED");
        answer(plan(id)); // late duplicate is ignored
        Thread.sleep(1500);
        mvc.perform(auth(get(base + "/previews/" + id), who)).andExpect(jsonPath("$.status").value("FAILED"))
            .andExpect(jsonPath("$.error").value("boom"));
        mvc.perform(auth(post(base + "/previews/" + id + "/apply"), who)).andExpect(status().isConflict());

        String other = request("{\"mode\":\"BALANCED\",\"scope\":\"SELECTION\",\"destinationIds\":[\"%s\"]}".formatted(b));
        // The preview keeps which places were selected, so "re-run" fits the same places, not the whole trip.
        mvc.perform(auth(get(base + "/previews/" + other), who)).andExpect(jsonPath("$.request.scope").value("SELECTION"))
            .andExpect(jsonPath("$.request.destinationIds[0]").value(b));
        mvc.perform(auth(post(base + "/previews/" + other + "/discard"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base + "/previews/" + other), who)).andExpect(jsonPath("$.status").value("DISCARDED"));
        mvc.perform(auth(post(base + "/previews/" + other + "/discard"), who)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base + "/previews/" + UUID.randomUUID()), who)).andExpect(status().isNotFound());
    }

    @Test
    void validationAndAccess() throws Exception {
        mvc.perform(json(post(base + "/optimize"), who, "{\"mode\":\"BALANCED\",\"scope\":\"DAY\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/optimize"), who, "{\"mode\":\"BALANCED\",\"scope\":\"DAY\",\"dayIndex\":9}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/optimize"), who, "{\"mode\":\"BALANCED\",\"scope\":\"SELECTION\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/optimize"), who, "{\"scope\":\"TRIP\"}")).andExpect(status().isBadRequest());
        Login viewer = register();
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", base.substring(11), viewer.userId());
        mvc.perform(json(post(base + "/optimize"), viewer, "{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}")).andExpect(status().isForbidden());
        mvc.perform(json(post(base + "/optimize"), register(), "{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}")).andExpect(status().isNotFound());
        // a plan that tries to move a locked plan to another day is ignored for that stop
        String id = request("{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}");
        takeJob(id);
        answer(plan(id, 0));
        awaitStatus(id, "READY");
        mvc.perform(auth(post(base + "/previews/" + id + "/apply"), who)).andExpect(status().isNoContent());
        String ev = read(mvc.perform(auth(get(base + "/events?limit=1"), who)).andReturn(), "$[0].id");
        mvc.perform(auth(get(base + "/destinations"), who)).andExpect(jsonPath("$[?(@.name=='Dinner')].dayIndex").value(1));
        // a reorder after the plan makes undoing the plan refuse rather than overwrite it
        mvc.perform(json(put(base + "/days/1/order"), who, "{\"ids\":[\"%s\",\"%s\"]}".formatted(locked, a))).andExpect(status().isOk());
        mvc.perform(auth(post(base + "/events/" + ev + "/undo"), who)).andExpect(status().isConflict());
    }
}
