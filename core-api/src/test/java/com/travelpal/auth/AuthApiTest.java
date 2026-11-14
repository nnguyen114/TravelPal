package com.travelpal.auth;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.travelpal.IntegrationTest;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

class AuthApiTest extends IntegrationTest {
    private static final String COOKIE = "tp_refresh";

    @Test
    void registerSetsHardenedRefreshCookieAndMeWorks() throws Exception {
        String email = "Mixed" + System.nanoTime() + "@Example.com";
        mvc.perform(post("/api/auth/register").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"correct-horse-battery\",\"displayName\":\"Win\"}".formatted(email)))
            .andExpect(status().isCreated())
            .andExpect(header().string("Set-Cookie", containsString("HttpOnly")))
            .andExpect(header().string("Set-Cookie", containsString("SameSite=Strict")))
            .andExpect(header().string("Set-Cookie", containsString("Path=/api/auth")));

        Login who = register();
        mvc.perform(auth(get("/api/me"), who)).andExpect(status().isOk()).andExpect(jsonPath("$.displayName").value("Tester"));
        // email match is case-insensitive
        mvc.perform(post("/api/auth/login").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"correct-horse-battery\"}".formatted(email.toLowerCase())))
            .andExpect(status().isOk()).andExpect(jsonPath("$.accessToken").exists());
    }

    @Test
    void duplicateEmailIsConflict() throws Exception {
        String body = "{\"email\":\"dup%d@example.com\",\"password\":\"correct-horse-battery\",\"displayName\":\"A\"}".formatted(System.nanoTime());
        RequestPostProcessor ip = randomIp();
        mvc.perform(post("/api/auth/register").with(ip).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isCreated());
        mvc.perform(post("/api/auth/register").with(ip).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isConflict());
    }

    @Test
    void weakInputRejected() throws Exception {
        mvc.perform(post("/api/auth/register").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"not-an-email\",\"password\":\"short\",\"displayName\":\"\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void wrongPasswordAndUnknownEmailLookTheSame() throws Exception {
        register();
        for (String email : new String[] {"nobody@example.com", "u@example.com"}) {
            mvc.perform(post("/api/auth/login").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"%s\",\"password\":\"wrong-password-123\"}".formatted(email)))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.detail").value("Invalid email or password"));
        }
    }

    @Test
    void refreshRotatesAndReuseRevokesFamily() throws Exception {
        Login who = register();
        MvcResult first = mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie())))
            .andExpect(status().isOk()).andReturn();
        String rotated = first.getResponse().getCookie(COOKIE).getValue();

        // replaying the old token is treated as theft: it fails and kills the rotated one too
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, rotated))).andExpect(status().isUnauthorized());
    }

    @Test
    void logoutRevokesAndClearsCookie() throws Exception {
        Login who = register();
        mvc.perform(post("/api/auth/logout").cookie(new Cookie(COOKIE, who.refreshCookie())))
            .andExpect(status().isNoContent()).andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout")).andExpect(status().isNoContent());
    }

    @Test
    void refreshWithoutOrWithGarbageCookieIsUnauthorized() throws Exception {
        mvc.perform(post("/api/auth/refresh")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, "garbage"))).andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointsNeedValidToken() throws Exception {
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").header("Authorization", "Bearer not.a.jwt")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void loginIsRateLimitedPerIp() throws Exception {
        RequestPostProcessor ip = randomIp();
        for (int i = 0; i < 10; i++) {
            mvc.perform(post("/api/auth/login").with(ip).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"ip%d@example.com\",\"password\":\"whatever-123\"}".formatted(i))).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").with(ip).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"ip-last@example.com\",\"password\":\"whatever-123\"}"))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "60"));
    }

    @Test
    void loginIsRateLimitedPerAccountAcrossIps() throws Exception {
        String body = "{\"email\":\"target%d@example.com\",\"password\":\"guess-123456\"}".formatted(System.nanoTime());
        for (int i = 0; i < AuthService.LOGIN_ATTEMPTS; i++) {
            mvc.perform(post("/api/auth/login").with(randomIp()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").with(randomIp()).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void logoutEndsTheAccessTokenImmediately() throws Exception {
        Login who = register();
        Login otherDevice = login(who);
        mvc.perform(auth(get("/api/me"), who)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/logout").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/me"), who)).andExpect(status().isUnauthorized());
        // only this device's session ends
        mvc.perform(auth(get("/api/me"), otherDevice)).andExpect(status().isOk());
    }

    @Test
    void refreshReuseEndsTheAccessTokenToo() throws Exception {
        Login who = register();
        MvcResult r = mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isOk()).andReturn();
        Login rotated = new Login(com.jayway.jsonpath.JsonPath.read(r.getResponse().getContentAsString(), "$.accessToken"), who.userId(), null);
        mvc.perform(auth(get("/api/me"), rotated)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/me"), rotated)).andExpect(status().isUnauthorized());
    }

    @Test
    void aRefreshTokenWorksOnlyOnceEvenUnderConcurrency() throws Exception {
        Login who = register();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(6);
        var calls = new java.util.ArrayList<java.util.concurrent.Callable<Integer>>();
        for (int i = 0; i < 6; i++) {
            calls.add(() -> mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andReturn().getResponse().getStatus());
        }
        long ok = 0;
        for (var f : pool.invokeAll(calls)) {
            ok += f.get() == 200 ? 1 : 0;
        }
        pool.shutdown();
        org.assertj.core.api.Assertions.assertThat(ok).isLessThanOrEqualTo(1);
    }

    @Test
    void deleteAccountNeedsPasswordThenRemovesEverything() throws Exception {
        Login who = register();
        String wrong = "{\"password\":\"not-my-password\"}";
        mvc.perform(json(delete("/api/me"), who, wrong)).andExpect(status().isForbidden());

        mvc.perform(json(delete("/api/me"), who, "{\"password\":\"correct-horse-battery\"}"))
            .andExpect(status().isNoContent()).andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));
        mvc.perform(auth(get("/api/me"), who)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/refresh").cookie(new Cookie(COOKIE, who.refreshCookie()))).andExpect(status().isUnauthorized());
    }

    private Login login(Login who) throws Exception {
        String email = com.jayway.jsonpath.JsonPath.read(mvc.perform(auth(get("/api/me"), who)).andReturn().getResponse().getContentAsString(), "$.email");
        MvcResult r = mvc.perform(post("/api/auth/login").with(randomIp()).contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"%s\",\"password\":\"correct-horse-battery\"}".formatted(email))).andExpect(status().isOk()).andReturn();
        return new Login(com.jayway.jsonpath.JsonPath.read(r.getResponse().getContentAsString(), "$.accessToken"), who.userId(),
            r.getResponse().getCookie(COOKIE).getValue());
    }
}
