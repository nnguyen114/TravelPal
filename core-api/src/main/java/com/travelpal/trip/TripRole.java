package com.travelpal.trip;

/** Declared lowest to highest; a role grants everything the roles before it grant. */
public enum TripRole {
    VIEWER, EDITOR, OWNER;

    public boolean atLeast(TripRole other) {
        return compareTo(other) >= 0;
    }
}
