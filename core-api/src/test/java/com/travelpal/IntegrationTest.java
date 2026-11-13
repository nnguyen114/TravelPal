package com.travelpal;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
public abstract class IntegrationTest {
    @ServiceConnection
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine");

    static {
        POSTGRES.start();
    }

    @Autowired
    protected MockMvc mvc;

    public record Login(String token, UUID userId, String refreshCookie) {}

    /** Each caller gets its own client IP so the auth rate limiter doesn't trip across tests. */
    protected static RequestPostProcessor randomIp() {
        String ip = "10.%d.%d.%d".formatted(ThreadLocalRandom.current().nextInt(256), ThreadLocalRandom.current().nextInt(256),
            ThreadLocalRandom.current().nextInt(256));
        return r -> {
            r.setRemoteAddr(ip);
            return r;
        };
    }

    protected Login register() throws Exception {
        String email = "u" + UUID.randomUUID() + "@example.com";
        MvcResult r = mvc.perform(post("/api/auth/register").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"correct-horse-battery\",\"displayName\":\"Tester\"}".formatted(email)))
            .andExpect(status().isCreated()).andReturn();
        String body = r.getResponse().getContentAsString();
        return new Login(JsonPath.read(body, "$.accessToken"), UUID.fromString(JsonPath.read(body, "$.user.id")),
            r.getResponse().getCookie("tp_refresh").getValue());
    }

    protected static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, Login who, String body) {
        return auth(b, who).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    protected static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, Login who) {
        return b.header("Authorization", "Bearer " + who.token());
    }

    protected static String read(MvcResult r, String path) throws Exception {
        return JsonPath.read(r.getResponse().getContentAsString(), path).toString();
    }
}
