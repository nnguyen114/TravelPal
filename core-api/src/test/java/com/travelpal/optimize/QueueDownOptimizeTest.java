package com.travelpal.optimize;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** SQS rejects the job (an invalid queue name stands in for an outage): the preview must settle as FAILED, not stay PENDING. */
@TestPropertySource(properties = "travelpal.ai.jobs-queue=not a valid queue!")
class QueueDownOptimizeTest extends IntegrationTest {
    @Test
    void aJobThatCannotBeQueuedFailsItsPreview() throws Exception {
        Login who = register();
        String base = "/api/trips/" + read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76}}"))
            .andReturn(), "$.id");
        String id = read(mvc.perform(json(post(base + "/optimize"), who, "{\"mode\":\"BALANCED\",\"scope\":\"TRIP\"}"))
            .andExpect(status().isAccepted()).andReturn(), "$.id");
        mvc.perform(auth(get(base + "/previews/" + id), who))
            .andExpect(jsonPath("$.status").value("FAILED"))
            .andExpect(jsonPath("$.error").value("Couldn't start the optimizer. Try again."));
    }
}
