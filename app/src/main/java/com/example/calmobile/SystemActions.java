package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 服务器设置与外观模式、系统日历、通知权限。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class SystemActions {

    private SystemActions() {
    }

    static Map<String, Object> settings(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("theme", SessionActions.themePayload(activity));
        data.put("ui", SessionActions.uiPayload(activity));
        data.put("announcement", SessionActions.announcement(activity));
        data.put("brand", SessionActions.brand(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", SessionActions.reviewPolicy(activity));
        data.put("media", SessionActions.mediaLimits(activity));
        data.put("upload", SessionActions.serverSettings(activity));
        data.put("limits", SessionActions.textLimits(activity));
        data.put("notify", ProfileActions.notificationPreferences(activity));
        return data;
    }

    static Map<String, Object> saveSettings(Activity activity, Map<String, Object> payload) {
        Map<String, Object> result = new LinkedHashMap<>();
        // 服务器设置与应用配色都只允许管理员修改，避免绕过页面直接调用桥接。
        if (!AuthManager.getInstance().isAdmin()) {
            result.put("ok", false);
            result.put("error", "只有管理员可以修改服务器设置");
            result.put("settings", settings(activity));
            return result;
        }
        if (payload.containsKey("themeIndex")) {
            AppSettings.setThemeIndex(activity, WebAppBridge.number(payload, "themeIndex", 0));
        }
        if (payload.containsKey("announcement") || payload.containsKey("announcementEnabled")) {
            AppSettings.saveAnnouncement(activity, WebAppBridge.text(payload, "announcement", ""),
                    WebAppBridge.flag(payload, "announcementEnabled", false));
        }
        if (payload.containsKey("appTitleZh") || payload.containsKey("appTitleEn")) {
            AppSettings.saveAppTitle(activity, WebAppBridge.text(payload, "appTitleZh", ""),
                    WebAppBridge.text(payload, "appTitleEn", ""));
        }

        List<Object> rawCategories = WebAppBridge.list(payload, "categories");
        if (!rawCategories.isEmpty()) {
            List<String> categories = new ArrayList<>();
            for (Object raw : rawCategories) {
                String value = String.valueOf(raw).trim();
                if (!value.isEmpty()) {
                    categories.add(value);
                }
            }
            if (!categories.isEmpty()) {
                AppSettings.saveCategories(activity, categories);
            }
        }
        if (payload.containsKey("canRevise")) {
            AppSettings.setCanReviseReviewedRegistration(activity,
                    WebAppBridge.flag(payload, "canRevise", false));
        }
        // 只写入本次真正提交的字段：个人页保存配色时不会顺带把服务器设置改回默认值。
        if (payload.containsKey("imageCount") || payload.containsKey("imageSizeMb")
                || payload.containsKey("videoCount")) {
            AppSettings.saveMediaLimits(activity,
                    WebAppBridge.number(payload, "imageCount", AppSettings.getMediaImageLimit(activity)),
                    WebAppBridge.number(payload, "imageSizeMb", AppSettings.getMediaImageSizeMb(activity)),
                    WebAppBridge.number(payload, "videoCount", AppSettings.getMediaVideoLimit(activity)));
        }
        if (payload.containsKey("avatarSizeMb") || payload.containsKey("imageFormats")
                || payload.containsKey("videoFormats")) {
            AppSettings.saveUploadLimits(activity,
                    WebAppBridge.number(payload, "avatarSizeMb", AppSettings.getMediaAvatarSizeMb(activity)),
                    WebAppBridge.text(payload, "imageFormats", ""),
                    WebAppBridge.text(payload, "videoFormats", ""));
        }
        if (payload.containsKey(AppSettings.TextLimit.EXHIBITION_TITLE.wireName)) {
            // 上限清单只有一份（AppSettings.TextLimit），这里按键名逐个取值，不再按下标对齐。
            Map<String, Integer> limits = new LinkedHashMap<>();
            for (AppSettings.TextLimit limit : AppSettings.TextLimit.values()) {
                limits.put(limit.wireName, WebAppBridge.number(payload, limit.wireName, 0));
            }
            AppSettings.saveTextLimits(activity, limits);
        }
        if (payload.containsKey("notify")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> notify = payload.get("notify") instanceof Map
                    ? (Map<String, Object>) payload.get("notify")
                    : new LinkedHashMap<String, Object>();
            ProfileActions.saveNotificationPreferences(activity, notify);
        }
        AppSettings.applyWindowColors(activity);

        result.put("ok", true);
        result.put("error", "");
        result.put("settings", settings(activity));
        return result;
    }

    static Map<String, Object> saveUiMode(Activity activity, Map<String, Object> payload) {
        String mode = AppSettings.normalizeMode(WebAppBridge.text(payload, "mode", AppSettings.MODE_AUTO));
        AppSettings.setUiMode(activity, mode);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("error", "");
        result.put("mode", mode);
        return result;
    }

    static Map<String, Object> calendarStatus(Activity activity, Map<String, Object> payload) {
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        data.put("inCalendar", !title.isEmpty() && CalendarHelper.isInCalendar(activity, title, day));
        return data;
    }

    static void toggleCalendar(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        boolean inCalendar = CalendarHelper.isInCalendar(activity, title, day);

        if (CalendarHelper.hasCalendarPermissions(activity)) {
            callback.success(applyCalendarChange(activity, payload, inCalendar));
            return;
        }
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("calendar.toggle", callback);
        pending.context.putAll(payload);
        pending.context.put("inCalendar", inCalendar);
        bridge.registerPermission(requestCode, pending);
        activity.requestPermissions(
                new String[] { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR },
                requestCode);
    }

    static Map<String, Object> applyCalendarChange(Activity activity, Map<String, Object> payload,
            boolean inCalendar) {
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        if (inCalendar) {
            CalendarHelper.removeFromCalendar(activity, title, day);
        } else {
            CalendarHelper.addToCalendar(activity, title, WebAppBridge.text(payload, "venue", ""), day,
                    WebAppBridge.text(payload, "time", ""), WebAppBridge.text(payload, "description", ""));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("inCalendar", !inCalendar);
        result.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        result.put("message", inCalendar ? "已从系统日历移除" : "已加入系统日历");
        return result;
    }

    static void requestNotificationPermission(WebAppBridge bridge,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        if (NotificationHelper.getInstance(activity).hasNotificationPermission()
                || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            callback.success(true);
            return;
        }
        int requestCode = bridge.nextRequestCode();
        bridge.registerPermission(requestCode, new WebAppBridge.PendingResult("notify.requestPermission", callback));
        activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, requestCode);
    }

    static void ensureCameraPermission(WebAppBridge bridge,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        if (activity.checkSelfPermission(Manifest.permission.CAMERA)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            callback.success(true);
            return;
        }
        int requestCode = bridge.nextRequestCode();
        bridge.registerPermission(requestCode,
                new WebAppBridge.PendingResult("camera.ensurePermission", callback));
        activity.requestPermissions(new String[] { Manifest.permission.CAMERA }, requestCode);
    }

    static void onPermissionResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            boolean granted) {
        Activity activity = bridge.activity();
        if ("calendar.toggle".equals(pending.action)) {
            if (!granted) {
                pending.callback.failure("未获得日历权限，无法写入系统日历");
                return;
            }
            pending.callback.success(applyCalendarChange(activity, pending.context,
                    Boolean.TRUE.equals(pending.context.get("inCalendar"))));
            return;
        }
        pending.callback.success(granted);
    }}
