package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * User manager backed by SQLite (via {@link DatabaseHelper}).
 * Falls back to in-memory storage when no database is available
 * (e.g. unit tests without Application context).
 * <p>
 * Public API is unchanged from the original in-memory version.
 */
public class AdminUserManager {

    // ── In-memory fallback (test environments) ────────────────────
    private static final List<AdminUser> fallbackUsers = new ArrayList<>();
    private static int fallbackNextId = 1;
    private static boolean initialized = false;

    /** Seed sample data on first access. */
    public static void ensureInitialized() {
        if (initialized) {
            return;
        }
        initialized = true;

        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            // SQLite mode — only seed if table is empty
            if (dbHelper.getUserCount() == 0) {
                seedDatabase(dbHelper);
            }
        } else {
            // In-memory fallback (test environment)
            seedInMemory();
        }
    }

    public static AdminUser add(String nickname, String email, String status,
                                 String registrationTime, String lastLoginTime) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            String id = dbHelper.insertUser(nickname, email, status, registrationTime, lastLoginTime);
            if (id != null) {
                return dbHelper.getUserById(id);
            }
            return null;
        }
        return addInMemory(nickname, email, status, registrationTime, lastLoginTime);
    }

    public static boolean updateStatus(String id, String newStatus) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.updateUserStatus(id, newStatus);
        }
        AdminUser user = findByIdInMemory(id);
        if (user == null) {
            return false;
        }
        user.setStatus(newStatus);
        return true;
    }

    public static List<AdminUser> listAll() {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getAllUsers();
        }
        return new ArrayList<>(fallbackUsers);
    }

    public static AdminUser findById(String id) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getUserById(id);
        }
        return findByIdInMemory(id);
    }

    /**
     * Search users by query string (case-insensitive).
     * Matches against nickname and email using simple contains.
     */
    public static List<AdminUser> search(String query) {
        List<AdminUser> results = new ArrayList<>();
        if (query == null || query.trim().isEmpty()) {
            return results;
        }
        String lowerQuery = query.trim().toLowerCase();
        List<AdminUser> all = listAll();
        for (AdminUser user : all) {
            if (matchesUser(user, lowerQuery)) {
                results.add(user);
            }
        }
        return results;
    }

    private static boolean matchesUser(AdminUser user, String lowerQuery) {
        if (user.getNickname() != null && user.getNickname().toLowerCase().contains(lowerQuery)) {
            return true;
        }
        if (user.getEmail() != null && user.getEmail().toLowerCase().contains(lowerQuery)) {
            return true;
        }
        return false;
    }

    public static int countByStatus(String status) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getUserCountByStatus(status);
        }
        int count = 0;
        for (AdminUser user : fallbackUsers) {
            if (status.equals(user.getStatus())) {
                count++;
            }
        }
        return count;
    }

    // ── In-memory helpers ─────────────────────────────────────────

    private static void seedDatabase(DatabaseHelper dbHelper) {
        dbHelper.insertUser("张伟", "zhangwei@example.com", AdminUser.STATUS_ACTIVE,
                "2025-01-15 09:30", "2026-06-12 14:20");
        dbHelper.insertUser("李娜", "lina@example.com", AdminUser.STATUS_ACTIVE,
                "2025-02-20 11:00", "2026-06-11 10:15");
        dbHelper.insertUser("王磊", "wanglei@example.com", AdminUser.STATUS_RESTRICTED,
                "2025-03-08 16:45", "2026-05-28 08:50");
        dbHelper.insertUser("赵敏", "zhaomin@example.com", AdminUser.STATUS_BANNED,
                "2024-12-01 13:20", "2026-04-05 17:30");
        dbHelper.insertUser("陈晨", "chenchen@example.com", AdminUser.STATUS_ACTIVE,
                "2025-04-12 10:10", "2026-06-13 09:00");
        dbHelper.insertUser("刘洋", "liuyang@example.com", AdminUser.STATUS_ACTIVE,
                "2025-05-03 08:55", "2026-06-10 16:40");
    }

    private static void seedInMemory() {
        addInMemory("张伟", "zhangwei@example.com", AdminUser.STATUS_ACTIVE,
                "2025-01-15 09:30", "2026-06-12 14:20");
        addInMemory("李娜", "lina@example.com", AdminUser.STATUS_ACTIVE,
                "2025-02-20 11:00", "2026-06-11 10:15");
        addInMemory("王磊", "wanglei@example.com", AdminUser.STATUS_RESTRICTED,
                "2025-03-08 16:45", "2026-05-28 08:50");
        addInMemory("赵敏", "zhaomin@example.com", AdminUser.STATUS_BANNED,
                "2024-12-01 13:20", "2026-04-05 17:30");
        addInMemory("陈晨", "chenchen@example.com", AdminUser.STATUS_ACTIVE,
                "2025-04-12 10:10", "2026-06-13 09:00");
        addInMemory("刘洋", "liuyang@example.com", AdminUser.STATUS_ACTIVE,
                "2025-05-03 08:55", "2026-06-10 16:40");
    }

    private static AdminUser addInMemory(String nickname, String email, String status,
            String registrationTime, String lastLoginTime) {
        AdminUser user = new AdminUser("usr-" + fallbackNextId, nickname, email,
                status, registrationTime, lastLoginTime);
        fallbackNextId++;
        fallbackUsers.add(user);
        return user;
    }

    private static AdminUser findByIdInMemory(String id) {
        for (AdminUser user : fallbackUsers) {
            if (user.getId().equals(id)) {
                return user;
            }
        }
        return null;
    }
}
