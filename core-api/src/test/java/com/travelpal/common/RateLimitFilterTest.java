package com.travelpal.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class RateLimitFilterTest {
    @Test
    void takesTheClientIpFromTheTrustedEdgeHeaderOnlyWhenConfigured() {
        var req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.1.5");
        req.addHeader("CloudFront-Viewer-Address", "198.51.100.10:46532");
        assertThat(new RateLimitFilter(mock(Counters.class), "").clientIp(req)).isEqualTo("10.0.1.5");
        var edge = new RateLimitFilter(mock(Counters.class), "CloudFront-Viewer-Address");
        assertThat(edge.clientIp(req)).isEqualTo("198.51.100.10");

        var v6 = new MockHttpServletRequest();
        v6.addHeader("CloudFront-Viewer-Address", "2001:db8::1:46532");
        assertThat(edge.clientIp(v6)).isEqualTo("2001:db8::1");
        assertThat(edge.clientIp(new MockHttpServletRequest())).isEqualTo("127.0.0.1");
    }
}
