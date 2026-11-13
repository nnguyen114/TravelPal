CREATE TABLE trip (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    start_date date NOT NULL,
    end_date   date NOT NULL CHECK (end_date >= start_date),
    version    bigint NOT NULL DEFAULT 0,
    created_by uuid NOT NULL REFERENCES app_user(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_member (
    trip_id   uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role      text NOT NULL CHECK (role IN ('OWNER','EDITOR','VIEWER')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX trip_member_user_idx ON trip_member (user_id);

CREATE TABLE trip_city (
    id         uuid PRIMARY KEY,
    trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    name       text NOT NULL,
    lat        double precision,
    lng        double precision,
    start_date date,
    end_date   date,
    locked     boolean NOT NULL DEFAULT false,
    position   int NOT NULL
);
CREATE INDEX trip_city_trip_idx ON trip_city (trip_id, position);

CREATE TABLE destination (
    id           uuid PRIMARY KEY,
    trip_id      uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
    name         text NOT NULL,
    address      text,
    lat          double precision,
    lng          double precision,
    provider_id  text,
    notes        text,
    duration_min int,
    day_index    int,
    position     int,
    start_time   time,
    locked       boolean NOT NULL DEFAULT false,
    flexibility  text NOT NULL DEFAULT 'FLEXIBLE' CHECK (flexibility IN ('FIXED','PREFERRED','FLEXIBLE')),
    created_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((day_index IS NULL) = (position IS NULL))
);
CREATE INDEX destination_trip_day_idx ON destination (trip_id, day_index, position);
CREATE UNIQUE INDEX destination_provider_uq ON destination (trip_id, provider_id) WHERE provider_id IS NOT NULL;
