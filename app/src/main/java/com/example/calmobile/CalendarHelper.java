package com.example.calmobile;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * 系统日历读写：把展会写进设备日历 / 从日历移除 / 判断是否已在日历中。
 *
 * 日期一律用后端下发的 ISO 日期（`YYYY-MM-DD`）**原样**使用：展会日期由后端按
 * 「相对今天」生成，写死年月会让事件落到错误的月份（旧实现就写死了 2026-06）。
 * 时间用 `HH:mm-HH:mm`，解析失败时退回 9:00-17:00。
 *
 * 是否「已加入」由 {@code SharedPreferences} 里的「标题 + 日期 → 事件 id」映射判断，
 * 并且会回查 CalendarProvider 确认事件还在（用户可能在系统日历里删掉它）。
 *
 * 这里不弹 Toast：失败原因随 {@link CalendarResult} 回到页面，由前端统一提示，
 * 避免同一个失败弹两次。
 */
public class CalendarHelper {

    private static final String PREFS_NAME = "calendar_event_mapping";
    private static final int EVENT_DURATION_HOURS = 2; // 起止时间解析失败或倒挂时的默认时长

    /** 写/删日历的结果：成功，或一句给用户看的原因（取自 res/values/strings.xml）。 */
    static final class CalendarResult {
        final boolean ok;
        final String message;

        private CalendarResult(boolean ok, String message) {
            this.ok = ok;
            this.message = message;
        }

        static CalendarResult success(String message) {
            return new CalendarResult(true, message);
        }

        static CalendarResult failure(String message) {
            return new CalendarResult(false, message);
        }
    }

    // ── 权限 ───────────────────────────────────────────────────────────

    /**
     * READ_CALENDAR 与 WRITE_CALENDAR 是否都已授权；API &lt; 23 无需运行时权限，恒为 true。
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

    // ── 日历事件 ───────────────────────────────────────────────────────

    /**
     * 把展会写进设备日历。
     *
     * @param date 展会日期，ISO `YYYY-MM-DD`（后端 `exhibition.date` 原样传入）
     * @return 成功（含「本来就在日历里」）或失败原因
     */
    public static CalendarResult addToCalendar(Context context, String title, String venue,
            String date, String time, String description) {
        if (!hasCalendarPermissions(context)) {
            return CalendarResult.failure(context.getString(R.string.calendar_permission_denied));
        }
        if (!isValidDate(date)) {
            return CalendarResult.failure(context.getString(R.string.calendar_invalid_date));
        }

        String key = makeKey(title, date);
        if (isInCalendar(context, key)) {
            // 已经加过了：对用户来说是成功，不要重复插入。
            return CalendarResult.success(context.getString(R.string.calendar_already_added));
        }

        long calendarId = getDefaultCalendarId(context);
        if (calendarId == -1) {
            return CalendarResult.failure(context.getString(R.string.calendar_no_account));
        }

        long[] startEnd = parseTimeRange(date, time);

        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(CalendarContract.Events.DTSTART, startEnd[0]);
        values.put(CalendarContract.Events.DTEND, startEnd[1]);
        values.put(CalendarContract.Events.TITLE, title);
        values.put(CalendarContract.Events.DESCRIPTION, description);
        values.put(CalendarContract.Events.EVENT_LOCATION, venue);
        values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
        values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());

        try {
            Uri uri = resolver.insert(CalendarContract.Events.CONTENT_URI, values);
            if (uri != null) {
                saveEventId(context, key, Long.parseLong(uri.getLastPathSegment()));
                return CalendarResult.success(context.getString(R.string.calendar_added));
            }
        } catch (Exception error) {
            // 落到下面的统一失败分支：设备上没有可写日历时 insert 会抛异常。
        }
        return CalendarResult.failure(context.getString(R.string.calendar_add_failed));
    }

    /**
     * 从设备日历移除展会。
     *
     * @param date 展会日期，ISO `YYYY-MM-DD`
     */
    public static CalendarResult removeFromCalendar(Context context, String title, String date) {
        if (!hasCalendarPermissions(context)) {
            return CalendarResult.failure(context.getString(R.string.calendar_permission_denied));
        }
        if (!isValidDate(date)) {
            return CalendarResult.failure(context.getString(R.string.calendar_invalid_date));
        }

        String key = makeKey(title, date);
        long eventId = getEventId(context, key);
        if (eventId == -1) {
            return CalendarResult.failure(context.getString(R.string.calendar_not_in_calendar));
        }

        try {
            int deleted = context.getContentResolver().delete(
                    CalendarContract.Events.CONTENT_URI,
                    CalendarContract.Events._ID + " = ?",
                    new String[] { String.valueOf(eventId) });
            if (deleted > 0) {
                removeEventId(context, key);
                return CalendarResult.success(context.getString(R.string.calendar_removed));
            }
        } catch (Exception error) {
            // 落到下面的统一失败分支
        }

        // 事件可能已被用户在系统日历里删掉：清掉映射，并如实告诉用户没删成。
        removeEventId(context, key);
        return CalendarResult.failure(context.getString(R.string.calendar_remove_failed));
    }

    /** 展会是否已在设备日历中（映射存在且事件仍能查到）。 */
    public static boolean isInCalendar(Context context, String title, String date) {
        if (!isValidDate(date)) {
            return false;
        }
        return isInCalendar(context, makeKey(title, date));
    }

    private static boolean isInCalendar(Context context, String key) {
        long eventId = getEventId(context, key);
        if (eventId == -1 || !hasCalendarPermissions(context)) {
            return false;
        }
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CalendarContract.Events.CONTENT_URI,
                    new String[] { CalendarContract.Events._ID },
                    CalendarContract.Events._ID + " = ?",
                    new String[] { String.valueOf(eventId) },
                    null);
            return cursor != null && cursor.moveToFirst();
        } catch (Exception error) {
            return false;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    // ── 日历账号 ───────────────────────────────────────────────────────

    /** 找一个可写的日历账号；设备上没有日历时返回 -1。 */
    private static long getDefaultCalendarId(Context context) {
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CalendarContract.Calendars.CONTENT_URI,
                    new String[] { CalendarContract.Calendars._ID },
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?",
                    new String[] { String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) },
                    null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        } catch (Exception error) {
            // 没有日历 Provider 的设备：按「没有账号」处理
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1;
    }

    // ── 日期与时间解析（纯函数，可单测）─────────────────────────────────

    /**
     * ISO 日期是否合法，例如 `2026-09-25`。用非宽松的 {@link Calendar} 校验真实存在性，
     * 因此 `2026-02-30` 也判为非法。
     */
    static boolean isValidDate(String date) {
        int[] ymd = splitDate(date);
        if (ymd == null) {
            return false;
        }
        Calendar calendar = Calendar.getInstance();
        calendar.setLenient(false);
        try {
            calendar.set(ymd[0], ymd[1] - 1, ymd[2], 0, 0, 0);
            calendar.set(Calendar.MILLISECOND, 0);
            calendar.getTimeInMillis();
            return true;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    /**
     * 展会日期 + 时间区间 → 起止时间戳。
     *
     * @param date ISO `YYYY-MM-DD`，必须是合法日期
     * @param time `HH:mm-HH:mm`；缺失或解析失败时退回 9:00-17:00，
     *             结束不晚于开始时按 {@link #EVENT_DURATION_HOURS} 小时补足
     */
    static long[] parseTimeRange(String date, String time) {
        int[] ymd = splitDate(date);
        if (ymd == null) {
            throw new IllegalArgumentException("展会日期必须是 YYYY-MM-DD：" + date);
        }

        int startHour = 9;
        int startMinute = 0;
        int endHour = 17;
        int endMinute = 0;
        if (time != null && time.contains("-")) {
            try {
                String[] parts = time.split("-");
                String[] startParts = parts[0].trim().split(":");
                String[] endParts = parts[1].trim().split(":");
                startHour = Integer.parseInt(startParts[0].trim());
                startMinute = Integer.parseInt(startParts[1].trim());
                endHour = Integer.parseInt(endParts[0].trim());
                endMinute = Integer.parseInt(endParts[1].trim());
            } catch (Exception error) {
                // 保持默认的 9:00-17:00
            }
        }

        Calendar start = Calendar.getInstance();
        start.set(ymd[0], ymd[1] - 1, ymd[2], startHour, startMinute, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar end = Calendar.getInstance();
        end.set(ymd[0], ymd[1] - 1, ymd[2], endHour, endMinute, 0);
        end.set(Calendar.MILLISECOND, 0);

        if (end.getTimeInMillis() <= start.getTimeInMillis()) {
            end.setTimeInMillis(start.getTimeInMillis());
            end.add(Calendar.HOUR_OF_DAY, EVENT_DURATION_HOURS);
        }
        return new long[] { start.getTimeInMillis(), end.getTimeInMillis() };
    }

    /** `YYYY-MM-DD` → `{年, 月, 日}`；格式不对返回 null（不做「缺省当 1 号」的猜测）。 */
    private static int[] splitDate(String date) {
        if (date == null) {
            return null;
        }
        String[] parts = date.trim().split("-");
        if (parts.length != 3 || parts[0].length() != 4
                || parts[1].length() != 2 || parts[2].length() != 2) {
            return null;
        }
        try {
            return new int[] {
                    Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2]) };
        } catch (NumberFormatException error) {
            return null;
        }
    }

    // ── 映射（标题 + 日期 → 事件 id）───────────────────────────────────

    private static String makeKey(String title, String date) {
        return title + "_" + date;
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
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
