package com.travelpal.optimize;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface OptimizationPreviewRepository extends JpaRepository<OptimizationPreview, UUID> {
    Optional<OptimizationPreview> findByIdAndTripId(UUID id, UUID tripId);

    /** PENDING to FAILED only if still PENDING and older than {@code cutoff}; bumps the version so a late result loses. */
    @Modifying(clearAutomatically = true)
    @Query("""
        update OptimizationPreview p set p.status = com.travelpal.optimize.OptimizationPreview.Status.FAILED, p.error = ?3,
            p.version = p.version + 1
        where p.id = ?1 and p.tripId = ?2 and p.status = com.travelpal.optimize.OptimizationPreview.Status.PENDING and p.createdAt < ?4""")
    int expire(UUID id, UUID tripId, String error, Instant cutoff);
}
