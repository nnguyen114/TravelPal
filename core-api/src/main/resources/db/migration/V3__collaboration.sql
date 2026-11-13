ALTER TABLE destination ADD COLUMN version bigint NOT NULL DEFAULT 0;

CREATE TABLE invite_link (
    id         uuid PRIMARY KEY,
    trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES app_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked    boolean NOT NULL DEFAULT false
);
CREATE INDEX invite_link_trip_idx ON invite_link (trip_id);

-- Append-only activity log. before/after hold JSON snapshots used for undo.
CREATE TABLE trip_event (
    id         bigserial PRIMARY KEY,
    trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    actor_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    type       text NOT NULL,
    summary    text NOT NULL,
    before     text,
    after      text,
    undone     boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_event_trip_idx ON trip_event (trip_id, id DESC);
