package com.travelpal.history;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Pushes "changed" to everyone viewing a trip so they refetch the latest shared state. */
// ponytail: subscribers live in this instance's memory; fan out through Redis pub/sub once core-api runs >1 task.
@Component
public class TripStream {
    static final long TIMEOUT_MS = 30 * 60 * 1000;
    private final Map<UUID, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();

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
        Set<SseEmitter> set = subscribers.getOrDefault(change.tripId(), Set.of());
        for (SseEmitter e : set) {
            send(set, e, SseEmitter.event().name("changed").data(Map.of("actorId", String.valueOf(change.actorId()))));
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
