package com.example.calmobile;

import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for {@link AuthManager}.
 * Uses reflection to reset the singleton between tests so each test
 * starts with only the pre-populated "demo" user.
 */
public class AuthManagerTest {

    private AuthManager auth;

    @Before
    public void resetSingleton() throws Exception {
        Field instanceField = AuthManager.class.getDeclaredField("instance");
        instanceField.setAccessible(true);
        instanceField.set(null, null);
        auth = AuthManager.getInstance();
    }

    // ── getInstance (singleton) ──────────────────────────────────

    @Test
    public void getInstanceReturnsSameInstance() {
        AuthManager a = AuthManager.getInstance();
        AuthManager b = AuthManager.getInstance();
        assertSame(a, b);
    }

    private static void assertSame(Object a, Object b) {
        assertTrue("Expected same instance", a == b);
    }

    // ── register ─────────────────────────────────────────────────

    @Test
    public void registerSuccessReturnsNull() {
        assertNull(auth.register("alice", "password123", "alice@example.com"));
    }

    @Test
    public void registerIncreasesUserCount() {
        int before = auth.getUserCount();
        auth.register("alice", "password123", "alice@example.com");
        assertEquals(before + 1, auth.getUserCount());
    }

    @Test
    public void registerDuplicateUsernameReturnsError() {
        auth.register("alice", "password123", "alice@example.com");
        String result = auth.register("alice", "otherpass", "other@example.com");
        assertNotNull(result);
        assertTrue(result.contains("已存在"));
    }

    @Test
    public void registerDuplicateCaseInsensitive() {
        auth.register("Alice", "password123", "alice@example.com");
        String result = auth.register("alice", "otherpass", "other@example.com");
        assertNotNull(result);
        assertTrue(result.contains("已存在"));
    }

    @Test
    public void registerNullUsernameReturnsError() {
        assertNotNull(auth.register(null, "password123", "alice@example.com"));
    }

    @Test
    public void registerEmptyUsernameReturnsError() {
        assertNotNull(auth.register("", "password123", "alice@example.com"));
    }

    @Test
    public void registerBlankUsernameReturnsError() {
        assertNotNull(auth.register("   ", "password123", "alice@example.com"));
    }

    @Test
    public void registerNullPasswordReturnsError() {
        assertNotNull(auth.register("alice", null, "alice@example.com"));
    }

    @Test
    public void registerShortPasswordReturnsError() {
        assertNotNull(auth.register("alice", "ab", "alice@example.com"));
    }

    @Test
    public void registerExactlyThreeCharPasswordReturnsError() {
        assertNotNull(auth.register("alice", "abc", "alice@example.com"));
    }

    @Test
    public void registerFourCharPasswordSucceeds() {
        assertNull(auth.register("alice", "abcd", "alice@example.com"));
    }

    @Test
    public void registerNullEmailReturnsError() {
        assertNotNull(auth.register("alice", "password123", null));
    }

    @Test
    public void registerEmptyEmailReturnsError() {
        assertNotNull(auth.register("alice", "password123", ""));
    }

    @Test
    public void registerBlankEmailReturnsError() {
        assertNotNull(auth.register("alice", "password123", "   "));
    }

    @Test
    public void registerTrimsWhitespaceFromUsername() {
        auth.register("  alice  ", "password123", "alice@example.com");
        // Login should work with trimmed username
        assertNull(auth.login("alice", "password123"));
    }

    @Test
    public void registerTrimsWhitespaceFromEmail() {
        auth.register("alice", "password123", "  alice@example.com  ");
        // Verify registration succeeded
        assertNull(auth.login("alice", "password123"));
    }

    // ── login ────────────────────────────────────────────────────

    @Test
    public void loginWithValidCredentialsReturnsNull() {
        assertNull(auth.login("demo", "password"));
    }

    @Test
    public void loginSetsCurrentUser() {
        auth.login("demo", "password");
        assertTrue(auth.isLoggedIn());
        assertEquals("demo", auth.getCurrentUsername());
    }

    @Test
    public void loginWithNullUsernameReturnsError() {
        assertNotNull(auth.login(null, "password"));
    }

    @Test
    public void loginWithEmptyUsernameReturnsError() {
        assertNotNull(auth.login("", "password"));
    }

    @Test
    public void loginWithBlankUsernameReturnsError() {
        assertNotNull(auth.login("  ", "password"));
    }

    @Test
    public void loginWithNullPasswordReturnsError() {
        assertNotNull(auth.login("demo", null));
    }

    @Test
    public void loginWithEmptyPasswordReturnsError() {
        assertNotNull(auth.login("demo", ""));
    }

    @Test
    public void loginWithNonexistentUserReturnsError() {
        String result = auth.login("nobody", "password");
        assertNotNull(result);
        assertTrue(result.contains("不存在"));
    }

    @Test
    public void loginWithWrongPasswordReturnsError() {
        String result = auth.login("demo", "wrongpassword");
        assertNotNull(result);
        assertTrue(result.contains("错误"));
    }

    @Test
    public void loginIsCaseInsensitive() {
        assertNull(auth.login("DEMO", "password"));
        assertNull(auth.login("Demo", "password"));
    }

    @Test
    public void loginTrimsWhitespace() {
        assertNull(auth.login("  demo  ", "password"));
    }

    @Test
    public void loginDoesNotAffectOtherSession() {
        auth.register("alice", "pass1234", "alice@example.com");
        auth.login("demo", "password");
        assertEquals("demo", auth.getCurrentUsername());

        auth.login("alice", "pass1234");
        assertEquals("alice", auth.getCurrentUsername());
    }

    // ── logout ───────────────────────────────────────────────────

    @Test
    public void logoutClearsSession() {
        auth.login("demo", "password");
        assertTrue(auth.isLoggedIn());

        auth.logout();
        assertFalse(auth.isLoggedIn());
        assertNull(auth.getCurrentUsername());
    }

    @Test
    public void logoutWhenNotLoggedInIsSafe() {
        assertFalse(auth.isLoggedIn());
        auth.logout(); // should not throw
        assertFalse(auth.isLoggedIn());
    }

    // ── isLoggedIn / getCurrentUsername ───────────────────────────

    @Test
    public void initiallyNotLoggedIn() {
        assertFalse(auth.isLoggedIn());
        assertNull(auth.getCurrentUsername());
    }

    @Test
    public void getCurrentUserEmailReturnsNullWhenNotLoggedIn() {
        assertNull(auth.getCurrentUserEmail());
    }

    @Test
    public void getCurrentUserEmailReturnsEmailAfterLogin() {
        auth.login("demo", "password");
        assertEquals("demo@example.com", auth.getCurrentUserEmail());
    }

    @Test
    public void getCurrentUserEmailForNewUser() {
        auth.register("alice", "pass1234", "alice@example.com");
        auth.login("alice", "pass1234");
        assertEquals("alice@example.com", auth.getCurrentUserEmail());
    }

    // ── getUserCount ─────────────────────────────────────────────

    @Test
    public void getUserCountIncludesDemoUser() {
        assertEquals(1, auth.getUserCount());
    }

    @Test
    public void getUserCountAfterRegistrations() {
        auth.register("alice", "pass1234", "alice@example.com");
        auth.register("bob", "pass1234", "bob@example.com");
        assertEquals(3, auth.getUserCount()); // demo + alice + bob
    }

    // ── Edge cases / integration ─────────────────────────────────

    @Test
    public void registerThenLoginThenLogoutFlow() {
        assertNull(auth.register("alice", "pass1234", "alice@example.com"));
        assertFalse(auth.isLoggedIn());

        assertNull(auth.login("alice", "pass1234"));
        assertTrue(auth.isLoggedIn());
        assertEquals("alice", auth.getCurrentUsername());
        assertEquals("alice@example.com", auth.getCurrentUserEmail());

        auth.logout();
        assertFalse(auth.isLoggedIn());
        assertNull(auth.getCurrentUsername());
        assertNull(auth.getCurrentUserEmail());
    }

    @Test
    public void multipleLoginsOverwriteSession() {
        auth.register("alice", "pass1234", "alice@example.com");

        auth.login("demo", "password");
        assertEquals("demo", auth.getCurrentUsername());

        auth.login("alice", "pass1234");
        assertEquals("alice", auth.getCurrentUsername());
    }

    @Test
    public void loginAfterLogoutWorks() {
        auth.login("demo", "password");
        auth.logout();
        assertNull(auth.login("demo", "password"));
        assertEquals("demo", auth.getCurrentUsername());
    }

    @Test
    public void demoUserExistsFromConstructor() {
        assertEquals(1, auth.getUserCount());
        assertNull(auth.login("demo", "password"));
    }

    @Test
    public void registeredUserCanLogin() {
        auth.register("newuser", "securepass", "new@example.com");
        assertNull(auth.login("newuser", "securepass"));
        assertEquals("newuser", auth.getCurrentUsername());
    }
}
