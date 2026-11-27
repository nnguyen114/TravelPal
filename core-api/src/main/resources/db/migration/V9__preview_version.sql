-- Optimistic locking: a late worker result, an expiry, apply and discard can't overwrite each other.
ALTER TABLE optimization_preview ADD COLUMN version bigint NOT NULL DEFAULT 0;
