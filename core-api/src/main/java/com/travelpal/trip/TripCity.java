package com.travelpal.trip;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.LocalDate;
import java.util.UUID;

@Entity
public class TripCity {
    @Id
    private UUID id;
    private UUID tripId;
    private String name;
    private Double lat;
    private Double lng;
    private LocalDate startDate;
    private LocalDate endDate;
    private boolean locked;
    private int position;

    protected TripCity() {}

    TripCity(UUID tripId, int position) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.position = position;
    }

    void update(String name, Double lat, Double lng, LocalDate startDate, LocalDate endDate, boolean locked) {
        this.name = name.trim();
        this.lat = lat;
        this.lng = lng;
        this.startDate = startDate;
        this.endDate = endDate;
        this.locked = locked;
    }

    public UUID getId() { return id; }
    public UUID getTripId() { return tripId; }
    public String getName() { return name; }
    public Double getLat() { return lat; }
    public Double getLng() { return lng; }
    public LocalDate getStartDate() { return startDate; }
    public LocalDate getEndDate() { return endDate; }
    public boolean isLocked() { return locked; }
    public int getPosition() { return position; }
}
