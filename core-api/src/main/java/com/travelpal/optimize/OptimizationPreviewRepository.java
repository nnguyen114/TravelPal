package com.travelpal.optimize;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface OptimizationPreviewRepository extends JpaRepository<OptimizationPreview, UUID> {
    Optional<OptimizationPreview> findByIdAndTripId(UUID id, UUID tripId);
}
