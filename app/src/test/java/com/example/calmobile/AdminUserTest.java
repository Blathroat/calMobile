package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AdminUserTest {

    private AdminUser createUser() {
        return new AdminUser("usr-1", "张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-15 09:30", "2026-06-12 14:20");
    }

    // --- Status constants ---

    @Test
    public void statusConstantsAreDistinct() {
        assertFalse(AdminUser.STATUS_ACTIVE.equals(AdminUser.STATUS_BANNED));
        assertFalse(AdminUser.STATUS_ACTIVE.equals(AdminUser.STATUS_RESTRICTED));
        assertFalse(AdminUser.STATUS_BANNED.equals(AdminUser.STATUS_RESTRICTED));
    }

    @Test
    public void statusConstantsHaveExpectedValues() {
        assertEquals("正常", AdminUser.STATUS_ACTIVE);
        assertEquals("封禁", AdminUser.STATUS_BANNED);
        assertEquals("受限", AdminUser.STATUS_RESTRICTED);
    }

    // --- Constructor / getters ---

    @Test
    public void constructorSetsAllFields() {
        AdminUser user = createUser();

        assertEquals("usr-1", user.getId());
        assertEquals("张伟", user.getNickname());
        assertEquals("zhangwei@example.com", user.getEmail());
        assertEquals(AdminUser.STATUS_ACTIVE, user.getStatus());
        assertEquals("2025-01-15 09:30", user.getRegistrationTime());
        assertEquals("2026-06-12 14:20", user.getLastLoginTime());
    }

    // --- Setters ---

    @Test
    public void setNicknameUpdatesValue() {
        AdminUser user = createUser();
        user.setNickname("新昵称");
        assertEquals("新昵称", user.getNickname());
    }

    @Test
    public void setEmailUpdatesValue() {
        AdminUser user = createUser();
        user.setEmail("new@example.com");
        assertEquals("new@example.com", user.getEmail());
    }

    @Test
    public void setStatusUpdatesValue() {
        AdminUser user = createUser();
        user.setStatus(AdminUser.STATUS_BANNED);
        assertEquals(AdminUser.STATUS_BANNED, user.getStatus());
    }

    @Test
    public void setRegistrationTimeUpdatesValue() {
        AdminUser user = createUser();
        user.setRegistrationTime("2025-06-01 10:00");
        assertEquals("2025-06-01 10:00", user.getRegistrationTime());
    }

    @Test
    public void setLastLoginTimeUpdatesValue() {
        AdminUser user = createUser();
        user.setLastLoginTime("2026-07-01 12:00");
        assertEquals("2026-07-01 12:00", user.getLastLoginTime());
    }

    // --- isActive / isBanned ---

    @Test
    public void isActiveWhenStatusIsActive() {
        AdminUser user = createUser();
        assertTrue(user.isActive());
    }

    @Test
    public void isNotActiveWhenStatusIsBanned() {
        AdminUser user = createUser();
        user.setStatus(AdminUser.STATUS_BANNED);
        assertFalse(user.isActive());
    }

    @Test
    public void isNotActiveWhenStatusIsRestricted() {
        AdminUser user = createUser();
        user.setStatus(AdminUser.STATUS_RESTRICTED);
        assertFalse(user.isActive());
    }

    @Test
    public void isBannedWhenStatusIsBanned() {
        AdminUser user = createUser();
        user.setStatus(AdminUser.STATUS_BANNED);
        assertTrue(user.isBanned());
    }

    @Test
    public void isNotBannedWhenStatusIsActive() {
        AdminUser user = createUser();
        assertFalse(user.isBanned());
    }

    @Test
    public void isNotBannedWhenStatusIsRestricted() {
        AdminUser user = createUser();
        user.setStatus(AdminUser.STATUS_RESTRICTED);
        assertFalse(user.isBanned());
    }

    // --- Edge cases ---

    @Test
    public void idIsImmutable() {
        AdminUser user = createUser();
        assertEquals("usr-1", user.getId());
        // No setter for id — value should remain the same
        assertEquals("usr-1", user.getId());
    }

    @Test
    public void settersAcceptNull() {
        AdminUser user = createUser();
        user.setNickname(null);
        assertNull(user.getNickname());
        user.setEmail(null);
        assertNull(user.getEmail());
        user.setStatus(null);
        assertNull(user.getStatus());
        user.setRegistrationTime(null);
        assertNull(user.getRegistrationTime());
        user.setLastLoginTime(null);
        assertNull(user.getLastLoginTime());
    }

    @Test
    public void isActiveFalseWhenStatusIsNull() {
        AdminUser user = new AdminUser("usr-null", "n", "e", null, "r", "l");
        assertFalse(user.isActive());
    }

    @Test
    public void isBannedFalseWhenStatusIsNull() {
        AdminUser user = new AdminUser("usr-null", "n", "e", null, "r", "l");
        assertFalse(user.isBanned());
    }

    @Test
    public void constructorAcceptsNullFields() {
        AdminUser user = new AdminUser("usr-null", null, null, null, null, null);
        assertEquals("usr-null", user.getId());
        assertNull(user.getNickname());
        assertNull(user.getEmail());
        assertNull(user.getStatus());
        assertNull(user.getRegistrationTime());
        assertNull(user.getLastLoginTime());
    }
}
