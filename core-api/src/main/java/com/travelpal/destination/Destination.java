package com.travelpal.destination;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import java.time.LocalTime;
import java.util.UUID;

/** One record per place in a trip; scheduled = has a day. Never duplicated between collection and itinerary. */
@Entity
public class Destination {
    @Id
    private UUID id;
    private UUID tripId;
    private String name;
    private String address;
    private Double lat;
    private Double lng;
    private String providerId;
    private String notes;
    private Integer durationMin;
    private Integer dayIndex;
    private Integer position;
    private LocalTime startTime;
    private boolean locked;
    @Enumerated(EnumType.STRING)
    private Flexibility flexibility = Flexibility.FLEXIBLE;
    private UUID createdBy;

    protected Destination() {}

    Destination(UUID tripId, UUID createdBy, String providerId) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.createdBy = createdBy;
        this.providerId = providerId;
    }

    void details(String name, String address, Double lat, Double lng, String notes, Integer durationMin,
                 LocalTime startTime, boolean locked, Flexibility flexibility) {
        this.name = name.trim();
        this.address = address;
        this.lat = lat;
        this.lng = lng;
        this.notes = notes;
        this.durationMin = durationMin;
        this.startTime = startTime;
        this.locked = locked;
        this.flexibility = flexibility == null ? Flexibility.FLEXIBLE : flexibility;
    }

    void schedule(Integer dayIndex, Integer position) {
        this.dayIndex = dayIndex;
        this.position = position;
    }

    public UUID getId() { return id; }
    public UUID getTripId() { return tripId; }
    public String getName() { return name; }
    public String getAddress() { return address; }
    public Double getLat() { return lat; }
    public Double getLng() { return lng; }
    public String getProviderId() { return providerId; }
    public String getNotes() { return notes; }
    public Integer getDurationMin() { return durationMin; }
    public Integer getDayIndex() { return dayIndex; }
    public Integer getPosition() { return position; }
    public LocalTime getStartTime() { return startTime; }
    public boolean isLocked() { return locked; }
    public Flexibility getFlexibility() { return flexibility; }
}
