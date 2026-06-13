package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Centralized notification management for the exhibition app.
 *
 * Handles:
 * - Notification channel creation (Android O+)
 * - Exhibition reminder notifications (1 day before)
 * - Registration status change notifications
 * - Notification permission requests (API 33+)
 * - User-configurable notification settings (SharedPreferences)
 * - In-memory notification history
 */
public class NotificationHelper {

    // ── Channel IDs ──────────────────────────────────────────────────
    private static final String CHANNEL_EXHIBITION_REMINDER = "exhibition_reminder";
    private static final String CHANNEL_REGISTRATION_UPDATE = "registration_update";

    // ── Channel names ────────────────────────────────────────────────
    private static final String CHANNEL_NAME_EXHIBITION = "展会提醒";
    private static final String CHANNEL_NAME_REGISTRATION = "报名动态";

    // ── Notification IDs ─────────────────────────────────────────────
    private static final int NOTIFICATION_ID_EXHIBITION_BASE = 1000;
    private static final int NOTIFICATION_ID_REGISTRATION_BASE = 2000;
    private static int nextExhibitionNotifId = NOTIFICATION_ID_EXHIBITION_BASE;
    private static int nextRegistrationNotifId = NOTIFICATION_ID_REGISTRATION_BASE;

    // ── Permission request code ──────────────────────────────────────
    public static final int REQUEST_CODE_NOTIFICATION_PERMISSION = 3001;

    // ── SharedPreferences keys ───────────────────────────────────────
    private static final String PREFS_NAME = "notification_settings";
    private static final String KEY_EXHIBITION_REMINDERS = "exhibition_reminders_enabled";
    private static final String KEY_REGISTRATION_UPDATES = "registration_updates_enabled";

    // ── Singleton ────────────────────────────────────────────────────
    private static NotificationHelper instance;
    private Context appContext;

    // ── In-memory notification history ───────────────────────────────
    private static final List<NotificationRecord> history = new ArrayList<>();

    private NotificationHelper(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static synchronized NotificationHelper getInstance(Context context) {
        if (instance == null) {
            instance = new NotificationHelper(context);
        }
        return instance;
    }

    // ── Channel setup (call from Application.onCreate) ───────────────

    /**
     * Create notification channels. Safe to call multiple times;
     * channels are only created once on Android O+.
     */
    public void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = appContext.getSystemService(NotificationManager.class);

            // Exhibition reminder channel
            NotificationChannel exhibitionChannel = new NotificationChannel(
                    CHANNEL_EXHIBITION_REMINDER,
                    CHANNEL_NAME_EXHIBITION,
                    NotificationManager.IMPORTANCE_HIGH);
            exhibitionChannel.setDescription("展会开展前一天的提醒通知");
            exhibitionChannel.enableLights(true);
            exhibitionChannel.setLightColor(Color.GREEN);
            exhibitionChannel.enableVibration(true);
            nm.createNotificationChannel(exhibitionChannel);

            // Registration update channel
            NotificationChannel registrationChannel = new NotificationChannel(
                    CHANNEL_REGISTRATION_UPDATE,
                    CHANNEL_NAME_REGISTRATION,
                    NotificationManager.IMPORTANCE_DEFAULT);
            registrationChannel.setDescription("报名审核状态变更通知");
            registrationChannel.enableLights(true);
            registrationChannel.setLightColor(Color.BLUE);
            registrationChannel.enableVibration(true);
            nm.createNotificationChannel(registrationChannel);
        }
    }

    // ── Permission handling (API 33+) ────────────────────────────────

    /**
     * Check if POST_NOTIFICATIONS permission is granted.
     * On API < 33, always returns true (permission not required).
     */
    @SuppressWarnings("deprecation")
    public boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return appContext.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    /**
     * Request POST_NOTIFICATIONS permission from an Activity.
     * Does nothing on API < 33.
     */
    @SuppressWarnings("deprecation")
    public void requestNotificationPermission(Activity activity) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (!hasNotificationPermission()) {
                activity.requestPermissions(
                        new String[]{"android.permission.POST_NOTIFICATIONS"},
                        REQUEST_CODE_NOTIFICATION_PERMISSION);
            }
        }
    }

    // ── Exhibition reminder notification ──────────────────────────────

    /**
     * Send a notification reminding the user about an upcoming exhibition.
     * Intended to be called 1 day before the exhibition starts.
     *
     * @param exhibitionTitle exhibition name
     * @param venue           venue location
     * @param day             exhibition day (1-30, for June)
     * @param time            opening hours
     */
    public void sendExhibitionReminder(String exhibitionTitle, String venue, int day, String time) {
        if (!isExhibitionReminderEnabled()) {
            return;
        }

        String title = "展会提醒";
        String body = "明天（6月" + day + "日）"
                + exhibitionTitle + "即将开展！\n"
                + "时间：" + time + "\n"
                + "地点：" + venue;

        // Intent to open MainActivity when notification is tapped
        Intent intent = new Intent(appContext, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                appContext, nextExhibitionNotifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        showNotification(
                CHANNEL_EXHIBITION_REMINDER,
                nextExhibitionNotifId,
                title,
                body,
                pendingIntent);

        addToHistory("展会提醒", exhibitionTitle, body);
        nextExhibitionNotifId++;
    }

    // ── Registration status change notification ──────────────────────

    /**
     * Send a notification about a registration status change.
     *
     * @param exhibitionTitle exhibition name
     * @param visitorName     visitor who registered
     * @param newStatus       new status ("已通过", "已拒绝", etc.)
     */
    public void sendRegistrationStatusNotification(String exhibitionTitle, String visitorName, String newStatus) {
        if (!isRegistrationUpdatesEnabled()) {
            return;
        }

        String title = "报名动态";
        String body = visitorName + " 的报名状态已更新\n"
                + "展会：" + exhibitionTitle + "\n"
                + "新状态：" + newStatus;

        Intent intent = new Intent(appContext, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                appContext, nextRegistrationNotifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        showNotification(
                CHANNEL_REGISTRATION_UPDATE,
                nextRegistrationNotifId,
                title,
                body,
                pendingIntent);

        addToHistory("报名动态", exhibitionTitle, body);
        nextRegistrationNotifId++;
    }

    /**
     * Send a notification confirming a new registration submission.
     *
     * @param exhibitionTitle exhibition name
     * @param visitorName     visitor who submitted
     */
    public void sendRegistrationConfirmation(String exhibitionTitle, String visitorName) {
        if (!isRegistrationUpdatesEnabled()) {
            return;
        }

        String title = "报名成功";
        String body = "您已成功报名「" + exhibitionTitle + "」\n"
                + "报名人：" + visitorName;

        Intent intent = new Intent(appContext, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                appContext, nextRegistrationNotifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        showNotification(
                CHANNEL_REGISTRATION_UPDATE,
                nextRegistrationNotifId,
                title,
                body,
                pendingIntent);

        addToHistory("报名确认", exhibitionTitle, body);
        nextRegistrationNotifId++;
    }

    // ── Core notification display ────────────────────────────────────

    private void showNotification(String channelId, int notificationId,
                                  String title, String body, PendingIntent pendingIntent) {
        if (!hasNotificationPermission()) {
            return;
        }

        NotificationManager nm = appContext.getSystemService(NotificationManager.class);

        // Build notification compatible with API 23+
        android.app.Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new android.app.Notification.Builder(appContext, channelId);
        } else {
            builder = new android.app.Notification.Builder(appContext);
        }

        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setDefaults(android.app.Notification.DEFAULT_ALL);

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }

        nm.notify(notificationId, builder.build());
    }

    // ── Notification settings ────────────────────────────────────────

    private SharedPreferences getPrefs() {
        return appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public boolean isExhibitionReminderEnabled() {
        return getPrefs().getBoolean(KEY_EXHIBITION_REMINDERS, true);
    }

    public void setExhibitionReminderEnabled(boolean enabled) {
        getPrefs().edit().putBoolean(KEY_EXHIBITION_REMINDERS, enabled).apply();
    }

    public boolean isRegistrationUpdatesEnabled() {
        return getPrefs().getBoolean(KEY_REGISTRATION_UPDATES, true);
    }

    public void setRegistrationUpdatesEnabled(boolean enabled) {
        getPrefs().edit().putBoolean(KEY_REGISTRATION_UPDATES, enabled).apply();
    }

    // ── Notification history (in-memory) ─────────────────────────────

    public static class NotificationRecord {
        public final String type;
        public final String relatedTitle;
        public final String message;
        public final long timestamp;

        NotificationRecord(String type, String relatedTitle, String message) {
            this.type = type;
            this.relatedTitle = relatedTitle;
            this.message = message;
            this.timestamp = System.currentTimeMillis();
        }
    }

    private static void addToHistory(String type, String relatedTitle, String message) {
        history.add(0, new NotificationRecord(type, relatedTitle, message));
        // Cap at 50 records
        while (history.size() > 50) {
            history.remove(history.size() - 1);
        }
    }

    public List<NotificationRecord> getHistory() {
        return new ArrayList<>(history);
    }

    public void clearHistory() {
        history.clear();
    }

    // ── Cancel all notifications ─────────────────────────────────────

    public void cancelAll() {
        NotificationManager nm = appContext.getSystemService(NotificationManager.class);
        nm.cancelAll();
    }
}
