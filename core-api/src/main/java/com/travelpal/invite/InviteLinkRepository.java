package com.travelpal.invite;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface InviteLinkRepository extends JpaRepository<InviteLink, UUID> {
    Optional<InviteLink> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update InviteLink l set l.revoked = true where l.tripId = ?1")
    int revokeAll(UUID tripId);
}
