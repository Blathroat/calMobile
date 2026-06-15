package com.example.calmobile.models;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Ignore;
import androidx.room.PrimaryKey;

import com.google.gson.annotations.SerializedName;

/**
 * 用户数据模型
 * 对应数据库 users 表
 */
@Entity(tableName = "users")
public class User {

    @PrimaryKey
    @NonNull
    @ColumnInfo(name = "id")
    @SerializedName("id")
    private String id = "";

    @ColumnInfo(name = "username")
    @SerializedName("username")
    private String username;

    @ColumnInfo(name = "email")
    @SerializedName("email")
    private String email;

    @ColumnInfo(name = "nickname")
    @SerializedName("nickname")
    private String nickname;

    @ColumnInfo(name = "role")
    @SerializedName("role")
    private String role;

    @ColumnInfo(name = "status")
    @SerializedName("status")
    private String status;

    @ColumnInfo(name = "bio")
    @SerializedName("bio")
    private String bio;

    @ColumnInfo(name = "contact")
    @SerializedName("contact")
    private String contact;

    @ColumnInfo(name = "social_media")
    @SerializedName("social_media")
    private String socialMedia;

    @ColumnInfo(name = "registration_time")
    @SerializedName("registration_time")
    private String registrationTime;

    @ColumnInfo(name = "last_login_time")
    @SerializedName("last_login_time")
    private String lastLoginTime;

    // 角色常量
    public static final String ROLE_USER = "user";
    public static final String ROLE_EXHIBITOR = "exhibitor";
    public static final String ROLE_ADMIN = "admin";

    // 状态常量
    public static final String STATUS_ACTIVE = "active";
    public static final String STATUS_BANNED = "banned";
    public static final String STATUS_RESTRICTED = "restricted";

    // 构造函数
    public User() {}

    @Ignore
    public User(String id, String username, String email, String nickname,
                String role, String status, String bio, String contact,
                String socialMedia, String registrationTime, String lastLoginTime) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.nickname = nickname;
        this.role = role;
        this.status = status;
        this.bio = bio;
        this.contact = contact;
        this.socialMedia = socialMedia;
        this.registrationTime = registrationTime;
        this.lastLoginTime = lastLoginTime;
    }

    // Getters and Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getBio() {
        return bio;
    }

    public void setBio(String bio) {
        this.bio = bio;
    }

    public String getContact() {
        return contact;
    }

    public void setContact(String contact) {
        this.contact = contact;
    }

    public String getSocialMedia() {
        return socialMedia;
    }

    public void setSocialMedia(String socialMedia) {
        this.socialMedia = socialMedia;
    }

    public String getRegistrationTime() {
        return registrationTime;
    }

    public void setRegistrationTime(String registrationTime) {
        this.registrationTime = registrationTime;
    }

    public String getLastLoginTime() {
        return lastLoginTime;
    }

    public void setLastLoginTime(String lastLoginTime) {
        this.lastLoginTime = lastLoginTime;
    }

    /**
     * 检查是否为管理员
     * @return 是否为管理员
     */
    public boolean isAdmin() {
        return ROLE_ADMIN.equals(role);
    }

    /**
     * 检查是否为展商
     * @return 是否为展商
     */
    public boolean isExhibitor() {
        return ROLE_EXHIBITOR.equals(role) || ROLE_ADMIN.equals(role);
    }

    /**
     * 检查是否为普通用户
     * @return 是否为普通用户
     */
    public boolean isUser() {
        return ROLE_USER.equals(role);
    }

    /**
     * 检查账号是否激活
     * @return 是否激活
     */
    public boolean isActive() {
        return STATUS_ACTIVE.equals(status);
    }

    /**
     * 检查账号是否被封禁
     * @return 是否被封禁
     */
    public boolean isBanned() {
        return STATUS_BANNED.equals(status);
    }

    /**
     * 检查账号是否被限制
     * @return 是否被限制
     */
    public boolean isRestricted() {
        return STATUS_RESTRICTED.equals(status);
    }

    /**
     * 获取状态显示文本
     * @return 状态显示文本
     */
    public String getStatusText() {
        switch (status) {
            case STATUS_ACTIVE:
                return "正常";
            case STATUS_BANNED:
                return "封禁";
            case STATUS_RESTRICTED:
                return "受限";
            default:
                return status;
        }
    }

    /**
     * 获取角色显示文本
     * @return 角色显示文本
     */
    public String getRoleText() {
        switch (role) {
            case ROLE_USER:
                return "普通用户";
            case ROLE_EXHIBITOR:
                return "展商";
            case ROLE_ADMIN:
                return "管理员";
            default:
                return role;
        }
    }

    @Override
    public String toString() {
        return "User{" +
                "id='" + id + '\'' +
                ", username='" + username + '\'' +
                ", email='" + email + '\'' +
                ", nickname='" + nickname + '\'' +
                ", role='" + role + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}
