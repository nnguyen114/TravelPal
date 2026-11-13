package com.travelpal.proposal;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.Instant;
import java.util.UUID;

@Entity
public class ProposalComment {
    @Id
    private UUID id;
    private UUID proposalId;
    private UUID authorId;
    private String body;
    private Instant createdAt;

    protected ProposalComment() {}

    ProposalComment(UUID proposalId, UUID authorId, String body) {
        this.id = UUID.randomUUID();
        this.proposalId = proposalId;
        this.authorId = authorId;
        this.body = body.trim();
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getProposalId() { return proposalId; }
    public UUID getAuthorId() { return authorId; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
}
