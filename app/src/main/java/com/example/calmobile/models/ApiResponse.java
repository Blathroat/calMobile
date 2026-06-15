package com.example.calmobile.models;

import com.google.gson.annotations.SerializedName;

/**
 * API 通用响应包装类
 * @param <T> 数据类型
 */
public class ApiResponse<T> {

    @SerializedName("data")
    private T data;

    @SerializedName("error")
    private String error;

    @SerializedName("message")
    private String message;

    @SerializedName("meta")
    private Meta meta;

    // Getters and Setters
    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public Meta getMeta() {
        return meta;
    }

    public void setMeta(Meta meta) {
        this.meta = meta;
    }

    /**
     * 检查响应是否成功
     * @return 是否成功
     */
    public boolean isSuccess() {
        return error == null && data != null;
    }

    /**
     * 获取错误消息
     * @return 错误消息
     */
    public String getErrorMessage() {
        return message != null ? message : error;
    }

    /**
     * 元数据类（用于分页等）
     */
    public static class Meta {
        @SerializedName("page")
        private int page;

        @SerializedName("total")
        private int total;

        @SerializedName("limit")
        private int limit;

        // Getters and Setters
        public int getPage() {
            return page;
        }

        public void setPage(int page) {
            this.page = page;
        }

        public int getTotal() {
            return total;
        }

        public void setTotal(int total) {
            this.total = total;
        }

        public int getLimit() {
            return limit;
        }

        public void setLimit(int limit) {
            this.limit = limit;
        }
    }
}
