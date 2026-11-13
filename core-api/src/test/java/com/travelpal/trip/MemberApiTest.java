package com.travelpal.trip;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class MemberApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    Login owner;
    Login mina;
    String base;

    @BeforeEach
    void trip() throws Exception {
        owner = register();
        mina = register();
        String id = read(mvc.perform(json(post("/api/trips"), owner,
                "{\"name\":\"T\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}")).andReturn(), "$.id");
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'EDITOR')", id, mina.userId());
        base = "/api/trips/" + id;
    }

    String role(Login who) {
        return "/members/" + who.userId();
    }

    @Test
    void ownerManagesRoles() throws Exception {
        mvc.perform(json(put(base + role(mina)), owner, "{\"role\":\"VIEWER\"}")).andExpect(status().isNoContent());
        mvc.perform(auth(get(base), mina)).andExpect(jsonPath("$.role").value("VIEWER"));
        mvc.perform(json(put(base + role(owner)), mina, "{\"role\":\"OWNER\"}")).andExpect(status().isForbidden());
        mvc.perform(json(put(base + role(owner)), owner, "{\"role\":\"VIEWER\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(put(base + "/members/" + UUID.randomUUID()), owner, "{\"role\":\"VIEWER\"}")).andExpect(status().isNotFound());
        mvc.perform(json(put(base + role(mina)), owner, "{}")).andExpect(status().isBadRequest());
    }

    @Test
    void membersLeaveOwnersRemoveAndLastOwnerStays() throws Exception {
        Login kenji = register();
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", base.substring(11), kenji.userId());
        mvc.perform(auth(delete(base + role(owner)), mina)).andExpect(status().isForbidden());
        mvc.perform(auth(delete(base + role(owner)), owner)).andExpect(status().isBadRequest());

        mvc.perform(auth(delete(base + role(kenji)), kenji)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base), kenji)).andExpect(status().isNotFound());
        mvc.perform(auth(delete(base + role(mina)), owner)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base), mina)).andExpect(status().isNotFound());
    }

    @Test
    void ownerCanLeaveOnceAnotherOwnerExists() throws Exception {
        mvc.perform(json(put(base + role(mina)), owner, "{\"role\":\"OWNER\"}")).andExpect(status().isNoContent());
        mvc.perform(auth(delete(base + role(owner)), owner)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base), mina)).andExpect(jsonPath("$.members.length()").value(1));
    }

    @Test
    void deletingAnAccountHandsSharedTripsOnAndDeletesSoloOnes() throws Exception {
        String solo = read(mvc.perform(json(post("/api/trips"), owner,
                "{\"name\":\"Solo\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Kyoto\"}}")).andReturn(), "$.id");
        mvc.perform(json(delete("/api/me"), owner, "{\"password\":\"correct-horse-battery\"}")).andExpect(status().isNoContent());

        mvc.perform(auth(get(base), mina)).andExpect(jsonPath("$.role").value("OWNER")).andExpect(jsonPath("$.members.length()").value(1));
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject("select count(*) from trip where id = ?::uuid", Long.class, solo)).isZero();
    }
}
