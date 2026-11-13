-- Optional proposals: a set of changes (add / move / remove places) the group can discuss before merging.
CREATE TABLE proposal (
    id          uuid PRIMARY KEY,
    trip_id     uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    author_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    title       text NOT NULL,
    description text,
    changes     text NOT NULL,
    status      text NOT NULL CHECK (status IN ('OPEN','MERGED','CLOSED')),
    impact      text,
    impact_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    closed_at   timestamptz,
    closed_by   uuid REFERENCES app_user(id) ON DELETE SET NULL
);
CREATE INDEX proposal_trip_idx ON proposal (trip_id, status, created_at DESC);

CREATE TABLE proposal_comment (
    id          uuid PRIMARY KEY,
    proposal_id uuid NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
    author_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposal_comment_idx ON proposal_comment (proposal_id, created_at);
