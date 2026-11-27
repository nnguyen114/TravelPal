package com.travelpal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.destination.DestinationService;
import com.travelpal.trip.TripService;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Two writes to one trip at the same moment: the second must see what the first committed. */
class TripRacesTest extends IntegrationTest {
    @Autowired TripService trips;
    @Autowired DestinationService destinations;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;

    Login owner;
    UUID tripId;
    String base;

    @BeforeEach
    void trip() throws Exception {
        owner = register();
        base = "/api/trips/" + read(mvc.perform(json(post("/api/trips"), owner,
            "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-11\",\"destination\":{\"name\":\"Tokyo\",\"lat\":35.68,\"lng\":139.76}}"))
            .andReturn(), "$.id");
        tripId = UUID.fromString(base.substring(11));
    }

    /**
     * Runs {@code first} in a transaction that stays open while {@code second} starts in its own, then commits.
     * Returns what {@code second} threw (null if it succeeded).
     */
    Throwable race(Runnable first, Runnable second) throws Exception {
        CompletableFuture<Throwable> outcome = new CompletableFuture<>();
        tx.executeWithoutResult(s -> {
            first.run();
            Thread.ofVirtual().start(() -> {
                try {
                    tx.executeWithoutResult(s2 -> second.run());
                    outcome.complete(null);
                } catch (Throwable e) {
                    outcome.complete(e);
                }
            });
            try {
                Thread.sleep(500); // long enough for second to reach the trip; without the lock it finishes here
            } catch (InterruptedException e) {
                throw new IllegalStateException(e);
            }
        });
        return outcome.get(10, TimeUnit.SECONDS);
    }

    void member(Login who, String role) {
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?, ?, ?)", tripId, who.userId(), role);
    }

    @Test
    void twoOwnersLeavingAtOnceLeaveOneOwner() throws Exception {
        Login second = register();
        member(second, "OWNER");
        member(register(), "EDITOR");
        Throwable e = race(() -> trips.removeMember(owner.userId(), tripId, owner.userId()),
            () -> trips.removeMember(second.userId(), tripId, second.userId()));
        assertThat(e).isInstanceOf(ResponseStatusException.class).hasMessageContaining("Make someone else an owner first");
        assertThat(jdbc.queryForObject("select count(*) from trip_member where trip_id = ? and role = 'OWNER'", Long.class, tripId)).isEqualTo(1);
    }

    @Test
    void aMoveOntoADayBeingRemovedIsRejected() throws Exception {
        UUID stop = UUID.fromString(read(mvc.perform(json(post(base + "/destinations"), owner, "{\"name\":\"Idea\"}"))
            .andExpect(status().isCreated()).andReturn(), "$.id"));
        Throwable e = race(() -> trips.update(owner.userId(), tripId, "T", LocalDate.of(2027, 6, 10), LocalDate.of(2027, 6, 10)),
            () -> destinations.move(owner.userId(), tripId, stop, 0, 1, null));
        assertThat(e).isInstanceOf(ResponseStatusException.class).hasMessageContaining("Day is outside the trip");
        assertThat(jdbc.queryForObject("select day_index from destination where id = ?", Integer.class, stop)).isNull();
    }

    @Test
    void shorteningATripInvalidatesEditsBasedOnTheOldPlacement() throws Exception {
        String stop = read(mvc.perform(json(post(base + "/destinations"), owner, "{\"name\":\"Day 2 stop\",\"dayIndex\":1}"))
            .andExpect(status().isCreated()).andReturn(), "$.id");
        mvc.perform(json(put(base), owner, "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-10\"}")).andExpect(status().isOk());
        // An Undo (or edit) made before the dates changed carries version 0; the stop has moved since.
        mvc.perform(auth(delete(base + "/destinations/" + stop + "?version=0"), owner)).andExpect(status().isConflict());
    }
}
