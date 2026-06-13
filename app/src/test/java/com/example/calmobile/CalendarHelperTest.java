package com.example.calmobile;

import org.junit.Test;

import java.util.Calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for {@link CalendarHelper}.
 * Tests the time-parsing logic (package-private {@code parseTimeRange} method).
 * <p>
 * Note: Calendar event operations ({@code addToCalendar}, {@code removeFromCalendar},
 * {@code isInCalendar}) require Android Context, ContentResolver, and runtime permissions,
 * so they cannot be tested with plain JUnit. Only the pure-Java time parsing is tested here.
 */
public class CalendarHelperTest {

    private static final int EXHIBITION_YEAR = 2026;
    private static final int EXHIBITION_MONTH = Calendar.JUNE; // 5 (0-indexed)

    // ── parseTimeRange: normal cases ─────────────────────────────

    @Test
    public void parseTimeRangeNormalInput() {
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-17:30");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(EXHIBITION_YEAR, start.get(Calendar.YEAR));
        assertEquals(EXHIBITION_MONTH, start.get(Calendar.MONTH));
        assertEquals(15, start.get(Calendar.DAY_OF_MONTH));
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(EXHIBITION_YEAR, end.get(Calendar.YEAR));
        assertEquals(EXHIBITION_MONTH, end.get(Calendar.MONTH));
        assertEquals(15, end.get(Calendar.DAY_OF_MONTH));
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, end.get(Calendar.MINUTE));
    }

    @Test
    public void parseTimeRangeEndAfterStart() {
        long[] result = CalendarHelper.parseTimeRange(10, "10:00-18:00");
        assertTrue("End should be after start", result[1] > result[0]);
    }

    @Test
    public void parseTimeRangeDurationInHours() {
        long[] result = CalendarHelper.parseTimeRange(10, "09:00-17:00");
        long durationMillis = result[1] - result[0];
        long durationHours = durationMillis / (1000 * 60 * 60);
        assertEquals(8, durationHours);
    }

    @Test
    public void parseTimeRangeWithDifferentDays() {
        long[] day1 = CalendarHelper.parseTimeRange(1, "09:00-17:00");
        long[] day30 = CalendarHelper.parseTimeRange(30, "09:00-17:00");

        // Different days should produce different timestamps
        assertTrue("Day 30 should be after day 1", day30[0] > day1[0]);
    }

    @Test
    public void parseTimeRangeWithMidnightCrossing() {
        // When end time is before start time (e.g. 22:00-02:00), 
        // the method adds default 2-hour duration
        long[] result = CalendarHelper.parseTimeRange(15, "22:00-02:00");
        assertTrue("End should be after start", result[1] > result[0]);

        long durationMillis = result[1] - result[0];
        long durationHours = durationMillis / (1000 * 60 * 60);
        assertEquals(2, durationHours);
    }

    @Test
    public void parseTimeRangeWithSameStartAndEnd() {
        // When start equals end, adds 2-hour default
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-09:00");
        assertTrue("End should be after start", result[1] > result[0]);

        long durationMillis = result[1] - result[0];
        long durationHours = durationMillis / (1000 * 60 * 60);
        assertEquals(2, durationHours);
    }

    // ── parseTimeRange: null and invalid inputs ──────────────────

    @Test
    public void parseTimeRangeNullTimeUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(15, null);

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, end.get(Calendar.MINUTE));
    }

    @Test
    public void parseTimeRangeEmptyTimeUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(15, "");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
    }

    @Test
    public void parseTimeRangeNoHyphenUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(15, "09001700");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
    }

    @Test
    public void parseTimeRangeMalformedTimeUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(15, "abc-def");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
    }

    @Test
    public void parseTimeRangePartialMalformedTimeUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-xyz");

        // Falls back to defaults entirely
        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
    }

    // ── parseTimeRange: edge cases ────────────────────────────────

    @Test
    public void parseTimeRangeFirstDayOfMonth() {
        long[] result = CalendarHelper.parseTimeRange(1, "10:00-12:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(1, start.get(Calendar.DAY_OF_MONTH));
    }

    @Test
    public void parseTimeRangeLastDayOfMonth() {
        long[] result = CalendarHelper.parseTimeRange(30, "10:00-12:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(30, start.get(Calendar.DAY_OF_MONTH));
    }

    @Test
    public void parseTimeRangeMillisecondsAreZero() {
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-17:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(0, start.get(Calendar.MILLISECOND));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(0, end.get(Calendar.MILLISECOND));
    }

    @Test
    public void parseTimeRangeSecondsAreZero() {
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-17:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(0, start.get(Calendar.SECOND));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(0, end.get(Calendar.SECOND));
    }

    @Test
    public void parseTimeRangeReturnsArrayLengthTwo() {
        long[] result = CalendarHelper.parseTimeRange(15, "09:00-17:00");
        assertEquals(2, result.length);
    }

    @Test
    public void parseTimeRangeWithExtraSpaces() {
        long[] result = CalendarHelper.parseTimeRange(15, " 09:00 - 17:30 ");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, end.get(Calendar.MINUTE));
    }

    @Test
    public void parseTimeRangeSingleDigitHours() {
        long[] result = CalendarHelper.parseTimeRange(15, "9:00-17:30");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, end.get(Calendar.MINUTE));
    }

    // ── REQUEST_CODE_CALENDAR_PERMISSION constant ────────────────

    @Test
    public void requestCodeCalendarPermissionIsPositive() {
        assertTrue(CalendarHelper.REQUEST_CODE_CALENDAR_PERMISSION > 0);
    }
}
