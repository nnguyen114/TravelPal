package com.travelpal.auth;

import com.travelpal.common.Counters;
import com.travelpal.common.JwtProperties;
import com.travelpal.common.SecurityConfig;
import com.travelpal.common.Tokens;
import com.travelpal.trip.TripService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
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

    static final int LOGIN_ATTEMPTS = 10;
    static final Duration LOGIN_WINDOW = Duration.ofMinutes(15);

    // Same cost as a real check, so unknown emails can't be told apart by timing.
    private final String dummyHash;

    private final UserRepository users;
    private final RefreshTokenRepository tokens;
    private final PasswordEncoder encoder;
    private final JwtEncoder jwt;
    private final JwtProperties props;
    private final Sessions sessions;
    private final Counters counters;
    private final TripService trips;

    AuthService(UserRepository users, RefreshTokenRepository tokens, PasswordEncoder encoder, JwtEncoder jwt, JwtProperties props,
                Sessions sessions, Counters counters, TripService trips) {
        this.sessions = sessions;
        this.counters = counters;
        this.trips = trips;
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
        if (!passwordMatches(email, user, password)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
        return issue(user, UUID.randomUUID());
    }

    /**
     * Rotates the refresh token. A token can be used once: the claim is a single conditional UPDATE, so two
     * concurrent requests can't both succeed. Presenting a used token ends the whole session (theft signal).
     */
    @Transactional(noRollbackFor = ResponseStatusException.class)
    public Session refresh(String rawToken) {
        RefreshToken t = tokens.findByTokenHash(hash(rawToken)).orElseThrow(AuthService::unauthorized);
        if (t.getExpiresAt().isBefore(Instant.now())) {
            throw unauthorized();
        }
        if (tokens.claim(t.getId()) == 0) {
            endSession(t.getFamilyId());
            throw unauthorized();
        }
        User user = users.findById(t.getUserId()).orElseThrow(AuthService::unauthorized);
        return issue(user, t.getFamilyId());
    }

    /** Ends this device's session: its refresh token stops working and its access token is refused right away. */
    @Transactional
    public void logout(String rawToken) {
        tokens.findByTokenHash(hash(rawToken)).ifPresent(t -> endSession(t.getFamilyId()));
    }

    /**
     * Deletes the account and personal data (picks, "not interested" list, sessions). Trips the user solely owns go
     * to their longest-standing member, or are deleted if no one else is in them. Needs the password again.
     */
    @Transactional
    public void deleteAccount(UUID userId, String password) {
        User user = me(userId);
        if (!passwordMatches(user.getEmail(), user, password)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Password is incorrect");
        }
        tokens.activeFamilies(userId).forEach(this::endSession);
        trips.releaseAll(userId);
        users.delete(user);
    }

    /** Drops refresh tokens that can no longer be used, so old sessions don't pile up. */
    @Scheduled(cron = "0 17 3 * * *")
    @Transactional
    public void purgeExpired() {
        tokens.deleteExpired(Instant.now());
    }

    private void endSession(UUID familyId) {
        tokens.revokeFamily(familyId);
        sessions.end(familyId);
    }

    /** Per-account limit (on top of the per-IP one) so guessing one account's password from many IPs is slow too. */
    private boolean passwordMatches(String email, User user, String password) {
        if (!counters.allow("login:" + Tokens.sha256(email.trim().toLowerCase()), LOGIN_ATTEMPTS, LOGIN_WINDOW)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many sign-in attempts. Try again in 15 minutes.");
        }
        boolean ok = encoder.matches(password, user == null ? dummyHash : user.getPasswordHash());
        return user != null && ok;
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
            .claim("sid", familyId.toString())
            .build();
        String access = jwt.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.ES256).build(), claims)).getTokenValue();

        String raw = Tokens.random();
        tokens.save(new RefreshToken(user.getId(), familyId, hash(raw), now.plus(props.refreshTtl())));
        return new Session(user, access, raw);
    }

    private static String hash(String raw) {
        return Tokens.sha256(raw);
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired");
    }
}
