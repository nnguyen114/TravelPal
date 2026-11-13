package com.travelpal.common;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public final class Auth {
    private Auth() {}

    public static UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
