-- Same day: the optimizer may reorder or retime the place but never moves it to another day.
ALTER TABLE destination DROP CONSTRAINT destination_flexibility_check;
ALTER TABLE destination ADD CONSTRAINT destination_flexibility_check
    CHECK (flexibility IN ('FIXED','PREFERRED','FLEXIBLE','SAME_DAY'));

-- What isn't a visitable place: flights, lodging, meal slots, open choices and day notes.
CREATE TABLE itinerary_entry (
    id          uuid PRIMARY KEY,
    trip_id     uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    day_index   int,                       -- null = undated
    position    int NOT NULL,              -- order among entries of the day
    kind        text NOT NULL CHECK (kind IN ('FLIGHT','LODGING','MEAL','CHOICE','NOTE')),
    title       text NOT NULL,
    start_time  time,
    details     text NOT NULL DEFAULT '{}',-- JSON per kind
    source      text,                      -- the plan line(s) it came from
    import_id   uuid,                      -- the import that created it (null if added later)
    version     bigint NOT NULL DEFAULT 0,
    created_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX itinerary_entry_trip_idx ON itinerary_entry (trip_id, day_index, position);

-- One row per applied import, so a retried Apply returns the first result instead of importing twice.
CREATE TABLE trip_import (
    import_id uuid PRIMARY KEY,
    trip_id   uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    event_id  bigint NOT NULL
);
