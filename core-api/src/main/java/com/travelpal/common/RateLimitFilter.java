package com.travelpal.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Per-client-IP limit on credential endpoints (per-account limits live in AuthService). */
@Component
public class RateLimitFilter extends OncePerRequestFilter {
    static final int LIMIT_PER_MINUTE = 10;
    private final Counters counters;
    private final String ipHeader;

    /**
     * {@code ipHeader}: header carrying the real client address, set by a trusted edge. In AWS it is CloudFront's
     * CloudFront-Viewer-Address ("ip:port"); the ALB only accepts CloudFront, so clients can't forge it.
     */
    RateLimitFilter(Counters counters, @Value("${travelpal.client-ip-header:}") String ipHeader) {
        this.counters = counters;
        this.ipHeader = ipHeader;
    }

    String clientIp(HttpServletRequest req) {
        String v = ipHeader.isBlank() ? null : req.getHeader(ipHeader);
        if (v == null || v.isBlank()) {
            return req.getRemoteAddr();
        }
        int port = v.lastIndexOf(':');
        return port > 0 ? v.substring(0, port) : v;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String p = req.getRequestURI();
        return !("POST".equals(req.getMethod()) && (p.equals("/api/auth/login") || p.equals("/api/auth/register")));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!counters.allow("ip:" + clientIp(req), LIMIT_PER_MINUTE, Duration.ofMinutes(1))) {
            res.setStatus(429);
            res.setHeader("Retry-After", "60");
            return;
        }
        chain.doFilter(req, res);
    }
}
