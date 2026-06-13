package com.example.calmobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/**
 * SQLiteOpenHelper singleton for the calMobile app.
 * Manages three tables: exhibitions, registrations, users.
 * Initialized once via {@link #init(Context)} from {@link CalMobileApp#onCreate()}.
 */
public class DatabaseHelper extends SQLiteOpenHelper {

    private static final String DATABASE_NAME = "calmobile.db";
    private static final int DATABASE_VERSION = 1;

    // Table names
    public static final String TABLE_EXHIBITIONS = "exhibitions";
    public static final String TABLE_REGISTRATIONS = "registrations";
    public static final String TABLE_USERS = "users";

    // Common column
    public static final String COL_ID = "_id";

    // Exhibition columns
    public static final String COL_DAY = "day";
    public static final String COL_TITLE = "title";
    public static final String COL_VENUE = "venue";
    public static final String COL_TIME = "time";
    public static final String COL_STATUS = "status";
    public static final String COL_DESCRIPTION = "description";
    public static final String COL_CATEGORY = "category";

    // Registration columns
    public static final String COL_EXHIBITION_TITLE = "exhibition_title";
    public static final String COL_EXHIBITION_DAY = "exhibition_day";
    public static final String COL_EXHIBITION_TIME = "exhibition_time";
    public static final String COL_EXHIBITION_VENUE = "exhibition_venue";
    public static final String COL_VISITOR_NAME = "visitor_name";
    public static final String COL_VISITOR_TYPE = "visitor_type";
    public static final String COL_NEEDS_SUMMARY = "needs_summary";

    // User columns
    public static final String COL_NICKNAME = "nickname";
    public static final String COL_EMAIL = "email";
    public static final String COL_REGISTRATION_TIME = "registration_time";
    public static final String COL_LAST_LOGIN_TIME = "last_login_time";

    private static DatabaseHelper instance;

    private DatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    /** Must be called once from Application.onCreate(). */
    public static synchronized void init(Context context) {
        if (instance == null) {
            instance = new DatabaseHelper(context.getApplicationContext());
        }
    }

    /** Returns the singleton, or null if init() has not been called. */
    public static synchronized DatabaseHelper getInstance() {
        return instance;
    }

    // ── Schema ────────────────────────────────────────────────────

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE_EXHIBITIONS + " ("
                + COL_ID + " TEXT PRIMARY KEY, "
                + COL_DAY + " INTEGER NOT NULL, "
                + COL_TITLE + " TEXT NOT NULL, "
                + COL_VENUE + " TEXT NOT NULL, "
                + COL_TIME + " TEXT NOT NULL, "
                + COL_STATUS + " TEXT NOT NULL, "
                + COL_DESCRIPTION + " TEXT NOT NULL DEFAULT '', "
                + COL_CATEGORY + " TEXT NOT NULL DEFAULT '')");

        db.execSQL("CREATE TABLE " + TABLE_REGISTRATIONS + " ("
                + COL_ID + " TEXT PRIMARY KEY, "
                + COL_EXHIBITION_TITLE + " TEXT NOT NULL, "
                + COL_EXHIBITION_DAY + " INTEGER NOT NULL, "
                + COL_EXHIBITION_TIME + " TEXT NOT NULL, "
                + COL_EXHIBITION_VENUE + " TEXT NOT NULL, "
                + COL_VISITOR_NAME + " TEXT NOT NULL, "
                + COL_VISITOR_TYPE + " TEXT NOT NULL, "
                + COL_NEEDS_SUMMARY + " TEXT NOT NULL DEFAULT '', "
                + COL_STATUS + " TEXT NOT NULL)");

        db.execSQL("CREATE TABLE " + TABLE_USERS + " ("
                + COL_ID + " TEXT PRIMARY KEY, "
                + COL_NICKNAME + " TEXT NOT NULL, "
                + COL_EMAIL + " TEXT NOT NULL, "
                + COL_STATUS + " TEXT NOT NULL, "
                + COL_REGISTRATION_TIME + " TEXT NOT NULL DEFAULT '', "
                + COL_LAST_LOGIN_TIME + " TEXT NOT NULL DEFAULT '')");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Incremental migration strategy:
        // Add version-specific blocks here as schema evolves.
        // if (oldVersion < 2) { db.execSQL("ALTER TABLE ..."); }
        // if (oldVersion < 3) { ... }
        //
        // For now (v1 → v1 is a no-op; fresh installs only):
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_REGISTRATIONS);
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_EXHIBITIONS);
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_USERS);
        onCreate(db);
    }

    // ── ID generation ─────────────────────────────────────────────

    /**
     * Returns the next sequential integer for a prefixed-ID column.
     * Parses the numeric suffix after {@code prefix} so that deleted-row
     * gaps are skipped safely.
     */
    private int getNextId(SQLiteDatabase db, String table, String prefix) {
        int prefixLen = prefix.length() + 1; // 1-indexed SUBSTR offset
        Cursor cursor = db.rawQuery(
                "SELECT MAX(CAST(SUBSTR(" + COL_ID + ", " + prefixLen + ") AS INTEGER)) FROM " + table,
                null);
        int nextId = 1;
        if (cursor != null) {
            try {
                if (cursor.moveToFirst() && !cursor.isNull(0)) {
                    nextId = cursor.getInt(0) + 1;
                }
            } finally {
                cursor.close();
            }
        }
        return nextId;
    }

    // ── Exhibition CRUD ───────────────────────────────────────────

    public String insertExhibition(int day, String title, String venue, String time,
            String status, String description, String category) {
        SQLiteDatabase db = getWritableDatabase();
        int nextId = getNextId(db, TABLE_EXHIBITIONS, "exh-");
        String id = "exh-" + nextId;

        ContentValues values = new ContentValues();
        values.put(COL_ID, id);
        values.put(COL_DAY, day);
        values.put(COL_TITLE, title);
        values.put(COL_VENUE, venue);
        values.put(COL_TIME, time);
        values.put(COL_STATUS, status);
        values.put(COL_DESCRIPTION, description);
        values.put(COL_CATEGORY, category);

        try {
            db.insertOrThrow(TABLE_EXHIBITIONS, null, values);
        } catch (Exception e) {
            return null;
        }
        return id;
    }

    public boolean updateExhibition(String id, int day, String title, String venue, String time,
            String status, String description, String category) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_DAY, day);
        values.put(COL_TITLE, title);
        values.put(COL_VENUE, venue);
        values.put(COL_TIME, time);
        values.put(COL_STATUS, status);
        values.put(COL_DESCRIPTION, description);
        values.put(COL_CATEGORY, category);

        try {
            return db.update(TABLE_EXHIBITIONS, values, COL_ID + " = ?", new String[]{id}) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean updateExhibitionStatus(String id, String newStatus) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_STATUS, newStatus);

        try {
            return db.update(TABLE_EXHIBITIONS, values, COL_ID + " = ?", new String[]{id}) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean deleteExhibition(String id) {
        SQLiteDatabase db = getWritableDatabase();
        try {
            return db.delete(TABLE_EXHIBITIONS, COL_ID + " = ?", new String[]{id}) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    public List<ExhibitorExhibition> getAllExhibitions() {
        List<ExhibitorExhibition> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_EXHIBITIONS, null, null, null, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    list.add(cursorToExhibition(cursor));
                }
            }
        } catch (Exception e) {
            // Return whatever was collected so far
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return list;
    }

    public ExhibitorExhibition getExhibitionById(String id) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_EXHIBITIONS, null, COL_ID + " = ?", new String[]{id}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursorToExhibition(cursor);
            }
        } catch (Exception e) {
            // Fall through to return null
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    public int getExhibitionCount() {
        return getRowCount(TABLE_EXHIBITIONS);
    }

    public List<ExhibitorExhibition> searchExhibitions(String query) {
        List<ExhibitorExhibition> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        String like = "%" + query + "%";
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_EXHIBITIONS, null,
                    COL_TITLE + " LIKE ? OR " + COL_VENUE + " LIKE ? OR "
                            + COL_CATEGORY + " LIKE ? OR " + COL_DESCRIPTION + " LIKE ?",
                    new String[]{like, like, like, like}, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    list.add(cursorToExhibition(cursor));
                }
            }
        } catch (Exception e) {
            // Return whatever was collected so far
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return list;
    }

    private ExhibitorExhibition cursorToExhibition(Cursor c) {
        return new ExhibitorExhibition(
                c.getString(c.getColumnIndexOrThrow(COL_ID)),
                c.getInt(c.getColumnIndexOrThrow(COL_DAY)),
                c.getString(c.getColumnIndexOrThrow(COL_TITLE)),
                c.getString(c.getColumnIndexOrThrow(COL_VENUE)),
                c.getString(c.getColumnIndexOrThrow(COL_TIME)),
                c.getString(c.getColumnIndexOrThrow(COL_STATUS)),
                c.getString(c.getColumnIndexOrThrow(COL_DESCRIPTION)),
                c.getString(c.getColumnIndexOrThrow(COL_CATEGORY)));
    }

    // ── Registration CRUD ─────────────────────────────────────────

    public String insertRegistration(String exhibitionTitle, int exhibitionDay,
            String exhibitionTime, String exhibitionVenue, String visitorName,
            String visitorType, String needsSummary, String status) {
        SQLiteDatabase db = getWritableDatabase();
        int nextId = getNextId(db, TABLE_REGISTRATIONS, "registration-");
        String id = "registration-" + nextId;

        ContentValues values = new ContentValues();
        values.put(COL_ID, id);
        values.put(COL_EXHIBITION_TITLE, exhibitionTitle);
        values.put(COL_EXHIBITION_DAY, exhibitionDay);
        values.put(COL_EXHIBITION_TIME, exhibitionTime);
        values.put(COL_EXHIBITION_VENUE, exhibitionVenue);
        values.put(COL_VISITOR_NAME, visitorName);
        values.put(COL_VISITOR_TYPE, visitorType);
        values.put(COL_NEEDS_SUMMARY, needsSummary);
        values.put(COL_STATUS, status);

        try {
            db.insertOrThrow(TABLE_REGISTRATIONS, null, values);
        } catch (Exception e) {
            return null;
        }
        return id;
    }

    public boolean updateRegistrationStatus(String id, String status) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_STATUS, status);

        try {
            return db.update(TABLE_REGISTRATIONS, values, COL_ID + " = ?", new String[]{id}) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    public List<Registration> getAllRegistrations() {
        List<Registration> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_REGISTRATIONS, null, null, null, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    list.add(cursorToRegistration(cursor));
                }
            }
        } catch (Exception e) {
            // Return whatever was collected so far
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return list;
    }

    public Registration getRegistrationById(String id) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_REGISTRATIONS, null, COL_ID + " = ?", new String[]{id}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursorToRegistration(cursor);
            }
        } catch (Exception e) {
            // Fall through to return null
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    private Registration cursorToRegistration(Cursor c) {
        String statusStr = c.getString(c.getColumnIndexOrThrow(COL_STATUS));
        Registration.Status status = "CANCELLED".equals(statusStr)
                ? Registration.Status.CANCELLED : Registration.Status.PENDING;
        return new Registration(
                c.getString(c.getColumnIndexOrThrow(COL_ID)),
                c.getString(c.getColumnIndexOrThrow(COL_EXHIBITION_TITLE)),
                c.getInt(c.getColumnIndexOrThrow(COL_EXHIBITION_DAY)),
                c.getString(c.getColumnIndexOrThrow(COL_EXHIBITION_TIME)),
                c.getString(c.getColumnIndexOrThrow(COL_EXHIBITION_VENUE)),
                c.getString(c.getColumnIndexOrThrow(COL_VISITOR_NAME)),
                c.getString(c.getColumnIndexOrThrow(COL_VISITOR_TYPE)),
                c.getString(c.getColumnIndexOrThrow(COL_NEEDS_SUMMARY)),
                status);
    }

    // ── User CRUD ─────────────────────────────────────────────────

    public String insertUser(String nickname, String email, String status,
            String registrationTime, String lastLoginTime) {
        SQLiteDatabase db = getWritableDatabase();
        int nextId = getNextId(db, TABLE_USERS, "usr-");
        String id = "usr-" + nextId;

        ContentValues values = new ContentValues();
        values.put(COL_ID, id);
        values.put(COL_NICKNAME, nickname);
        values.put(COL_EMAIL, email);
        values.put(COL_STATUS, status);
        values.put(COL_REGISTRATION_TIME, registrationTime);
        values.put(COL_LAST_LOGIN_TIME, lastLoginTime);

        try {
            db.insertOrThrow(TABLE_USERS, null, values);
        } catch (Exception e) {
            return null;
        }
        return id;
    }

    public boolean updateUserStatus(String id, String newStatus) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_STATUS, newStatus);

        try {
            return db.update(TABLE_USERS, values, COL_ID + " = ?", new String[]{id}) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    public List<AdminUser> getAllUsers() {
        List<AdminUser> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_USERS, null, null, null, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    list.add(cursorToUser(cursor));
                }
            }
        } catch (Exception e) {
            // Return whatever was collected so far
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return list;
    }

    public AdminUser getUserById(String id) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_USERS, null, COL_ID + " = ?", new String[]{id}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursorToUser(cursor);
            }
        } catch (Exception e) {
            // Fall through to return null
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    public int getUserCountByStatus(String status) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(
                    "SELECT COUNT(*) FROM " + TABLE_USERS + " WHERE " + COL_STATUS + " = ?",
                    new String[]{status});
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
        } catch (Exception e) {
            // Fall through to return 0
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return 0;
    }

    public int getUserCount() {
        return getRowCount(TABLE_USERS);
    }

    public List<AdminUser> searchUsers(String query) {
        List<AdminUser> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        String like = "%" + query + "%";
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_USERS, null,
                    COL_NICKNAME + " LIKE ? OR " + COL_EMAIL + " LIKE ?",
                    new String[]{like, like}, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    list.add(cursorToUser(cursor));
                }
            }
        } catch (Exception e) {
            // Return whatever was collected so far
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return list;
    }

    private AdminUser cursorToUser(Cursor c) {
        return new AdminUser(
                c.getString(c.getColumnIndexOrThrow(COL_ID)),
                c.getString(c.getColumnIndexOrThrow(COL_NICKNAME)),
                c.getString(c.getColumnIndexOrThrow(COL_EMAIL)),
                c.getString(c.getColumnIndexOrThrow(COL_STATUS)),
                c.getString(c.getColumnIndexOrThrow(COL_REGISTRATION_TIME)),
                c.getString(c.getColumnIndexOrThrow(COL_LAST_LOGIN_TIME)));
    }

    // ── Utility ───────────────────────────────────────────────────

    private int getRowCount(String table) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.rawQuery("SELECT COUNT(*) FROM " + table, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
        } catch (Exception e) {
            // Fall through to return 0
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return 0;
    }
}
