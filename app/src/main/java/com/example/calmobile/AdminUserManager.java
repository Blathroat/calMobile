package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * In-memory user manager for admin backend.
 * Pattern mirrors ExhibitionManager: static list, CRUD, sample data.
 */
public class AdminUserManager {
    private static final List<AdminUser> users = new ArrayList<>();
    private static int nextId = 1;
    private static boolean initialized = false;

    /** Seed sample data on first access. */
    public static void ensureInitialized() {
        if (initialized) {
            return;
        }
        initialized = true;

        add("张伟", "zhangwei@example.com", AdminUser.STATUS_ACTIVE,
                "2025-01-15 09:30", "2026-06-12 14:20");
        add("李娜", "lina@example.com", AdminUser.STATUS_ACTIVE,
                "2025-02-20 11:00", "2026-06-11 10:15");
        add("王磊", "wanglei@example.com", AdminUser.STATUS_RESTRICTED,
                "2025-03-08 16:45", "2026-05-28 08:50");
        add("赵敏", "zhaomin@example.com", AdminUser.STATUS_BANNED,
                "2024-12-01 13:20", "2026-04-05 17:30");
        add("陈晨", "chenchen@example.com", AdminUser.STATUS_ACTIVE,
                "2025-04-12 10:10", "2026-06-13 09:00");
        add("刘洋", "liuyang@example.com", AdminUser.STATUS_ACTIVE,
                "2025-05-03 08:55", "2026-06-10 16:40");
    }

    public static AdminUser add(String nickname, String email, String status,
                                 String registrationTime, String lastLoginTime) {
        AdminUser user = new AdminUser("usr-" + nextId, nickname, email,
                status, registrationTime, lastLoginTime);
        nextId++;
        users.add(user);
        return user;
    }

    public static boolean updateStatus(String id, String newStatus) {
        AdminUser user = findById(id);
        if (user == null) {
            return false;
        }
        user.setStatus(newStatus);
        return true;
    }

    public static List<AdminUser> listAll() {
        return new ArrayList<>(users);
    }

    public static AdminUser findById(String id) {
        for (AdminUser user : users) {
            if (user.getId().equals(id)) {
                return user;
            }
        }
        return null;
    }

    public static int countByStatus(String status) {
        int count = 0;
        for (AdminUser user : users) {
            if (status.equals(user.getStatus())) {
                count++;
            }
        }
        return count;
    }
}
