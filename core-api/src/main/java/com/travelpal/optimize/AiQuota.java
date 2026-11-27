package com.travelpal.optimize;

import com.travelpal.common.Counters;
import java.time.Duration;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Per-user hourly caps on AI calls, so one account can't run up the Claude bill. */
@Component
public class AiQuota {
    public enum Kind {
        OPTIMIZE(30), ASSISTANT(60), DISCOVER(30), IMPORT(20);

        final int perHour;

        Kind(int perHour) {
            this.perHour = perHour;
        }
    }

    private final Counters counters;

    AiQuota(Counters counters) {
        this.counters = counters;
    }

    public void spend(UUID userId, Kind kind) {
        if (!counters.allow("ai:" + kind + ":" + userId, kind.perHour, Duration.ofHours(1))) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "You've hit the hourly AI limit. Try again later.");
        }
    }
}
