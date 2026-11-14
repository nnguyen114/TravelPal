package com.travelpal.auth;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update RefreshToken t set t.revoked = true where t.familyId = ?1")
    void revokeFamily(UUID familyId);

    /** 1 if this call used the token, 0 if it was already used. */
    @Modifying
    @Query("update RefreshToken t set t.revoked = true where t.id = ?1 and t.revoked = false")
    int claim(UUID id);

    @Query("select distinct t.familyId from RefreshToken t where t.userId = ?1 and t.revoked = false")
    List<UUID> activeFamilies(UUID userId);

    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < ?1")
    void deleteExpired(Instant now);
}
