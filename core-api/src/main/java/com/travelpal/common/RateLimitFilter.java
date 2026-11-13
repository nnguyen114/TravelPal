package com.travelpal.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Per-client-IP limit on credential endpoints (per-account limits live in AuthService). */
@Component
public class RateLimitFilter extends OncePerRequestFilter {
    static final int LIMIT_PER_MINUTE = 10;
    private final Counters counters;

    RateLimitFilter(Counters counters) {
        this.counters = counters;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String p = req.getRequestURI();
        return !("POST".equals(req.getMethod()) && (p.equals("/api/auth/login") || p.equals("/api/auth/register")));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        // Behind the ALB, getRemoteAddr is the client: Tomcat takes it from X-Forwarded-For set by the trusted proxy.
        if (!counters.allow("ip:" + req.getRemoteAddr(), LIMIT_PER_MINUTE, Duration.ofMinutes(1))) {
            res.setStatus(429);
            res.setHeader("Retry-After", "60");
            return;
        }
        chain.doFilter(req, res);
    }
}
