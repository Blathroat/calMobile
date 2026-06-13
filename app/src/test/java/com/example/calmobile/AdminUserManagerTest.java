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

public class AdminUserManagerTest {

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

    // --- ensureInitialized ---

    @Test
    public void ensureInitializedSeedsSampleData() {
        AdminUserManager.ensureInitialized();

        List<AdminUser> list = AdminUserManager.listAll();
        assertEquals(6, list.size());
    }

    @Test
    public void ensureInitializedIsIdempotent() {
        AdminUserManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        List<AdminUser> list = AdminUserManager.listAll();
        assertEquals(6, list.size());
    }

    @Test
    public void initializedUsersHaveCorrectStatuses() {
        AdminUserManager.ensureInitialized();

        List<AdminUser> list = AdminUserManager.listAll();
        assertEquals(AdminUser.STATUS_ACTIVE, list.get(0).getStatus());
        assertEquals(AdminUser.STATUS_ACTIVE, list.get(1).getStatus());
        assertEquals(AdminUser.STATUS_RESTRICTED, list.get(2).getStatus());
        assertEquals(AdminUser.STATUS_BANNED, list.get(3).getStatus());
        assertEquals(AdminUser.STATUS_ACTIVE, list.get(4).getStatus());
        assertEquals(AdminUser.STATUS_ACTIVE, list.get(5).getStatus());
    }

    // --- add ---

    @Test
    public void addCreatesUserWithAutoId() {
        AdminUser user = AdminUserManager.add("测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01 10:00", "2025-06-01 12:00");

        assertNotNull(user);
        assertEquals("usr-1", user.getId());
        assertEquals("测试用户", user.getNickname());
    }

    @Test
    public void addIncrementsIdAutomatically() {
        AdminUser first = AdminUserManager.add("用户1", "a@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        AdminUser second = AdminUserManager.add("用户2", "b@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");

        assertEquals("usr-1", first.getId());
        assertEquals("usr-2", second.getId());
    }

    @Test
    public void addIncreasesListSize() {
        assertEquals(0, AdminUserManager.listAll().size());

        AdminUserManager.add("用户1", "a@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        assertEquals(1, AdminUserManager.listAll().size());

        AdminUserManager.add("用户2", "b@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        assertEquals(2, AdminUserManager.listAll().size());
    }

    @Test
    public void addWithDifferentStatuses() {
        AdminUser active = AdminUserManager.add("活跃", "a@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        AdminUser banned = AdminUserManager.add("封禁", "b@b.com",
                AdminUser.STATUS_BANNED, "2025-01-01", "2025-06-01");
        AdminUser restricted = AdminUserManager.add("受限", "c@b.com",
                AdminUser.STATUS_RESTRICTED, "2025-01-01", "2025-06-01");

        assertEquals(AdminUser.STATUS_ACTIVE, active.getStatus());
        assertEquals(AdminUser.STATUS_BANNED, banned.getStatus());
        assertEquals(AdminUser.STATUS_RESTRICTED, restricted.getStatus());
    }

    // --- listAll ---

    @Test
    public void listAllReturnsEmptyListWhenNoUsers() {
        List<AdminUser> list = AdminUserManager.listAll();
        assertTrue(list.isEmpty());
    }

    @Test
    public void listAllReturnsCopy() {
        AdminUserManager.add("用户1", "a@b.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");

        List<AdminUser> list = AdminUserManager.listAll();
        list.clear();

        assertEquals(1, AdminUserManager.listAll().size());
    }

    // --- findById ---

    @Test
    public void findByIdReturnsUser() {
        AdminUserManager.add("测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");

        AdminUser found = AdminUserManager.findById("usr-1");
        assertNotNull(found);
        assertEquals("测试用户", found.getNickname());
    }

    @Test
    public void findByIdReturnsNullForMissingId() {
        assertNull(AdminUserManager.findById("nonexistent"));
    }

    @Test
    public void findByIdReturnsNullForNullId() {
        assertNull(AdminUserManager.findById(null));
    }

    @Test
    public void findByIdReturnsNullForEmptyString() {
        assertNull(AdminUserManager.findById(""));
    }

    // --- updateStatus ---

    @Test
    public void updateStatusChangesStatus() {
        AdminUserManager.add("测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");

        assertTrue(AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_BANNED));
        assertEquals(AdminUser.STATUS_BANNED, AdminUserManager.findById("usr-1").getStatus());
    }

    @Test
    public void updateStatusReturnsFalseForMissingId() {
        assertFalse(AdminUserManager.updateStatus("nonexistent", AdminUser.STATUS_BANNED));
    }

    @Test
    public void updateStatusCanTransitionThroughAllStates() {
        AdminUserManager.add("测试用户", "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");

        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_BANNED);
        assertEquals(AdminUser.STATUS_BANNED, AdminUserManager.findById("usr-1").getStatus());

        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_RESTRICTED);
        assertEquals(AdminUser.STATUS_RESTRICTED, AdminUserManager.findById("usr-1").getStatus());

        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_ACTIVE);
        assertEquals(AdminUser.STATUS_ACTIVE, AdminUserManager.findById("usr-1").getStatus());
    }

    // --- countByStatus ---

    @Test
    public void countByStatusReturnsZeroWhenEmpty() {
        assertEquals(0, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
    }

    @Test
    public void countByStatusCountsCorrectly() {
        AdminUserManager.add("活跃1", "a@b.com", AdminUser.STATUS_ACTIVE,
                "2025-01-01", "2025-06-01");
        AdminUserManager.add("活跃2", "b@b.com", AdminUser.STATUS_ACTIVE,
                "2025-01-01", "2025-06-01");
        AdminUserManager.add("封禁1", "c@b.com", AdminUser.STATUS_BANNED,
                "2025-01-01", "2025-06-01");

        assertEquals(2, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));
        assertEquals(0, AdminUserManager.countByStatus(AdminUser.STATUS_RESTRICTED));
    }

    @Test
    public void countByStatusReflectsStatusChanges() {
        AdminUserManager.add("用户1", "a@b.com", AdminUser.STATUS_ACTIVE,
                "2025-01-01", "2025-06-01");
        AdminUserManager.add("用户2", "b@b.com", AdminUser.STATUS_ACTIVE,
                "2025-01-01", "2025-06-01");

        assertEquals(2, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));

        AdminUserManager.updateStatus("usr-1", AdminUser.STATUS_BANNED);

        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE));
        assertEquals(1, AdminUserManager.countByStatus(AdminUser.STATUS_BANNED));
    }

    // --- Edge cases ---

    @Test
    public void addWithNullNickname() {
        AdminUser user = AdminUserManager.add(null, "test@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        assertNull(user.getNickname());
        assertNotNull(user.getId());
    }

    @Test
    public void addWithNullEmail() {
        AdminUser user = AdminUserManager.add("用户", null,
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2025-06-01");
        assertNull(user.getEmail());
    }
}
