package com.travelpal.assistant;

import com.travelpal.optimize.AiProperties;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Calls ai-service's internal API with a short-lived service token. Non-200 or unreachable -> 503. */
@Component
public class AiServiceClient {
    private static final Logger log = LoggerFactory.getLogger(AiServiceClient.class);
    // HTTP/1.1: the default h2c upgrade attempt on plain HTTP is rejected by uvicorn.
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
    private final InternalTokens tokens;
    private final AiProperties props;

    AiServiceClient(InternalTokens tokens, AiProperties props) {
        this.tokens = tokens;
        this.props = props;
    }

    /** POSTs JSON and returns the open response body; the caller must close it. */
    public InputStream post(String path, String json, UUID user, Duration timeout, String what) throws InterruptedException {
        HttpResponse<InputStream> res;
        try {
            // Tolerate a trailing slash in AI_SERVICE_URL ("https://ai.example.com/" + "/internal/...").
            String base = props.serviceUrl().replaceAll("/+$", "");
            res = http.send(HttpRequest.newBuilder(URI.create(base + path))
                .header("Authorization", "Bearer " + tokens.issue(user)).header("Content-Type", "application/json")
                .timeout(timeout).POST(HttpRequest.BodyPublishers.ofString(json)).build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            log.warn("ai-service unreachable at {}: check AI_SERVICE_URL", props.serviceUrl(), e);
            throw unavailable(what);
        }
        if (res.statusCode() != 200) {
            log.warn("ai-service answered {} for {}{}", res.statusCode(), path, res.statusCode() == 401
                ? ": it rejected our service token. INTERNAL_JWT_PUBLIC_KEY on the AI service must be the public half of"
                    + " INTERNAL_JWT_PRIVATE_JWK here (generate both together with deploy/render/make-keys.sh)" : "");
            try (InputStream ignored = res.body()) { // release the connection
            } catch (IOException ignored) { // nothing to recover
            }
            throw unavailable(what);
        }
        return res.body();
    }

    private static ResponseStatusException unavailable(String what) {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, what + " is unavailable right now.");
    }
}
