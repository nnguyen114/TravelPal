package com.travelpal.auth;

import com.travelpal.common.JwtProperties;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/**
 * Ends a sign-in session immediately, not when its access token expires. Every access token carries its session id
 * ("sid" = refresh-token family); ending a session refuses that id until the longest-lived token for it has expired.
 */
@Component
public class Sessions implements OAuth2TokenValidator<Jwt> {
    private static final OAuth2Error ENDED = new OAuth2Error("invalid_token", "Session ended", null);
    private final StringRedisTemplate redis;
    private final JwtProperties props;

    Sessions(StringRedisTemplate redis, JwtProperties props) {
        this.redis = redis;
        this.props = props;
    }

    void end(UUID sessionId) {
        redis.opsForValue().set("ended:" + sessionId, "1", props.accessTtl());
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        String sid = jwt.getClaimAsString("sid");
        return sid == null || Boolean.TRUE.equals(redis.hasKey("ended:" + sid))
            ? OAuth2TokenValidatorResult.failure(ENDED) : OAuth2TokenValidatorResult.success();
    }
}
