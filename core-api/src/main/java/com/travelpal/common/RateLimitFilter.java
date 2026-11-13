package com.travelpal.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Fixed-window limit on credential endpoints, per client IP. */
// ponytail: per-instance memory; move counters to Redis when running more than one core-api task.
@Component
public class RateLimitFilter extends OncePerRequestFilter {
    static final int LIMIT_PER_MINUTE = 10;
    private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
    private volatile long window = currentWindow();

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String p = req.getRequestURI();
        return !("POST".equals(req.getMethod()) && (p.equals("/api/auth/login") || p.equals("/api/auth/register")));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        long now = currentWindow();
        if (now != window) {
            window = now;
            counts.clear();
        }
        if (counts.computeIfAbsent(req.getRemoteAddr(), k -> new AtomicInteger()).incrementAndGet() > LIMIT_PER_MINUTE) {
            res.setStatus(429);
            res.setHeader("Retry-After", "60");
            return;
        }
        chain.doFilter(req, res);
    }

    private static long currentWindow() {
        return System.currentTimeMillis() / 60_000;
    }
}
