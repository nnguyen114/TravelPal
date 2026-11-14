package com.travelpal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CoreApiApplicationTest {
    @Test
    void readsHostStyleDatabaseUrls() {
        assertThat(CoreApiApplication.fromDatabaseUrl("postgres://travel:p%40ss%3Aword@dpg-abc-a:5432/travelpal?sslmode=require"))
            .containsEntry("spring.datasource.url", "jdbc:postgresql://dpg-abc-a:5432/travelpal?sslmode=require")
            .containsEntry("spring.datasource.username", "travel")
            .containsEntry("spring.datasource.password", "p@ss:word");
        assertThat(CoreApiApplication.fromDatabaseUrl("postgresql://u:pw@host/db"))
            .containsEntry("spring.datasource.url", "jdbc:postgresql://host/db");
    }
}
