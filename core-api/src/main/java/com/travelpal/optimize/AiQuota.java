package com.travelpal.optimize;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Per-user hourly caps on AI calls, so one account can't run up the Claude bill. */
// ponytail: per-instance fixed window in memory; move to Redis once core-api runs more than one task.
@Component
public class AiQuota {
    public enum Kind {
        OPTIMIZE(30), ASSISTANT(60);

        final int perHour;

        Kind(int perHour) {
            this.perHour = perHour;
        }
    }

    private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
    private volatile long hour = currentHour();

    public void spend(UUID userId, Kind kind) {
        long now = currentHour();
        if (now != hour) {
            hour = now;
            counts.clear();
        }
        if (counts.computeIfAbsent(userId + ":" + kind, k -> new AtomicInteger()).incrementAndGet() > kind.perHour) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "You've hit the hourly AI limit. Try again later.");
        }
    }

    private static long currentHour() {
        return System.currentTimeMillis() / 3_600_000;
    }
}
