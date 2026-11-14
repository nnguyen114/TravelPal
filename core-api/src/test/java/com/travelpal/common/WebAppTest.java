package com.travelpal.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;

/** The bundled web app (Render image): its routes are public, the API stays protected. */
class WebAppTest extends IntegrationTest {
    @Test
    void clientRoutesLoadTheAppWithoutSigningIn() throws Exception {
        for (String path : new String[] {"/login", "/signup", "/trips/abc", "/join/some-token"}) {
            mvc.perform(get(path)).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"))
                .andExpect(header().string("Content-Security-Policy", Matchers.containsString("frame-ancestors 'none'")));
        }
        mvc.perform(get("/api/trips")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    }
}
