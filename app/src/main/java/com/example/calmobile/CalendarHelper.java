package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;
import android.widget.Toast;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Helper class for adding/removing exhibitions to/from the device calendar.
 *
 * Uses Android CalendarContract API to create calendar events.
 * Tracks which exhibitions have been added via SharedPreferences,
 * mapping a unique exhibition key (title + "_" + day) to the calendar event ID.
 *
 * Exhibitions use day (1-30) for June of the current year, and a time string
 * in the format "HH:mm-HH:mm" (e.g. "09:00-17:30").
 */
public class CalendarHelper {

    private static final String PREFS_NAME = "calendar_event_mapping";
    private static final int EVENT_DURATION_HOURS = 2; // default if parsing fails
    private static final int EXHIBITION_YEAR = 2026;
    private static final int EXHIBITION_MONTH = Calendar.JUNE; // 0-indexed (5 = June)

    // Permission request codes
    public static final int REQUEST_CODE_CALENDAR_PERMISSION = 4001;

    // ── Permission handling ────────────────────────────────────────────

    /**
     * Check if both READ_CALENDAR and WRITE_CALENDAR permissions are granted.
     * On API < 23, always returns true (runtime permissions not required).
     */
    public static boolean hasCalendarPermissions(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int read = context.checkSelfPermission(Manifest.permission.READ_CALENDAR);
            int write = context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR);
            return read == PackageManager.PERMISSION_GRANTED
                    && write == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    /**
     * Request READ_CALENDAR and WRITE_CALENDAR permissions from an Activity.
     * Does nothing on API < 23.
     */
    @SuppressWarnings("deprecation")
    public static void requestCalendarPermissions(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!hasCalendarPermissions(activity)) {
                activity.requestPermissions(
                        new String[]{
                                Manifest.permission.READ_CALENDAR,
                                Manifest.permission.WRITE_CALENDAR
                        },
                        REQUEST_CODE_CALENDAR_PERMISSION);
            }
        }
    }

    // ── Calendar event operations ──────────────────────────────────────

    /**
     * Add an exhibition to the device calendar.
     *
     * @param context     application or activity context
     * @param title       exhibition title
     * @param venue       exhibition venue (used as event location)
     * @param day         exhibition day (1-30) in June
     * @param time        time range, e.g. "09:00-17:30"
     * @param description exhibition description
     * @return true if the event was successfully added
     */
    public static boolean addToCalendar(Context context, String title, String venue,
                                         int day, String time, String description) {
        if (!hasCalendarPermissions(context)) {
            Toast.makeText(context, R.string.calendar_permission_denied, Toast.LENGTH_SHORT).show();
            return false;
        }

        String key = makeKey(title, day);
        if (isInCalendar(context, key)) {
            Toast.makeText(context, R.string.calendar_already_added, Toast.LENGTH_SHORT).show();
            return true; // already added, treat as success
        }

        long calendarId = getDefaultCalendarId(context);
        if (calendarId == -1) {
            Toast.makeText(context, R.string.calendar_no_account, Toast.LENGTH_SHORT).show();
            return false;
        }

        long[] startEnd = parseTimeRange(day, time);
        long startMillis = startEnd[0];
        long endMillis = startEnd[1];

        ContentResolver cr = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(CalendarContract.Events.DTSTART, startMillis);
        values.put(CalendarContract.Events.DTEND, endMillis);
        values.put(CalendarContract.Events.TITLE, title);
        values.put(CalendarContract.Events.DESCRIPTION, description);
        values.put(CalendarContract.Events.EVENT_LOCATION, venue);
        values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
        values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());

        try {
            Uri uri = cr.insert(CalendarContract.Events.CONTENT_URI, values);
            if (uri != null) {
                long eventId = Long.parseLong(uri.getLastPathSegment());
                saveEventId(context, key, eventId);
                Toast.makeText(context, R.string.calendar_added, Toast.LENGTH_SHORT).show();
                return true;
            }
        } catch (Exception e) {
            // Fall through to failure
        }

        Toast.makeText(context, R.string.calendar_add_failed, Toast.LENGTH_SHORT).show();
        return false;
    }

    /**
     * Check if an exhibition is already in the device calendar.
     *
     * @param context application context
     * @param title   exhibition title
     * @param day     exhibition day (1-30)
     * @return true if the exhibition has been added to the calendar
     */
    public static boolean isInCalendar(Context context, String title, int day) {
        return isInCalendar(context, makeKey(title, day));
    }

    /**
     * Check if an exhibition is already in the device calendar by key.
     */
    private static boolean isInCalendar(Context context, String key) {
        long eventId = getEventId(context, key);
        if (eventId == -1) {
            return false;
        }
        // Verify the event still exists in the calendar provider
        if (!hasCalendarPermissions(context)) {
            return false;
        }
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CalendarContract.Events.CONTENT_URI,
                    new String[]{CalendarContract.Events._ID},
                    CalendarContract.Events._ID + " = ?",
                    new String[]{String.valueOf(eventId)},
                    null);
            return cursor != null && cursor.moveToFirst();
        } catch (Exception e) {
            return false;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /**
     * Remove an exhibition from the device calendar.
     *
     * @param context application context
     * @param title   exhibition title
     * @param day     exhibition day (1-30)
     * @return true if the event was successfully removed
     */
    public static boolean removeFromCalendar(Context context, String title, int day) {
        if (!hasCalendarPermissions(context)) {
            Toast.makeText(context, R.string.calendar_permission_denied, Toast.LENGTH_SHORT).show();
            return false;
        }

        String key = makeKey(title, day);
        long eventId = getEventId(context, key);
        if (eventId == -1) {
            Toast.makeText(context, R.string.calendar_not_in_calendar, Toast.LENGTH_SHORT).show();
            return false;
        }

        ContentResolver cr = context.getContentResolver();
        try {
            int deleted = cr.delete(
                    CalendarContract.Events.CONTENT_URI,
                    CalendarContract.Events._ID + " = ?",
                    new String[]{String.valueOf(eventId)});
            if (deleted > 0) {
                removeEventId(context, key);
                Toast.makeText(context, R.string.calendar_removed, Toast.LENGTH_SHORT).show();
                return true;
            }
        } catch (Exception e) {
            // Fall through to failure
        }

        // Event may have been deleted externally; clean up mapping
        removeEventId(context, key);
        Toast.makeText(context, R.string.calendar_remove_failed, Toast.LENGTH_SHORT).show();
        return false;
    }

    // ── Calendar account lookup ────────────────────────────────────────

    /**
     * Find the default calendar account ID for the device.
     * Returns the first available calendar, or -1 if none found.
     */
    private static long getDefaultCalendarId(Context context) {
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CalendarContract.Calendars.CONTENT_URI,
                    new String[]{CalendarContract.Calendars._ID},
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?",
                    new String[]{String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR)},
                    null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        } catch (Exception e) {
            // Fall through
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1;
    }

    // ── Time parsing ───────────────────────────────────────────────────

    /**
     * Parse a time range string and day into start/end millisecond timestamps.
     * Time format: "HH:mm-HH:mm" (e.g. "09:00-17:30").
     * Falls back to a default 2-hour window if parsing fails.
     *
     * @param day  day of month (1-30) in June
     * @param time time range string
     * @return long[2] with {startMillis, endMillis}
     */
    static long[] parseTimeRange(int day, String time) {
        int startHour = 9, startMin = 0, endHour = 17, endMin = 0;

        if (time != null && time.contains("-")) {
            try {
                String[] parts = time.split("-");
                String[] startParts = parts[0].trim().split(":");
                String[] endParts = parts[1].trim().split(":");
                startHour = Integer.parseInt(startParts[0]);
                startMin = Integer.parseInt(startParts[1]);
                endHour = Integer.parseInt(endParts[0]);
                endMin = Integer.parseInt(endParts[1]);
            } catch (Exception e) {
                // Use defaults
            }
        }

        Calendar start = Calendar.getInstance();
        start.set(EXHIBITION_YEAR, EXHIBITION_MONTH, day, startHour, startMin, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar end = Calendar.getInstance();
        end.set(EXHIBITION_YEAR, EXHIBITION_MONTH, day, endHour, endMin, 0);
        end.set(Calendar.MILLISECOND, 0);

        // If end is before or equal to start, add a default duration
        if (end.getTimeInMillis() <= start.getTimeInMillis()) {
            end.setTimeInMillis(start.getTimeInMillis());
            end.add(Calendar.HOUR_OF_DAY, EVENT_DURATION_HOURS);
        }

        return new long[]{start.getTimeInMillis(), end.getTimeInMillis()};
    }

    // ── SharedPreferences mapping (exhibition key → calendar event ID) ─

    private static String makeKey(String title, int day) {
        return title + "_" + day;
    }

    private static void saveEventId(Context context, String key, long eventId) {
        getPrefs(context).edit().putLong(key, eventId).apply();
    }

    private static long getEventId(Context context, String key) {
        return getPrefs(context).getLong(key, -1);
    }

    private static void removeEventId(Context context, String key) {
        getPrefs(context).edit().remove(key).apply();
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
