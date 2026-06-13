package com.example.calmobile;

import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Integration tests for the complete user management workflow:
 * create → ban → unban.
 *
 * Tests exercise AdminUserManager end-to-end using in-memory storage.
 */
public class UserManagementWorkflowIntegrationTest {

    @Before
    public void resetStaticState() throws Exception {
        Field usersField = AdminUserManager.class.getDeclaredField("fallbackUsers");
        usersField.setAccessible(true);
        ((List<?>) usersField.get(null)).clear();

        Field nextIdField = AdminUserManager.class.getDeclaredField("fallbackNextId");
        nextIdField.setAccessible(true);
        nextIdField.setInt(null, 1);

        Field initializedField = AdminUserManager.class.getDeclaredField("initialized");
        initializedField.setAccessible(true);
        initializedField.setBoolean(null, false);
    }

    // ── Full lifecycle: create → ban → unban ──────────────────────

    @Test
    public void fullLifecycleCreateBanUnban() {
        // Step 1: Create user with active status
        AdminUser user = AdminUserManager.add(
                "测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-15 09:30", "2026-06-12 14:20");

        assertNotNull(user);
        String id = user.getId();
        assertEquals("测试用户", user.getNickname());
        assertTrue(user.isActive());
        assertFalse(user.isBanned());

        // Step 2: Ban the user
        assertTrue(AdminUserManager.updateStatus(id, AdminUser.STATUS_BANNED));
        AdminUser banned = AdminUserManager.findById(id);
        assertNotNull(banned);
        assertEquals(AdminUser.STATUS_BANNED, banned.getStatus());
        assertTrue(banned.isBanned());
        assertFalse(banned.isActive());

        // Step 3: Unban (restore to active)
        assertTrue(AdminUserManager.updateStatus(id, AdminUser.STATUS_ACTIVE));
        AdminUser unbanned = AdminUserManager.findById(id);
        assertNotNull(unbanned);
        assertEquals(AdminUser.STATUS_ACTIVE, unbanned.getStatus());
        assertFalse(unbanned.isBanned());
        assertTrue(unbanned.isActive());
    }

    // ── Status counts reflect ban/unban changes ───────────────────

    @Test
    public void statusCountsReflectBanUnbanChanges() {
        AdminUserManager.add("用户A", "a@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.add("用户B", "b@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-01", "2026-06-01");
        AdminUserManager.add("用户C", "c@example.com",
                AdminUser.STATUS_ACTIVE, "2025-03-01", "2026-06-01");

        assertEquals(3, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(0, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));

        // Ban user A
        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_BANNED);
        assertEquals(2, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));

        // Ban user B
        AdminUserManager.updateStatus("usr-2", AdminUser.STATUS_BANNED);
        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(2, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));

        // Unban user A
        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_ACTIVE);
        assertEquals(2, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));
    }

    // ── Multiple users managed independently ──────────────────────

    @Test
    public void multipleUsersManagedIndependently() {
        AdminUser u1 = AdminUserManager.add("张伟", "zw@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUser u2 = AdminUserManager.add("李娜", "ln@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-01", "2026-06-01");
        AdminUser u3 = AdminUserManager.add("王磊", "wl@example.com",
                AdminUser.STATUS_ACTIVE, "2025-03-01", "2026-06-01");

        assertEquals(3, AdminUserManager.listAll().size());

        // Ban only the second user
        assertTrue(AdminUserManager.updateStatus(u2.getId(), AdminUser.STATUS_BANNED));

        // Verify others unchanged
        assertEquals(AdminUser.STATUS_ACTIVE, AdminUserManager.findById(u1.getId()).getStatus());
        assertEquals(AdminUser.STATUS_BANNED, AdminUserManager.findById(u2.getId()).getStatus());
        assertEquals(AdminUser.STATUS_ACTIVE, AdminUserManager.findById(u3.getId()).getStatus());
    }

    // ── Restricted status in workflow ─────────────────────────────

    @Test
    public void restrictThenBanThenUnbanWorkflow() {
        AdminUser user = AdminUserManager.add("测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        String id = user.getId();

        // Active → Restricted
        assertTrue(AdminUserManager.updateStatus(id, AdminUser.STATUS_RESTRICTED));
        assertEquals(AdminUser.STATUS_RESTRICTED, AdminUserManager.findById(id).getStatus());
        assertFalse(AdminUserManager.findById(id).isActive());
        assertFalse(AdminUserManager.findById(id).isBanned());

        // Restricted → Banned
        assertTrue(AdminUserManager.updateStatus(id, AdminUser.STATUS_BANNED));
        assertTrue(AdminUserManager.findById(id).isBanned());

        // Banned → Active (full unban)
        assertTrue(AdminUserManager.updateStatus(id, AdminUser.STATUS_ACTIVE));
        assertTrue(AdminUserManager.findById(id).isActive());
        assertFalse(AdminUserManager.findById(id).isBanned());
    }

    // ── User data preserved through status changes ────────────────

    @Test
    public void userDataPreservedThroughStatusChanges() {
        AdminUser user = AdminUserManager.add("持久用户", "persist@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-15 09:30", "2026-06-12 14:20");
        String id = user.getId();

        AdminUserManager.updateStatus(id, AdminUser.STATUS_BANNED);
        AdminUserManager.updateStatus(id, AdminUser.STATUS_RESTRICTED);
        AdminUserManager.updateStatus(id, AdminUser.STATUS_ACTIVE);

        AdminUser final_user = AdminUserManager.findById(id);
        assertEquals("持久用户", final_user.getNickname());
        assertEquals("persist@example.com", final_user.getEmail());
        assertEquals("2025-01-15 09:30", final_user.getRegistrationTime());
        assertEquals("2026-06-12 14:20", final_user.getLastLoginTime());
    }

    // ── Ban nonexistent user returns false ────────────────────────

    @Test
    public void updateStatusNonexistentUserReturnsFalse() {
        assertFalse(AdminUserManager.updateStatus("nonexistent", AdminUser.STATUS_BANNED));
    }

    // ── Search finds users after creation ─────────────────────────

    @Test
    public void searchFindsCreatedUsers() {
        AdminUserManager.add("张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.add("李娜", "lina@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-01", "2026-06-01");

        List<AdminUser> results = AdminUserManager.search("张伟");
        assertEquals(1, results.size());
        assertEquals("张伟", results.get(0).getNickname());
    }

    // ── Search finds banned users too ─────────────────────────────

    @Test
    public void searchFindsBannedUsers() {
        AdminUserManager.add("封禁用户", "banned@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_BANNED);

        List<AdminUser> results = AdminUserManager.search("封禁用户");
        assertEquals(1, results.size());
        assertEquals(AdminUser.STATUS_BANNED, results.get(0).getStatus());
    }

    // ── List returns independent copy ─────────────────────────────

    @Test
    public void listReturnsIndependentCopy() {
        AdminUserManager.add("用户", "u@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");

        List<AdminUser> copy = AdminUserManager.listAll();
        copy.clear();

        assertEquals(1, AdminUserManager.listAll().size());
    }
}
