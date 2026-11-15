package com.travelpal.proposal;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface ProposalRepository extends JpaRepository<Proposal, UUID> {
    /** Keyset page, newest first, after the cursor (createdAt, id); a null status means every status. */
    @Query("""
        select p from Proposal p where p.tripId = ?1 and (?2 is null or p.status = ?2)
        and (p.createdAt < ?3 or (p.createdAt = ?3 and p.id < ?4)) order by p.createdAt desc, p.id desc""")
    List<Proposal> page(UUID tripId, Proposal.Status status, Instant before, UUID beforeId, Limit limit);

    @Query("select p.status, count(p) from Proposal p where p.tripId = ?1 group by p.status")
    List<Object[]> countByStatus(UUID tripId);

    Optional<Proposal> findByIdAndTripId(UUID id, UUID tripId);
}

interface ProposalCommentRepository extends JpaRepository<ProposalComment, UUID> {
    List<ProposalComment> findByProposalIdOrderByCreatedAt(UUID proposalId);

    @Query("select c.proposalId, count(c) from ProposalComment c where c.proposalId in ?1 group by c.proposalId")
    List<Object[]> countByProposal(Collection<UUID> ids);
}
