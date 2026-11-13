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
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.function.Consumer;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.localstack.LocalStackContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
public abstract class IntegrationTest {
    @ServiceConnection
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine");

    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    protected static final LocalStackContainer LOCALSTACK = new LocalStackContainer("localstack/localstack:4.9").withServices("sqs");

    /** Stand-in for ai-service's HTTP API; tests swap the handler. */
    protected static volatile Consumer<HttpExchange> aiHandler = ex -> respond(ex, 500, "");
    static final HttpServer FAKE_AI;

    static {
        POSTGRES.start();
        REDIS.start();
        LOCALSTACK.start();
        try {
            FAKE_AI = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        FAKE_AI.createContext("/", ex -> aiHandler.accept(ex));
        FAKE_AI.start();
    }

    @DynamicPropertySource
    static void aiProps(DynamicPropertyRegistry r) {
        r.add("travelpal.ai.sqs-endpoint", () -> LOCALSTACK.getEndpoint().toString());
        r.add("travelpal.ai.region", LOCALSTACK::getRegion);
        r.add("travelpal.ai.service-url", () -> "http://127.0.0.1:" + FAKE_AI.getAddress().getPort());
    }

    protected static void respond(HttpExchange ex, int status, String body) {
        try (ex) {
            byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "text/event-stream");
            ex.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) {
                ex.getResponseBody().write(bytes);
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
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
