-- When a place is worth visiting, and whether it's a day trip. Suggested by AI (hints_source = 'AI') until a
-- traveler sets them ('USER'); AI never overwrites a traveler's choice.
ALTER TABLE destination
    ADD COLUMN visit_after  time,
    ADD COLUMN visit_before time,
    ADD COLUMN day_trip     boolean NOT NULL DEFAULT false,
    ADD COLUMN hints_source text CHECK (hints_source IN ('AI', 'USER'));
