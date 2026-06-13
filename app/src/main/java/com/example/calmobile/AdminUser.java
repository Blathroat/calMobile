package com.example.calmobile;

/**
 * Mutable user model for the admin backend.
 * All data is in-memory only (current session).
 */
public class AdminUser {
    public static final String STATUS_ACTIVE = "正常";
    public static final String STATUS_BANNED = "封禁";
    public static final String STATUS_RESTRICTED = "受限";

    private final String id;
    private String nickname;
    private String email;
    private String status;
    private String registrationTime;
    private String lastLoginTime;

    AdminUser(String id, String nickname, String email, String status,
              String registrationTime, String lastLoginTime) {
        this.id = id;
        this.nickname = nickname;
        this.email = email;
        this.status = status;
        this.registrationTime = registrationTime;
        this.lastLoginTime = lastLoginTime;
    }

    public String getId() {
        return id;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
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

    public boolean isActive() {
        return STATUS_ACTIVE.equals(status);
    }

    public boolean isBanned() {
        return STATUS_BANNED.equals(status);
    }
}
