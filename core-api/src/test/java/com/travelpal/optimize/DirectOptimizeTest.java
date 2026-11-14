package com.travelpal.optimize;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.travelpal.IntegrationTest;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** No queue service (Render): jobs go straight to ai-service over HTTP and its answer settles the preview. */
@TestPropertySource(properties = "travelpal.ai.queue=http")
class DirectOptimizeTest extends IntegrationTest {
    @AfterEach
    void reset() {
        aiHandler = ex -> respond(ex, 500, "");
    }

    String startPreview(Login who) throws Exception {
        String base = "/api/trips/" + read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76}}"))
            .andReturn(), "$.id");
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Senso-ji\",\"lat\":35.71,\"lng\":139.79}")).andExpect(status().isCreated());
        String id = read(mvc.perform(json(post(base + "/optimize"), who, "{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}"))
            .andExpect(status().isAccepted()).andReturn(), "$.id");
        return base + "/previews/" + id;
    }

    String await(Login who, String preview, String status) throws Exception {
        for (int i = 0; i < 100; i++) {
            String body = mvc.perform(auth(get(preview), who)).andReturn().getResponse().getContentAsString();
            if (JsonPath.read(body, "$.status").equals(status)) {
                return body;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("preview never became " + status);
    }

    @Test
    void jobIsPostedToAiServiceAndItsAnswerSettlesThePreview() throws Exception {
        aiHandler = ex -> {
            try {
                String job = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                boolean ok = ex.getRequestURI().getPath().equals("/internal/optimize") && ex.getRequestHeaders().getFirst("Authorization").startsWith("Bearer ");
                String previewId = JsonPath.read(job, "$.previewId");
                respond(ex, ok ? 200 : 400, """
                    {"previewId":"%s","status":"READY","result":{"items":[],"scheduled":0,"total":1,"hints":[],"summary":"ok"}}""".formatted(previewId));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
        };
        Login who = register();
        await(who, startPreview(who), "READY");
    }

    @Test
    void anUnreachableAiServiceFailsThePreviewWithAPlainMessage() throws Exception {
        Login who = register();
        String body = await(who, startPreview(who), "FAILED");
        org.assertj.core.api.Assertions.assertThat(body).contains("The optimizer is unavailable right now");
    }
}
