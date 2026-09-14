package com.example.calmobile;

/**
 * Mutable exhibition model for the exhibitor backend.
 * Mirrors the Exhibition inner class in MainActivity but with setters.
 */
public class ExhibitorExhibition {
    public static final String STATUS_OPEN = "报名中";
    public static final String STATUS_CLOSED = "截止报名";
    public static final String STATUS_ENDED = "已结束";
    /** newUI 展会编辑页的报名方式：需要展商审核。 */
    public static final String STATUS_REVIEW_REQUIRED = "需审核";
    /** newUI 展会编辑页的报名方式：提交后直接通过。 */
    public static final String STATUS_REVIEW_OPTIONAL = "无需审核";
    /** newUI 展会编辑页的报名方式：只展示信息，不收集报名。 */
    public static final String STATUS_DISPLAY_ONLY = "仅展示";

    private final String id;
    private int day;
    private String title;
    private String venue;
    private String time;
    private String status;
    private String description;
    private String category;

    ExhibitorExhibition(String id, int day, String title, String venue, String time,
            String status, String description, String category) {
        this.id = id;
        this.day = day;
        this.title = title;
        this.venue = venue;
        this.time = time;
        this.status = status;
        this.description = description;
        this.category = category;
    }

    public String getId() {
        return id;
    }

    public int getDay() {
        return day;
    }

    public void setDay(int day) {
        this.day = day;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getVenue() {
        return venue;
    }

    public void setVenue(String venue) {
        this.venue = venue;
    }

    public String getTime() {
        return time;
    }

    public void setTime(String time) {
        this.time = time;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public boolean isOpenForRegistration() {
        return STATUS_OPEN.equals(status)
                || STATUS_REVIEW_REQUIRED.equals(status)
                || STATUS_REVIEW_OPTIONAL.equals(status);
    }
}
