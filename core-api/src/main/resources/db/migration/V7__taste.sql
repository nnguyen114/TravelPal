-- Explicit "Not interested" feedback; personal to the traveler and kept across trips.
-- Positive taste comes from the places each traveler added themselves (destination.created_by).
CREATE TABLE taste_signal (
    user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider_id)
);
CREATE INDEX destination_created_by_idx ON destination (created_by, created_at DESC);
