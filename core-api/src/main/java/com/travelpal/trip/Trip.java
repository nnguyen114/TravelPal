package com.travelpal.trip;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Entity
public class Trip {
    @Id
    private UUID id;
    private String name;
    private LocalDate startDate;
    private LocalDate endDate;
    @Version
    private long version;
    private UUID createdBy;

    protected Trip() {}

    Trip(String name, LocalDate startDate, LocalDate endDate, UUID createdBy) {
        this.id = UUID.randomUUID();
        this.createdBy = createdBy;
        update(name, startDate, endDate);
    }

    void update(String name, LocalDate startDate, LocalDate endDate) {
        this.name = name.trim();
        this.startDate = startDate;
        this.endDate = endDate;
    }

    public int dayCount() {
        return (int) ChronoUnit.DAYS.between(startDate, endDate) + 1;
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public LocalDate getStartDate() { return startDate; }
    public LocalDate getEndDate() { return endDate; }
    public long getVersion() { return version; }
}
