package com.example.calmobile.models;

import com.google.gson.annotations.SerializedName;

/**
 * 状态更新请求模型
 */
public class StatusUpdate {

    @SerializedName("status")
    private String status;

    public StatusUpdate() {}

    public StatusUpdate(String status) {
        this.status = status;
    }

    // Getters and Setters
    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
