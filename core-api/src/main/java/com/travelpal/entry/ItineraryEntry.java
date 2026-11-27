package com.travelpal.entry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/** Something on a day that isn't a place to visit: a flight, lodging, a meal slot, an open choice or a note. */
@Entity
public class ItineraryEntry {
    public enum Kind { FLIGHT, LODGING, MEAL, CHOICE, NOTE }

    @Id
    private UUID id;
    private UUID tripId;
    private Integer dayIndex;
    private int position;
    @Enumerated(EnumType.STRING)
    private Kind kind;
    private String title;
    private LocalTime startTime;
    /** JSON, shape per kind (validated by {@link EntryService}). */
    private String details;
    private String source;
    private UUID importId;
    @Version
    private long version;
    private UUID createdBy;
    @Column(insertable = false, updatable = false)
    private Instant createdAt;

    protected ItineraryEntry() {}

    ItineraryEntry(UUID tripId, UUID createdBy, Kind kind, String details, String source, UUID importId) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.createdBy = createdBy;
        this.kind = kind;
        this.details = details;
        this.source = source;
        this.importId = importId;
    }

    void edit(String title, Integer dayIndex, int position, LocalTime startTime) {
        this.title = title.trim();
        this.dayIndex = dayIndex;
        this.position = position;
        this.startTime = startTime;
    }

    public UUID getId() { return id; }
    public UUID getTripId() { return tripId; }
    public Integer getDayIndex() { return dayIndex; }
    public int getPosition() { return position; }
    public Kind getKind() { return kind; }
    public String getTitle() { return title; }
    public LocalTime getStartTime() { return startTime; }
    public String getDetails() { return details; }
    public String getSource() { return source; }
    public UUID getImportId() { return importId; }
    public long getVersion() { return version; }
}
