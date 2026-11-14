package com.travelpal.assistant;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Short-lived ES256 tokens for core-api -> ai-service calls, signed with a key separate from user tokens.
 * ai-service verifies them against the public JWKS served here, so no secret is shared between services.
 */
@Component
@RestController
public class InternalTokens {
    private final ECKey key;
    private final NimbusJwtEncoder encoder;

    /** INTERNAL_JWT_PRIVATE_KEY (JWK JSON) keeps one key across restarts and tasks; unset = throwaway dev key. */
    InternalTokens(@org.springframework.beans.factory.annotation.Value("${travelpal.internal-jwk:}") String jwk,
                   @org.springframework.beans.factory.annotation.Value("${travelpal.dev-keys}") boolean devKeys)
            throws JOSEException, java.text.ParseException {
        if (jwk.isBlank() && !devKeys) {
            throw new IllegalStateException("INTERNAL_JWT_PRIVATE_JWK must be set (DEV_KEYS=false)");
        }
        this.key = jwk.isBlank() ? new ECKeyGenerator(Curve.P_256).keyID("internal-" + UUID.randomUUID()).generate() : ECKey.parse(jwk);
        this.encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
    }

    public String issue(UUID userId) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer("core-api").audience(java.util.List.of("ai-service"))
            .subject(userId.toString()).issuedAt(now).expiresAt(now.plusSeconds(60)).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.ES256).keyId(key.getKeyID()).build(), claims))
            .getTokenValue();
    }

    @GetMapping("/.well-known/internal-jwks.json")
    Map<String, Object> jwks() {
        return new JWKSet(key.toPublicJWK()).toJSONObject();
    }
}
