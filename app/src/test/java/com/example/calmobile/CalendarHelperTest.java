package com.example.calmobile;

import org.junit.Test;

import java.util.Calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * Unit tests for {@link CalendarHelper}。
 *
 * 覆盖的是纯 Java 部分：ISO 日期校验与「日期 + 时间 → 时间戳」的解析。
 * 写/删日历（{@code addToCalendar} / {@code removeFromCalendar} / {@code isInCalendar}）
 * 需要 Android Context、ContentResolver、CalendarProvider 与运行时权限，普通 JUnit 测不了。
 *
 * 这里**不复制实现里的常量**当期望值：日期全部由用例显式给出，
 * 因此「写死年月」这类缺陷不可能再被测试掩盖（旧用例正是把写死的 2026-06 抄成了期望值）。
 */
public class CalendarHelperTest {

    private static final String SEPTEMBER = "2026-09-25";
    private static final String OCTOBER = "2026-10-02";

    // ── isValidDate ──────────────────────────────────────────────

    @Test
    public void validDateAccepted() {
        assertTrue(CalendarHelper.isValidDate("2026-09-25"));
        assertTrue(CalendarHelper.isValidDate("2026-01-01"));
        assertTrue(CalendarHelper.isValidDate("2026-12-31"));
        assertTrue(CalendarHelper.isValidDate("2024-02-29")); // 闰年
    }

    @Test
    public void invalidDateRejected() {
        assertFalse(CalendarHelper.isValidDate(null));
        assertFalse(CalendarHelper.isValidDate(""));
        assertFalse(CalendarHelper.isValidDate("2026-9-25"));   // 必须是两位月份
        assertFalse(CalendarHelper.isValidDate("26-09-25"));    // 必须是四位年份
        assertFalse(CalendarHelper.isValidDate("2026/09/25"));  // 只认短横线
        assertFalse(CalendarHelper.isValidDate("2026-13-01"));  // 没有 13 月
        assertFalse(CalendarHelper.isValidDate("2026-02-30"));  // 那天不存在
        assertFalse(CalendarHelper.isValidDate("2026-09-25T10:00"));
        assertFalse(CalendarHelper.isValidDate("abc"));
    }

    // ── parseTimeRange：日期来自入参，而不是写死的年月 ──────────────

    @Test
    public void parseTimeRangeUsesGivenDate() {
        long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, "09:00-17:30");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(2026, start.get(Calendar.YEAR));
        assertEquals(Calendar.SEPTEMBER, start.get(Calendar.MONTH));
        assertEquals(25, start.get(Calendar.DAY_OF_MONTH));
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(Calendar.SEPTEMBER, end.get(Calendar.MONTH));
        assertEquals(25, end.get(Calendar.DAY_OF_MONTH));
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, end.get(Calendar.MINUTE));
    }

    @Test
    public void differentMonthsProduceDifferentTimestamps() {
        long[] september = CalendarHelper.parseTimeRange(SEPTEMBER, "09:00-17:00");
        long[] october = CalendarHelper.parseTimeRange(OCTOBER, "09:00-17:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(october[0]);
        assertEquals(Calendar.OCTOBER, start.get(Calendar.MONTH));
        assertEquals(2, start.get(Calendar.DAY_OF_MONTH));
        assertTrue("10 月 2 日应当晚于 9 月 25 日", october[0] > september[0]);
    }

    @Test
    public void invalidDateThrowsInsteadOfGuessing() {
        try {
            CalendarHelper.parseTimeRange("", "09:00-17:00");
            fail("缺日期时应当抛异常，而不是回落到某个月的一号");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("YYYY-MM-DD"));
        }
    }

    // ── parseTimeRange：时间区间 ───────────────────────────────────

    @Test
    public void endAfterStart() {
        long[] result = CalendarHelper.parseTimeRange(OCTOBER, "10:00-18:00");
        assertTrue("End should be after start", result[1] > result[0]);
    }

    @Test
    public void durationInHours() {
        long[] result = CalendarHelper.parseTimeRange(OCTOBER, "09:00-17:00");
        assertEquals(8, (result[1] - result[0]) / (1000 * 60 * 60));
    }

    @Test
    public void midnightCrossingFallsBackToDefaultDuration() {
        long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, "22:00-02:00");
        assertTrue("End should be after start", result[1] > result[0]);
        assertEquals(2, (result[1] - result[0]) / (1000 * 60 * 60));
    }

    @Test
    public void sameStartAndEndFallsBackToDefaultDuration() {
        long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, "09:00-09:00");
        assertTrue("End should be after start", result[1] > result[0]);
        assertEquals(2, (result[1] - result[0]) / (1000 * 60 * 60));
    }

    @Test
    public void nullTimeUsesDefaults() {
        long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, null);

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
    public void malformedTimesUseDefaults() {
        for (String time : new String[]{"", "09001700", "abc-def", "09:00-xyz", "09:00"}) {
            long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, time);
            Calendar start = Calendar.getInstance();
            start.setTimeInMillis(result[0]);
            assertEquals("时间「" + time + "」应当退回 9:00", 9, start.get(Calendar.HOUR_OF_DAY));
            Calendar end = Calendar.getInstance();
            end.setTimeInMillis(result[1]);
            assertEquals("时间「" + time + "」应当退回 17:00", 17, end.get(Calendar.HOUR_OF_DAY));
        }
    }

    @Test
    public void extraSpacesAndSingleDigitHoursAccepted() {
        long[] spaced = CalendarHelper.parseTimeRange(SEPTEMBER, " 09:00 - 17:30 ");
        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(spaced[0]);
        assertEquals(9, start.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, start.get(Calendar.MINUTE));

        long[] singleDigit = CalendarHelper.parseTimeRange(SEPTEMBER, "9:00-17:30");
        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(singleDigit[1]);
        assertEquals(17, end.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, end.get(Calendar.MINUTE));
    }

    @Test
    public void secondsAndMillisecondsAreZero() {
        long[] result = CalendarHelper.parseTimeRange(SEPTEMBER, "09:00-17:00");

        Calendar start = Calendar.getInstance();
        start.setTimeInMillis(result[0]);
        assertEquals(0, start.get(Calendar.SECOND));
        assertEquals(0, start.get(Calendar.MILLISECOND));

        Calendar end = Calendar.getInstance();
        end.setTimeInMillis(result[1]);
        assertEquals(0, end.get(Calendar.SECOND));
        assertEquals(0, end.get(Calendar.MILLISECOND));
    }

    @Test
    public void returnsTwoTimestamps() {
        assertEquals(2, CalendarHelper.parseTimeRange(SEPTEMBER, "09:00-17:00").length);
    }
}
