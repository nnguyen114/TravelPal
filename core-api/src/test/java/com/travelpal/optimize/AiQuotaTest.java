package com.travelpal.optimize;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class AiQuotaTest {
    @Test
    void capsEachUserAndKindPerHour() {
        AiQuota q = new AiQuota();
        UUID u = UUID.randomUUID();
        for (int i = 0; i < AiQuota.Kind.OPTIMIZE.perHour; i++) {
            q.spend(u, AiQuota.Kind.OPTIMIZE);
        }
        assertThatThrownBy(() -> q.spend(u, AiQuota.Kind.OPTIMIZE)).isInstanceOf(ResponseStatusException.class).hasMessageContaining("429");
        q.spend(u, AiQuota.Kind.ASSISTANT);
        q.spend(UUID.randomUUID(), AiQuota.Kind.OPTIMIZE);
    }
}
