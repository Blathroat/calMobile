package com.example.calmobile.models;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Ignore;
import androidx.room.PrimaryKey;

import com.google.gson.annotations.SerializedName;

/**
 * 展会数据模型
 * 对应数据库 exhibitions 表
 */
@Entity(tableName = "exhibitions")
public class Exhibition {

    @PrimaryKey
    @NonNull
    @ColumnInfo(name = "id")
    @SerializedName("id")
    private String id = "";

    @ColumnInfo(name = "title")
    @SerializedName("title")
    private String title;

    @ColumnInfo(name = "venue")
    @SerializedName("venue")
    private String venue;

    @ColumnInfo(name = "day")
    @SerializedName("day")
    private int day;

    @ColumnInfo(name = "month")
    @SerializedName("month")
    private int month;

    @ColumnInfo(name = "year")
    @SerializedName("year")
    private int year;

    @ColumnInfo(name = "time")
    @SerializedName("time")
    private String time;

    @ColumnInfo(name = "status")
    @SerializedName("status")
    private String status;

    @ColumnInfo(name = "open_for_registration")
    @SerializedName("open_for_registration")
    private boolean openForRegistration;

    @ColumnInfo(name = "description")
    @SerializedName("description")
    private String description;

    @ColumnInfo(name = "category")
    @SerializedName("category")
    private String category;

    @ColumnInfo(name = "exhibitor_id")
    @SerializedName("exhibitor_id")
    private String exhibitorId;

    // 构造函数
    public Exhibition() {}

    @Ignore
    public Exhibition(String id, String title, String venue, int day, int month, int year,
                     String time, String status, boolean openForRegistration,
                     String description, String category, String exhibitorId) {
        this.id = id;
        this.title = title;
        this.venue = venue;
        this.day = day;
        this.month = month;
        this.year = year;
        this.time = time;
        this.status = status;
        this.openForRegistration = openForRegistration;
        this.description = description;
        this.category = category;
        this.exhibitorId = exhibitorId;
    }

    // Getters and Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
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

    public int getDay() {
        return day;
    }

    public void setDay(int day) {
        this.day = day;
    }

    public int getMonth() {
        return month;
    }

    public void setMonth(int month) {
        this.month = month;
    }

    public int getYear() {
        return year;
    }

    public void setYear(int year) {
        this.year = year;
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

    public boolean isOpenForRegistration() {
        return openForRegistration;
    }

    public void setOpenForRegistration(boolean openForRegistration) {
        this.openForRegistration = openForRegistration;
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

    public String getExhibitorId() {
        return exhibitorId;
    }

    public void setExhibitorId(String exhibitorId) {
        this.exhibitorId = exhibitorId;
    }

    /**
     * 获取状态显示文本
     * @return 状态显示文本
     */
    public String getStatusText() {
        switch (status) {
            case "报名中":
                return "报名中";
            case "截止报名":
                return "已锁定";
            case "已结束":
                return "已结束";
            default:
                return status;
        }
    }

    /**
     * 获取日期显示文本
     * @return 日期显示文本
     */
    public String getDateText() {
        return year + "年" + month + "月" + day + "日";
    }

    /**
     * 获取完整地址
     * @return 完整地址
     */
    public String getFullAddress() {
        return venue;
    }

    @Override
    public String toString() {
        return "Exhibition{" +
                "id='" + id + '\'' +
                ", title='" + title + '\'' +
                ", venue='" + venue + '\'' +
                ", day=" + day +
                ", month=" + month +
                ", year=" + year +
                ", time='" + time + '\'' +
                ", status='" + status + '\'' +
                ", openForRegistration=" + openForRegistration +
                ", category='" + category + '\'' +
                '}';
    }
}
