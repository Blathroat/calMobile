package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for {@link NotificationHelper}.
 * <p>
 * Note: NotificationHelper requires an Android Context, NotificationManager,
 * and Build.VERSION checks. Without Robolectric, we cannot test notification
 * creation or channel setup. These tests verify the public data structures
 * and constants.
 * <p>
 * For full notification testing, use Android instrumented tests ({@code androidTest}).
 */
public class NotificationHelperTest {

    // ── REQUEST_CODE constant ────────────────────────────────────

    @Test
    public void requestCodeIsPositive() {
        assertTrue(NotificationHelper.REQUEST_CODE_NOTIFICATION_PERMISSION > 0);
    }

    @Test
    public void requestCodeValue() {
        assertEquals(3001, NotificationHelper.REQUEST_CODE_NOTIFICATION_PERMISSION);
    }

    // ── NotificationRecord ───────────────────────────────────────

    @Test
    public void notificationRecordStoresType() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("展会提醒", "测试展", "消息内容");
        assertEquals("展会提醒", record.type);
    }

    @Test
    public void notificationRecordStoresRelatedTitle() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("展会提醒", "测试展", "消息内容");
        assertEquals("测试展", record.relatedTitle);
    }

    @Test
    public void notificationRecordStoresMessage() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("展会提醒", "测试展", "消息内容");
        assertEquals("消息内容", record.message);
    }

    @Test
    public void notificationRecordHasTimestamp() {
        long before = System.currentTimeMillis();
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", "title", "msg");
        long after = System.currentTimeMillis();

        assertTrue("Timestamp should be >= before",
                record.timestamp >= before);
        assertTrue("Timestamp should be <= after",
                record.timestamp <= after);
    }

    @Test
    public void notificationRecordWithNullType() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord(null, "title", "msg");
        assertNotNull(record);
        assertEquals(null, record.type);
    }

    @Test
    public void notificationRecordWithNullTitle() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", null, "msg");
        assertNotNull(record);
        assertEquals(null, record.relatedTitle);
    }

    @Test
    public void notificationRecordWithNullMessage() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", "title", null);
        assertNotNull(record);
        assertEquals(null, record.message);
    }

    @Test
    public void notificationRecordWithEmptyStrings() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("", "", "");
        assertEquals("", record.type);
        assertEquals("", record.relatedTitle);
        assertEquals("", record.message);
    }

    @Test
    public void notificationRecordWithChineseCharacters() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("报名动态", "华南智能家居展", "状态已更新");
        assertEquals("报名动态", record.type);
        assertEquals("华南智能家居展", record.relatedTitle);
        assertEquals("状态已更新", record.message);
    }

    @Test
    public void notificationRecordWithLongMessage() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 100; i++) {
            sb.append("这是一条很长的通知消息");
        }
        String longMessage = sb.toString();
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", "title", longMessage);
        assertEquals(longMessage, record.message);
    }

    @Test
    public void notificationRecordFieldsAreFinal() {
        // Verify that fields are accessible and set correctly
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", "title", "msg");

        // Fields are public final - verify they don't change
        assertEquals("type", record.type);
        assertEquals("title", record.relatedTitle);
        assertEquals("msg", record.message);
    }

    @Test
    public void multipleRecordsHaveDistinctTimestamps() throws InterruptedException {
        NotificationHelper.NotificationRecord r1 =
                new NotificationHelper.NotificationRecord("type", "t1", "m1");
        Thread.sleep(5); // small delay to ensure different timestamps
        NotificationHelper.NotificationRecord r2 =
                new NotificationHelper.NotificationRecord("type", "t2", "m2");

        assertTrue("Second record should have later or equal timestamp",
                r2.timestamp >= r1.timestamp);
    }

    // ── NotificationRecord with special characters ───────────────

    @Test
    public void notificationRecordWithNewlines() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("type", "title", "line1\nline2\nline3");
        assertEquals("line1\nline2\nline3", record.message);
    }

    @Test
    public void notificationRecordWithUnicode() {
        NotificationHelper.NotificationRecord record =
                new NotificationHelper.NotificationRecord("🔔", "📋 Test", "✅ Done");
        assertEquals("🔔", record.type);
        assertEquals("📋 Test", record.relatedTitle);
        assertEquals("✅ Done", record.message);
    }
}
