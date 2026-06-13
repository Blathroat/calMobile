package com.example.calmobile;

public class Registration {
    public enum Status {
        PENDING,
        CANCELLED
    }

    private final String id;
    private final String exhibitionTitle;
    private final int exhibitionDay;
    private final String exhibitionTime;
    private final String exhibitionVenue;
    private final String visitorName;
    private final String visitorType;
    private final String needsSummary;
    private Status status;

    Registration(String id, String exhibitionTitle, int exhibitionDay, String exhibitionTime,
            String exhibitionVenue, String visitorName, String visitorType, String needsSummary,
            Status status) {
        this.id = id;
        this.exhibitionTitle = exhibitionTitle;
        this.exhibitionDay = exhibitionDay;
        this.exhibitionTime = exhibitionTime;
        this.exhibitionVenue = exhibitionVenue;
        this.visitorName = visitorName;
        this.visitorType = visitorType;
        this.needsSummary = needsSummary;
        this.status = status;
    }

    public String getId() {
        return id;
    }

    public String getExhibitionTitle() {
        return exhibitionTitle;
    }

    public int getExhibitionDay() {
        return exhibitionDay;
    }

    public String getExhibitionTime() {
        return exhibitionTime;
    }

    public String getExhibitionVenue() {
        return exhibitionVenue;
    }

    public String getVisitorName() {
        return visitorName;
    }

    public String getVisitorType() {
        return visitorType;
    }

    public String getNeedsSummary() {
        return needsSummary;
    }

    public Status getStatus() {
        return status;
    }

    void cancel() {
        status = Status.CANCELLED;
    }
}
