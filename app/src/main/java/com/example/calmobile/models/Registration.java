package com.example.calmobile.models;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Ignore;
import androidx.room.PrimaryKey;

import com.google.gson.annotations.SerializedName;

/**
 * 报名数据模型
 * 对应数据库 registrations 表
 */
@Entity(tableName = "registrations")
public class Registration {

    @PrimaryKey
    @NonNull
    @ColumnInfo(name = "id")
    @SerializedName("id")
    private String id = "";

    @ColumnInfo(name = "exhibition_id")
    @SerializedName("exhibition_id")
    private String exhibitionId;

    @ColumnInfo(name = "exhibition_title")
    @SerializedName("exhibition_title")
    private String exhibitionTitle;

    @ColumnInfo(name = "exhibition_day")
    @SerializedName("exhibition_day")
    private int exhibitionDay;

    @ColumnInfo(name = "exhibition_time")
    @SerializedName("exhibition_time")
    private String exhibitionTime;

    @ColumnInfo(name = "exhibition_venue")
    @SerializedName("exhibition_venue")
    private String exhibitionVenue;

    @ColumnInfo(name = "visitor_name")
    @SerializedName("visitor_name")
    private String visitorName;

    @ColumnInfo(name = "visitor_type")
    @SerializedName("visitor_type")
    private String visitorType;

    @ColumnInfo(name = "needs_summary")
    @SerializedName("needs_summary")
    private String needsSummary;

    @ColumnInfo(name = "status")
    @SerializedName("status")
    private String status;

    @ColumnInfo(name = "visitor_id")
    @SerializedName("visitor_id")
    private String visitorId;

    @ColumnInfo(name = "created_at")
    @SerializedName("created_at")
    private String createdAt;

    // 状态常量
    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_APPROVED = "approved";
    public static final String STATUS_REJECTED = "rejected";
    public static final String STATUS_CANCELLED = "cancelled";

    // 构造函数
    public Registration() {}

    @Ignore
    public Registration(String id, String exhibitionId, String exhibitionTitle,
                       int exhibitionDay, String exhibitionTime, String exhibitionVenue,
                       String visitorName, String visitorType, String needsSummary,
                       String status, String visitorId) {
        this.id = id;
        this.exhibitionId = exhibitionId;
        this.exhibitionTitle = exhibitionTitle;
        this.exhibitionDay = exhibitionDay;
        this.exhibitionTime = exhibitionTime;
        this.exhibitionVenue = exhibitionVenue;
        this.visitorName = visitorName;
        this.visitorType = visitorType;
        this.needsSummary = needsSummary;
        this.status = status;
        this.visitorId = visitorId;
    }

    // Getters and Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getExhibitionId() {
        return exhibitionId;
    }

    public void setExhibitionId(String exhibitionId) {
        this.exhibitionId = exhibitionId;
    }

    public String getExhibitionTitle() {
        return exhibitionTitle;
    }

    public void setExhibitionTitle(String exhibitionTitle) {
        this.exhibitionTitle = exhibitionTitle;
    }

    public int getExhibitionDay() {
        return exhibitionDay;
    }

    public void setExhibitionDay(int exhibitionDay) {
        this.exhibitionDay = exhibitionDay;
    }

    public String getExhibitionTime() {
        return exhibitionTime;
    }

    public void setExhibitionTime(String exhibitionTime) {
        this.exhibitionTime = exhibitionTime;
    }

    public String getExhibitionVenue() {
        return exhibitionVenue;
    }

    public void setExhibitionVenue(String exhibitionVenue) {
        this.exhibitionVenue = exhibitionVenue;
    }

    public String getVisitorName() {
        return visitorName;
    }

    public void setVisitorName(String visitorName) {
        this.visitorName = visitorName;
    }

    public String getVisitorType() {
        return visitorType;
    }

    public void setVisitorType(String visitorType) {
        this.visitorType = visitorType;
    }

    public String getNeedsSummary() {
        return needsSummary;
    }

    public void setNeedsSummary(String needsSummary) {
        this.needsSummary = needsSummary;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getVisitorId() {
        return visitorId;
    }

    public void setVisitorId(String visitorId) {
        this.visitorId = visitorId;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * 获取状态显示文本
     * @return 状态显示文本
     */
    public String getStatusText() {
        switch (status) {
            case STATUS_PENDING:
                return "待审核";
            case STATUS_APPROVED:
                return "已通过";
            case STATUS_REJECTED:
                return "已拒绝";
            case STATUS_CANCELLED:
                return "已取消";
            default:
                return status;
        }
    }

    /**
     * 检查是否待审核
     * @return 是否待审核
     */
    public boolean isPending() {
        return STATUS_PENDING.equals(status);
    }

    /**
     * 检查是否已通过
     * @return 是否已通过
     */
    public boolean isApproved() {
        return STATUS_APPROVED.equals(status);
    }

    /**
     * 检查是否已拒绝
     * @return 是否已拒绝
     */
    public boolean isRejected() {
        return STATUS_REJECTED.equals(status);
    }

    /**
     * 检查是否已取消
     * @return 是否已取消
     */
    public boolean isCancelled() {
        return STATUS_CANCELLED.equals(status);
    }

    @Override
    public String toString() {
        return "Registration{" +
                "id='" + id + '\'' +
                ", exhibitionTitle='" + exhibitionTitle + '\'' +
                ", visitorName='" + visitorName + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}
