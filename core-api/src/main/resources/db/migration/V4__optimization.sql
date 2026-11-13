CREATE TABLE optimization_preview (
    id           uuid PRIMARY KEY,
    trip_id      uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    requested_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
    base_version bigint NOT NULL,
    status       text NOT NULL CHECK (status IN ('PENDING','READY','FAILED','APPLIED','DISCARDED')),
    request      text NOT NULL,
    result       text,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX optimization_preview_trip_idx ON optimization_preview (trip_id, created_at DESC);
