package com.travelpal.auth;

import com.travelpal.common.JwtProperties;
import com.travelpal.common.SecurityConfig;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
    public record Session(User user, String accessToken, String refreshToken) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    // Same cost as a real check, so unknown emails can't be told apart by timing.
    private final String dummyHash;

    private final UserRepository users;
    private final RefreshTokenRepository tokens;
    private final PasswordEncoder encoder;
    private final JwtEncoder jwt;
    private final JwtProperties props;

    AuthService(UserRepository users, RefreshTokenRepository tokens, PasswordEncoder encoder, JwtEncoder jwt, JwtProperties props) {
        this.users = users;
        this.tokens = tokens;
        this.encoder = encoder;
        this.jwt = jwt;
        this.props = props;
        this.dummyHash = encoder.encode("dummy-password");
    }

    @Transactional
    public Session register(String email, String password, String displayName) {
        if (users.findByEmail(email).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        User user = users.save(new User(email.trim(), encoder.encode(password), displayName.trim()));
        return issue(user, UUID.randomUUID());
    }

    @Transactional
    public Session login(String email, String password) {
        User user = users.findByEmail(email).orElse(null);
        boolean ok = encoder.matches(password, user == null ? dummyHash : user.getPasswordHash());
        if (user == null || !ok) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
        return issue(user, UUID.randomUUID());
    }

    /** Rotates the refresh token. Presenting an already-used token revokes its whole family (theft signal). */
    @Transactional(noRollbackFor = ResponseStatusException.class)
    public Session refresh(String rawToken) {
        RefreshToken t = tokens.findByTokenHash(hash(rawToken)).orElseThrow(AuthService::unauthorized);
        if (t.isRevoked()) {
            tokens.revokeFamily(t.getFamilyId());
            throw unauthorized();
        }
        if (t.getExpiresAt().isBefore(Instant.now())) {
            throw unauthorized();
        }
        t.revoke();
        User user = users.findById(t.getUserId()).orElseThrow(AuthService::unauthorized);
        return issue(user, t.getFamilyId());
    }

    @Transactional
    public void logout(String rawToken) {
        tokens.findByTokenHash(hash(rawToken)).ifPresent(t -> tokens.revokeFamily(t.getFamilyId()));
    }

    public User me(UUID userId) {
        return users.findById(userId).orElseThrow(AuthService::unauthorized);
    }

    private Session issue(User user, UUID familyId) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(SecurityConfig.ISSUER)
            .subject(user.getId().toString())
            .issuedAt(now)
            .expiresAt(now.plus(props.accessTtl()))
            .claim("roles", List.of("USER"))
            .build();
        String access = jwt.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.ES256).build(), claims)).getTokenValue();

        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        tokens.save(new RefreshToken(user.getId(), familyId, hash(raw), now.plus(props.refreshTtl())));
        return new Session(user, access, raw);
    }

    static String hash(String raw) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired");
    }
}
