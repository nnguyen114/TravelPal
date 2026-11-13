package com.travelpal.auth;

import com.travelpal.common.Auth;
import com.travelpal.common.JwtProperties;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AuthController {
    static final String COOKIE = "tp_refresh";

    public record RegisterRequest(@NotBlank @Email @Size(max = 254) String email,
                                  @NotBlank @Size(min = 10, max = 128) String password,
                                  @NotBlank @Size(max = 80) String displayName) {}
    public record DeleteAccountRequest(@NotBlank @Size(max = 128) String password) {}
    public record LoginRequest(@NotBlank String email, @NotBlank @Size(max = 128) String password) {}
    public record UserDto(UUID id, String email, String displayName) {
        static UserDto of(User u) { return new UserDto(u.getId(), u.getEmail(), u.getDisplayName()); }
    }
    public record SessionDto(String accessToken, UserDto user) {}

    private final AuthService auth;
    private final JwtProperties props;
    private final boolean secureCookie;

    AuthController(AuthService auth, JwtProperties props, @Value("${travelpal.cookie-secure}") boolean secureCookie) {
        this.auth = auth;
        this.props = props;
        this.secureCookie = secureCookie;
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    SessionDto register(@Valid @RequestBody RegisterRequest req, HttpServletResponse res) {
        return respond(auth.register(req.email(), req.password(), req.displayName()), res);
    }

    @PostMapping("/auth/login")
    SessionDto login(@Valid @RequestBody LoginRequest req, HttpServletResponse res) {
        return respond(auth.login(req.email(), req.password()), res);
    }

    @PostMapping("/auth/refresh")
    SessionDto refresh(@CookieValue(name = COOKIE, required = false) String token, HttpServletResponse res) {
        if (token == null) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.UNAUTHORIZED, "No session");
        }
        return respond(auth.refresh(token), res);
    }

    @PostMapping("/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(@CookieValue(name = COOKIE, required = false) String token, HttpServletResponse res) {
        if (token != null) {
            auth.logout(token);
        }
        res.addHeader(HttpHeaders.SET_COOKIE, cookie("", 0).toString());
    }

    @GetMapping("/me")
    UserDto me(@AuthenticationPrincipal Jwt jwt) {
        return UserDto.of(auth.me(Auth.userId(jwt)));
    }

    @DeleteMapping("/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteAccount(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteAccountRequest req, HttpServletResponse res) {
        auth.deleteAccount(Auth.userId(jwt), req.password());
        res.addHeader(HttpHeaders.SET_COOKIE, cookie("", 0).toString());
    }

    private SessionDto respond(AuthService.Session s, HttpServletResponse res) {
        res.addHeader(HttpHeaders.SET_COOKIE, cookie(s.refreshToken(), props.refreshTtl().toSeconds()).toString());
        return new SessionDto(s.accessToken(), UserDto.of(s.user()));
    }

    private ResponseCookie cookie(String value, long maxAge) {
        return ResponseCookie.from(COOKIE, value).httpOnly(true).secure(secureCookie).sameSite("Strict")
            .path("/api/auth").maxAge(maxAge).build();
    }
}
