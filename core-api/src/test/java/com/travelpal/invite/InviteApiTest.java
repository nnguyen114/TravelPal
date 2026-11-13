package com.travelpal.invite;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class InviteApiTest extends IntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    Login owner;
    String tripId;

    @BeforeEach
    void trip() throws Exception {
        owner = register();
        tripId = read(mvc.perform(json(post("/api/trips"), owner,
                "{\"name\":\"Japan\",\"startDate\":\"2027-06-10\",\"endDate\":\"2027-06-12\",\"destination\":{\"name\":\"Tokyo\"}}"))
            .andReturn(), "$.id");
    }

    String invite(Login who) throws Exception {
        return read(mvc.perform(auth(post("/api/trips/" + tripId + "/invites"), who)).andExpect(status().isCreated())
            .andExpect(jsonPath("$.expiresAt").exists()).andReturn(), "$.token");
    }

    @Test
    void linkHolderPreviewsAndJoinsAsEditor() throws Exception {
        String token = invite(owner);
        Login friend = register();
        mvc.perform(auth(get("/api/invites/" + token), friend)).andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Japan")).andExpect(jsonPath("$.cities[0]").value("Tokyo"))
            .andExpect(jsonPath("$.memberCount").value(1)).andExpect(jsonPath("$.member").value(false));
        mvc.perform(auth(post("/api/invites/" + token + "/join"), friend)).andExpect(status().isOk())
            .andExpect(jsonPath("$.tripId").value(tripId));
        mvc.perform(auth(post("/api/invites/" + token + "/join"), friend)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/trips/" + tripId), friend)).andExpect(jsonPath("$.role").value("EDITOR"))
            .andExpect(jsonPath("$.members.length()").value(2));
        mvc.perform(auth(get("/api/invites/" + token), friend)).andExpect(jsonPath("$.member").value(true));
        // the owner joining via their own link keeps OWNER
        mvc.perform(auth(post("/api/invites/" + token + "/join"), owner)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/trips/" + tripId), owner)).andExpect(jsonPath("$.role").value("OWNER"));
        // and editors can make links too
        invite(friend);
    }

    @Test
    void onlyEditorsCreateAndOnlyOwnersRevoke() throws Exception {
        Login stranger = register();
        Login viewer = register();
        jdbc.update("insert into trip_member (trip_id, user_id, role) values (?::uuid, ?, 'VIEWER')", tripId, viewer.userId());
        mvc.perform(auth(post("/api/trips/" + tripId + "/invites"), stranger)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/trips/" + tripId + "/invites"), viewer)).andExpect(status().isForbidden());

        String token = invite(owner);
        String token2 = invite(owner);
        mvc.perform(auth(delete("/api/trips/" + tripId + "/invites"), viewer)).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/trips/" + tripId + "/invites"), owner)).andExpect(status().isNoContent());
        for (String t : new String[] {token, token2}) {
            mvc.perform(auth(get("/api/invites/" + t), stranger)).andExpect(status().isNotFound());
            mvc.perform(auth(post("/api/invites/" + t + "/join"), stranger)).andExpect(status().isNotFound());
        }
    }

    @Test
    void expiredAndUnknownLinksFail() throws Exception {
        String token = invite(owner);
        jdbc.update("update invite_link set expires_at = now() - interval '1 minute' where trip_id = ?::uuid", tripId);
        Login friend = register();
        mvc.perform(auth(post("/api/invites/" + token + "/join"), friend)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/invites/not-a-real-token"), friend)).andExpect(status().isNotFound());
        mvc.perform(get("/api/invites/" + token)).andExpect(status().isUnauthorized());
    }
}
