package com.travelpal.common;

import java.time.Duration;
import java.util.Objects;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Fixed-window counters in Redis, shared by every core-api task: rate limits and quotas. */
@Component
public class Counters {
    private final StringRedisTemplate redis;

    Counters(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Counts one hit for {@code key}; false once it has more than {@code limit} hits in the current window. */
    public boolean allow(String key, int limit, Duration window) {
        String k = "count:" + key + ":" + System.currentTimeMillis() / window.toMillis();
        long n = Objects.requireNonNull(redis.opsForValue().increment(k));
        if (n == 1) {
            redis.expire(k, window);
        }
        return n <= limit;
    }
}
