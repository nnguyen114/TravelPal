-- Account deletion: a trip outlives its creator (it is handed to another member first), and invite links
-- a deleted user created stop working.
ALTER TABLE trip ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT trip_created_by_fkey,
    ADD CONSTRAINT trip_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE invite_link
    DROP CONSTRAINT invite_link_created_by_fkey,
    ADD CONSTRAINT invite_link_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE CASCADE;
-- Nightly purge of expired refresh tokens.
CREATE INDEX refresh_token_expires_idx ON refresh_token (expires_at);
