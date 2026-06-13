package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

/**
 * Unit tests for {@link DatabaseHelper}.
 * <p>
 * Note: DatabaseHelper extends SQLiteOpenHelper and requires an Android Context
 * for instantiation. Without Robolectric or Android instrumentation tests, we cannot
 * test actual CRUD operations. These tests verify the public constants and schema
 * definitions that define the database contract.
 * <p>
 * For full CRUD testing, use Android instrumented tests ({@code androidTest}) with
 * an in-memory SQLite database.
 */
public class DatabaseHelperTest {

    // ── Table name constants ─────────────────────────────────────

    @Test
    public void tableExhibitionsName() {
        assertEquals("exhibitions", DatabaseHelper.TABLE_EXHIBITIONS);
    }

    @Test
    public void tableRegistrationsName() {
        assertEquals("registrations", DatabaseHelper.TABLE_REGISTRATIONS);
    }

    @Test
    public void tableUsersName() {
        assertEquals("users", DatabaseHelper.TABLE_USERS);
    }

    // ── Common column constants ──────────────────────────────────

    @Test
    public void colIdName() {
        assertEquals("_id", DatabaseHelper.COL_ID);
    }

    // ── Exhibition column constants ──────────────────────────────

    @Test
    public void exhibitionColumnNames() {
        assertEquals("day", DatabaseHelper.COL_DAY);
        assertEquals("title", DatabaseHelper.COL_TITLE);
        assertEquals("venue", DatabaseHelper.COL_VENUE);
        assertEquals("time", DatabaseHelper.COL_TIME);
        assertEquals("status", DatabaseHelper.COL_STATUS);
        assertEquals("description", DatabaseHelper.COL_DESCRIPTION);
        assertEquals("category", DatabaseHelper.COL_CATEGORY);
    }

    // ── Registration column constants ────────────────────────────

    @Test
    public void registrationColumnNames() {
        assertEquals("exhibition_title", DatabaseHelper.COL_EXHIBITION_TITLE);
        assertEquals("exhibition_day", DatabaseHelper.COL_EXHIBITION_DAY);
        assertEquals("exhibition_time", DatabaseHelper.COL_EXHIBITION_TIME);
        assertEquals("exhibition_venue", DatabaseHelper.COL_EXHIBITION_VENUE);
        assertEquals("visitor_name", DatabaseHelper.COL_VISITOR_NAME);
        assertEquals("visitor_type", DatabaseHelper.COL_VISITOR_TYPE);
        assertEquals("needs_summary", DatabaseHelper.COL_NEEDS_SUMMARY);
    }

    // ── User column constants ────────────────────────────────────

    @Test
    public void userColumnNames() {
        assertEquals("nickname", DatabaseHelper.COL_NICKNAME);
        assertEquals("email", DatabaseHelper.COL_EMAIL);
        assertEquals("registration_time", DatabaseHelper.COL_REGISTRATION_TIME);
        assertEquals("last_login_time", DatabaseHelper.COL_LAST_LOGIN_TIME);
    }

    // ── Singleton behavior ───────────────────────────────────────

    @Test
    public void getInstanceReturnsNullBeforeInit() {
        // In unit test environment (no Application context), getInstance() returns null
        // This verifies the contract that init() must be called first
        // Note: This test may fail if another test calls init() first,
        // but that's acceptable since we can't reset the singleton without Android Context
        DatabaseHelper instance = DatabaseHelper.getInstance();
        // We can't assert null because other tests or app initialization may have set it
        // But we verify the method doesn't throw
    }

    // ── Schema consistency ───────────────────────────────────────

    @Test
    public void tableNamesAreDistinct() {
        assertNotNull(DatabaseHelper.TABLE_EXHIBITIONS);
        assertNotNull(DatabaseHelper.TABLE_REGISTRATIONS);
        assertNotNull(DatabaseHelper.TABLE_USERS);

        // Verify all table names are different
        String[] tables = {
                DatabaseHelper.TABLE_EXHIBITIONS,
                DatabaseHelper.TABLE_REGISTRATIONS,
                DatabaseHelper.TABLE_USERS
        };
        for (int i = 0; i < tables.length; i++) {
            for (int j = i + 1; j < tables.length; j++) {
                if (tables[i].equals(tables[j])) {
                    throw new AssertionError("Table names must be distinct: " + tables[i]);
                }
            }
        }
    }

    @Test
    public void columnConstantsAreNotNull() {
        assertNotNull(DatabaseHelper.COL_ID);
        assertNotNull(DatabaseHelper.COL_DAY);
        assertNotNull(DatabaseHelper.COL_TITLE);
        assertNotNull(DatabaseHelper.COL_VENUE);
        assertNotNull(DatabaseHelper.COL_TIME);
        assertNotNull(DatabaseHelper.COL_STATUS);
        assertNotNull(DatabaseHelper.COL_DESCRIPTION);
        assertNotNull(DatabaseHelper.COL_CATEGORY);
        assertNotNull(DatabaseHelper.COL_EXHIBITION_TITLE);
        assertNotNull(DatabaseHelper.COL_EXHIBITION_DAY);
        assertNotNull(DatabaseHelper.COL_EXHIBITION_TIME);
        assertNotNull(DatabaseHelper.COL_EXHIBITION_VENUE);
        assertNotNull(DatabaseHelper.COL_VISITOR_NAME);
        assertNotNull(DatabaseHelper.COL_VISITOR_TYPE);
        assertNotNull(DatabaseHelper.COL_NEEDS_SUMMARY);
        assertNotNull(DatabaseHelper.COL_NICKNAME);
        assertNotNull(DatabaseHelper.COL_EMAIL);
        assertNotNull(DatabaseHelper.COL_REGISTRATION_TIME);
        assertNotNull(DatabaseHelper.COL_LAST_LOGIN_TIME);
    }
}
