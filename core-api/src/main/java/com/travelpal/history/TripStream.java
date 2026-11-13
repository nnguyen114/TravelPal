package com.travelpal.history;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Pushes "changed" to everyone viewing a trip so they refetch the latest shared state. Each core-api task holds its
 * own viewers' connections; changes go out over Redis pub/sub so every task hears about every change.
 */
@Component
public class TripStream implements MessageListener {
    static final long TIMEOUT_MS = 30 * 60 * 1000;
    public static final String CHANNEL = "trip-changed";
    private final Map<UUID, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();
    private final StringRedisTemplate redis;

    TripStream(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public SseEmitter subscribe(UUID tripId) {
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        Set<SseEmitter> set = subscribers.computeIfAbsent(tripId, k -> ConcurrentHashMap.newKeySet());
        set.add(emitter);
        Runnable remove = () -> set.remove(emitter);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(e -> remove.run());
        send(set, emitter, SseEmitter.event().comment("connected"));
        return emitter;
    }

    @TransactionalEventListener(fallbackExecution = true)
    void onChange(History.Changed change) {
        redis.convertAndSend(CHANNEL, change.tripId() + " " + change.actorId());
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String[] parts = new String(message.getBody(), StandardCharsets.UTF_8).split(" ");
        Set<SseEmitter> set = subscribers.getOrDefault(UUID.fromString(parts[0]), Set.of());
        for (SseEmitter e : set) {
            send(set, e, SseEmitter.event().name("changed").data(Map.of("actorId", parts[1])));
        }
    }

    /** Keeps idle connections open through load balancers (ALB idles out at 60s). */
    @Scheduled(fixedRate = 25_000)
    void heartbeat() {
        subscribers.values().forEach(set -> set.forEach(e -> send(set, e, SseEmitter.event().comment("ping"))));
    }

    int subscriberCount(UUID tripId) {
        return subscribers.getOrDefault(tripId, Set.of()).size();
    }

    private static void send(Set<SseEmitter> set, SseEmitter e, SseEmitter.SseEventBuilder event) {
        try {
            e.send(event);
        } catch (IOException | IllegalStateException ex) {
            set.remove(e);
        }
    }
}
