package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

public class RegistrationManager {
    private final List<Registration> registrations = new ArrayList<>();
    private int nextId = 1;

    public Registration submit(String exhibitionTitle, int exhibitionDay, String exhibitionTime,
            String exhibitionVenue, String visitorName, String visitorType, String needsSummary) {
        Registration registration = new Registration(
                "registration-" + nextId,
                exhibitionTitle,
                exhibitionDay,
                exhibitionTime,
                exhibitionVenue,
                visitorName,
                visitorType,
                needsSummary,
                Registration.Status.PENDING);
        nextId++;
        registrations.add(registration);
        return registration;
    }

    public List<Registration> list() {
        return new ArrayList<>(registrations);
    }

    public boolean cancel(String id) {
        for (Registration registration : registrations) {
            if (registration.getId().equals(id)) {
                registration.cancel();
                return true;
            }
        }
        return false;
    }
}
