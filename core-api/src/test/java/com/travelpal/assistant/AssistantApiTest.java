package com.travelpal.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.travelpal.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.test.web.servlet.MvcResult;

class AssistantApiTest extends IntegrationTest {
    Login who;
    String base;
    final AtomicReference<String> seenBody = new AtomicReference<>();
    final AtomicReference<String> seenAuth = new AtomicReference<>();

    @BeforeEach
    void trip() throws Exception {
        who = register();
        base = "/api/trips/" + read(mvc.perform(json(post("/api/trips"), who,
            "{\"name\":\"Japan\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id");
        mvc.perform(json(post(base + "/destinations"), who, "{\"name\":\"Senso-ji\",\"dayIndex\":0,\"startTime\":\"09:30\"}"));
        aiHandler = ex -> {
            seenAuth.set(ex.getRequestHeaders().getFirst("Authorization"));
            try {
                seenBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
            respond(ex, 200, "event: text\ndata: {\"text\":\"Day 1 is light.\"}\n\nevent: done\ndata: {}\n\n");
        };
    }

    @AfterEach
    void reset() {
        aiHandler = ex -> respond(ex, 500, "");
    }

    static final String ASK = "{\"messages\":[{\"role\":\"user\",\"content\":\"How full is day 1?\"}]}";

    @Test
    void relaysTheStreamWithTripContextAndAVerifiableServiceToken() throws Exception {
        MvcResult started = mvc.perform(json(post(base + "/assistant"), who, ASK)).andExpect(request().asyncStarted()).andReturn();
        String body = mvc.perform(asyncDispatch(started)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).contains("event: text").contains("Day 1 is light.");

        assertThat((String) JsonPath.read(seenBody.get(), "$.trip.trip.name")).isEqualTo("Japan");
        assertThat((String) JsonPath.read(seenBody.get(), "$.trip.destinations[0].startTime")).isEqualTo("09:30");
        assertThat((String) JsonPath.read(seenBody.get(), "$.messages[0].content")).isEqualTo("How full is day 1?");

        String jwks = mvc.perform(get("/.well-known/internal-jwks.json")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(jwks).doesNotContain("\"d\"");  // public key only
        Jwt token = NimbusJwtDecoder.withJwkSource(new ImmutableJWKSet<>(JWKSet.parse(jwks)))
            .jwsAlgorithm(org.springframework.security.oauth2.jose.jws.SignatureAlgorithm.ES256).build()
            .decode(seenAuth.get().substring("Bearer ".length()));
        assertThat(token.getAudience()).containsExactly("ai-service");
        assertThat(token.getClaimAsString("iss")).isEqualTo("core-api");
        assertThat(token.getSubject()).isEqualTo(who.userId().toString());
    }

    @Test
    void upstreamFailuresBecome503() throws Exception {
        aiHandler = ex -> respond(ex, 503, "");
        mvc.perform(json(post(base + "/assistant"), who, ASK)).andExpect(status().isServiceUnavailable());
    }

    @Test
    void accessAndValidation() throws Exception {
        mvc.perform(json(post(base + "/assistant"), register(), ASK)).andExpect(status().isNotFound());
        mvc.perform(json(post(base + "/assistant"), who, "{\"messages\":[]}")).andExpect(status().isBadRequest());
        mvc.perform(json(post(base + "/assistant"), who, "{\"messages\":[{\"role\":\"system\",\"content\":\"x\"}]}")).andExpect(status().isBadRequest());
    }
}
