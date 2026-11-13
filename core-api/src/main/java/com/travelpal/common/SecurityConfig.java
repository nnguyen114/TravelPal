package com.travelpal.common;

import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {
    public static final String ISSUER = "travelpal";

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            // Stateless bearer-token API. The only cookie (refresh) is HttpOnly + SameSite=Strict + Path=/api/auth.
            .csrf(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives("default-src 'none'; frame-ancestors 'none'")))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout").permitAll()
                .requestMatchers("/actuator/health", "/error", "/.well-known/internal-jwks.json").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(j -> {}));
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    ECKey signingKey(JwtProperties props) throws Exception {
        if (props.privateKey() == null || props.privateKey().isBlank()) {
            LoggerFactory.getLogger(SecurityConfig.class).warn("JWT_PRIVATE_KEY not set: using an ephemeral dev key");
            return new ECKeyGenerator(Curve.P_256).keyID("dev").generate();
        }
        KeyFactory kf = KeyFactory.getInstance("EC");
        var priv = (ECPrivateKey) kf.generatePrivate(new PKCS8EncodedKeySpec(pem(props.privateKey())));
        var pub = (ECPublicKey) kf.generatePublic(new X509EncodedKeySpec(pem(props.publicKey())));
        return new ECKey.Builder(Curve.P_256, pub).privateKey(priv).keyID("k1").build();
    }

    @Bean
    JwtEncoder jwtEncoder(ECKey key) {
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
    }

    @Bean
    JwtDecoder jwtDecoder(ECKey key) {
        NimbusJwtDecoder d = NimbusJwtDecoder.withJwkSource(new ImmutableJWKSet<>(new JWKSet(key.toPublicJWK())))
            .jwsAlgorithm(SignatureAlgorithm.ES256).build();
        d.setJwtValidator(JwtValidators.createDefaultWithIssuer(ISSUER));
        return d;
    }

    static byte[] pem(String pem) {
        return Base64.getMimeDecoder().decode(pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", ""));
    }
}
