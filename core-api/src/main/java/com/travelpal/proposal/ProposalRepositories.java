package com.travelpal.proposal;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface ProposalRepository extends JpaRepository<Proposal, UUID> {
    List<Proposal> findByTripIdOrderByCreatedAtDesc(UUID tripId);

    Optional<Proposal> findByIdAndTripId(UUID id, UUID tripId);
}

interface ProposalCommentRepository extends JpaRepository<ProposalComment, UUID> {
    List<ProposalComment> findByProposalIdOrderByCreatedAt(UUID proposalId);

    @Query("select c.proposalId, count(c) from ProposalComment c where c.proposalId in ?1 group by c.proposalId")
    List<Object[]> countByProposal(Collection<UUID> ids);
}
