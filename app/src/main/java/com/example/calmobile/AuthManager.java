package com.example.calmobile;

import java.util.HashMap;
import java.util.Map;

/**
 * In-memory authentication manager for demo purposes.
 * Will be integrated with SQLite later.
 * Uses simple HashMap for user storage and session management.
 */
public class AuthManager {

    private static AuthManager instance;

    private static final String ROLE_USER = "user";
    private static final String ROLE_EXHIBITOR = "exhibitor";
    private static final String ROLE_ADMIN = "admin";

    // User storage: username -> UserRecord
    private final Map<String, UserRecord> users = new HashMap<>();

    // Current session
    private String currentUsername;

    private AuthManager() {
        // Pre-populate with a demo user for testing
        users.put("demo", new UserRecord("demo", "password", "demo@example.com", ROLE_ADMIN));
    }

    public static synchronized AuthManager getInstance() {
        if (instance == null) {
            instance = new AuthManager();
        }
        return instance;
    }

    /**
     * Register a new user.
     * @return null on success, error message on failure
     */
    public String register(String username, String password, String email) {
        if (username == null || username.trim().isEmpty()) {
            return "用户名不能为空";
        }
        if (password == null || password.length() < 4) {
            return "密码至少需要4个字符";
        }
        if (email == null || email.trim().isEmpty()) {
            return "邮箱不能为空";
        }

        String key = username.trim().toLowerCase();
        if (users.containsKey(key)) {
            return "用户名已存在";
        }

        users.put(key, new UserRecord(key, password, email.trim(), ROLE_USER));
        return null; // success
    }

    /**
     * Login with username and password.
     * @return null on success, error message on failure
     */
    public String login(String username, String password) {
        if (username == null || username.trim().isEmpty()) {
            return "请输入用户名";
        }
        if (password == null || password.isEmpty()) {
            return "请输入密码";
        }

        String key = username.trim().toLowerCase();
        UserRecord record = users.get(key);
        if (record == null) {
            return "用户不存在";
        }
        if (!record.password.equals(password)) {
            return "密码错误";
        }

        currentUsername = key;
        return null; // success
    }

    /**
     * Logout the current user.
     */
    public void logout() {
        currentUsername = null;
    }

    /**
     * Continue without an authenticated user.
     */
    public void enterAsGuest() {
        currentUsername = null;
    }

    /**
     * Check if a user is currently logged in.
     */
    public boolean isLoggedIn() {
        return currentUsername != null;
    }

    /**
     * Check whether the current session is an unauthenticated guest.
     */
    public boolean isGuest() {
        return !isLoggedIn();
    }

    /**
     * Get the current logged-in username, or null if not logged in.
     */
    public String getCurrentUsername() {
        return currentUsername;
    }

    /**
     * Get the email of the current logged-in user.
     */
    public String getCurrentUserEmail() {
        if (currentUsername == null) return null;
        UserRecord record = users.get(currentUsername);
        return record != null ? record.email : null;
    }

    /**
     * Get the total number of registered users (for admin display).
     */
    public int getUserCount() {
        return users.size();
    }

    /**
     * Check whether profile-only actions are available.
     */
    public boolean canAccessProfile() {
        return isLoggedIn();
    }

    /**
     * Check whether registration actions are available.
     */
    public boolean canRegisterForExhibitions() {
        return isLoggedIn();
    }

    /**
     * Check whether the current user has exhibitor permissions.
     */
    public boolean isExhibitor() {
        UserRecord record = getCurrentUserRecord();
        return record != null
                && (ROLE_EXHIBITOR.equals(record.role) || ROLE_ADMIN.equals(record.role));
    }

    public boolean canAccessExhibitor() {
        return isExhibitor();
    }

    /**
     * Check whether the current user has admin permissions.
     */
    public boolean isAdmin() {
        UserRecord record = getCurrentUserRecord();
        return record != null && ROLE_ADMIN.equals(record.role);
    }

    public boolean canAccessAdmin() {
        return isAdmin();
    }

    private UserRecord getCurrentUserRecord() {
        if (currentUsername == null) return null;
        return users.get(currentUsername);
    }

    /**
     * Internal user record.
     */
    private static class UserRecord {
        final String username;
        final String password;
        final String email;
        final String role;

        UserRecord(String username, String password, String email, String role) {
            this.username = username;
            this.password = password;
            this.email = email;
            this.role = role;
        }
    }
}
