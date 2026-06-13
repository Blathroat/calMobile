package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * Registration manager backed by SQLite (via {@link DatabaseHelper}).
 * Falls back to in-memory storage when no database is available
 * (e.g. unit tests without Application context).
 * <p>
 * Public API is unchanged from the original in-memory version.
 */
public class RegistrationManager {

    // ── In-memory fallback (test environments) ────────────────────
    private final List<Registration> fallbackRegistrations = new ArrayList<>();
    private int fallbackNextId = 1;

    public RegistrationManager() {
        // No-arg constructor preserved for backward compatibility.
    }

    public Registration submit(String exhibitionTitle, int exhibitionDay, String exhibitionTime,
            String exhibitionVenue, String visitorName, String visitorType, String needsSummary) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            String id = dbHelper.insertRegistration(exhibitionTitle, exhibitionDay, exhibitionTime,
                    exhibitionVenue, visitorName, visitorType, needsSummary,
                    Registration.Status.PENDING.name());
            if (id != null) {
                return dbHelper.getRegistrationById(id);
            }
            return null;
        }
        // In-memory fallback
        Registration registration = new Registration(
                "registration-" + fallbackNextId,
                exhibitionTitle,
                exhibitionDay,
                exhibitionTime,
                exhibitionVenue,
                visitorName,
                visitorType,
                needsSummary,
                Registration.Status.PENDING);
        fallbackNextId++;
        fallbackRegistrations.add(registration);
        return registration;
    }

    public List<Registration> list() {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getAllRegistrations();
        }
        return new ArrayList<>(fallbackRegistrations);
    }

    public boolean cancel(String id) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.updateRegistrationStatus(id, Registration.Status.CANCELLED.name());
        }
        // In-memory fallback
        for (Registration registration : fallbackRegistrations) {
            if (registration.getId().equals(id)) {
                registration.cancel();
                return true;
            }
        }
        return false;
    }
}
