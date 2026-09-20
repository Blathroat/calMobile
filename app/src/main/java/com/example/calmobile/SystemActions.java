package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.os.Build;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 系统能力：系统日历、通知权限、摄像头权限，以及设备侧外观镜像。
 *
 * 数据类动作（展会、报名、用户、设置…）已经全部由后端提供，这里只剩**只有设备能做**的事：
 * 写系统日历、申请运行时权限、把后端下发的配色与媒体上限镜像到 {@link AppSettings}
 * （状态栏颜色与图片压缩只能在设备上生效）。
 */
final class SystemActions {

    private SystemActions() {
    }

    /**
     * `ui.sync`：把后端下发的配色、外观模式与媒体上限同步到设备侧。
     *
     * 前端在 bootstrap、设置保存、外观切换三处调用（见 `js/core/bridge.js` 的 `syncDevice`）。
     * 同步后立刻刷新系统栏颜色，避免出现「网页已经变深色、状态栏还是浅色」。
     */
    static Map<String, Object> syncDeviceMirror(Activity activity, Map<String, Object> payload) {
        String mode = AppSettings.normalizeMode(WebAppBridge.text(payload, "mode", AppSettings.MODE_AUTO));
        AppSettings.setUiMode(activity, mode);
        // 只有真正下发了配色下标才覆盖：缺字段时写 0 会把设备侧镜像悄悄重置成默认色，
        // 而页面用的还是后端下发的配色，两边会不一致（media / upload 也是同样的写法）。
        if (payload != null && payload.containsKey("themeIndex")) {
            AppSettings.setThemeIndex(activity, WebAppBridge.number(payload, "themeIndex", 0));
        }

        Map<String, Object> media = WebAppBridge.map(payload, "media");
        if (!media.isEmpty()) {
            AppSettings.saveMediaLimits(activity,
                    WebAppBridge.number(media, "imageCount", AppSettings.getMediaImageLimit(activity)),
                    WebAppBridge.number(media, "imageSizeMb", AppSettings.getMediaImageSizeMb(activity)),
                    WebAppBridge.number(media, "videoCount", AppSettings.getMediaVideoLimit(activity)));
        }
        Map<String, Object> upload = WebAppBridge.map(payload, "upload");
        if (!upload.isEmpty()) {
            AppSettings.saveUploadLimits(activity,
                    WebAppBridge.number(upload, "avatarSizeMb", AppSettings.getMediaAvatarSizeMb(activity)),
                    WebAppBridge.text(upload, "imageFormats", ""),
                    WebAppBridge.text(upload, "videoFormats", ""));
        }
        AppSettings.applyWindowColors(activity);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", mode);
        result.put("themeIndex", AppSettings.getThemeIndex(activity));
        // 系统通知权限只有设备知道：前端据此决定是否显示「开启通知」按钮。
        result.put("notificationsGranted",
                NotificationHelper.getInstance(activity).hasNotificationPermission());
        return result;
    }

    static Map<String, Object> calendarStatus(Activity activity, Map<String, Object> payload) {
        String title = WebAppBridge.text(payload, "title", "");
        // 日期用后端下发的 ISO 日期原样传入；没有日期就当作「未加入」，不要猜月份。
        String date = WebAppBridge.text(payload, "date", "");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        data.put("inCalendar", !title.isEmpty()
                && CalendarHelper.isInCalendar(activity, title, date));
        return data;
    }

    static void toggleCalendar(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        String date = WebAppBridge.text(payload, "date", "");
        if (!CalendarHelper.isValidDate(date)) {
            // 没有合法日期就不写：旧实现缺日期时按 1 号处理，会把事件写到错误的月份。
            callback.failure(activity.getString(R.string.calendar_invalid_date));
            return;
        }

        String title = WebAppBridge.text(payload, "title", "");
        boolean inCalendar = CalendarHelper.isInCalendar(activity, title, date);

        if (CalendarHelper.hasCalendarPermissions(activity)) {
            finishCalendarChange(callback, activity, payload, inCalendar);
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

    /**
     * 真正写/删日历，并把结果如实回报。
     *
     * **失败必须走 `failure`**：旧实现丢弃了 `CalendarHelper` 的返回值、无条件回
     * 「已加入系统日历」，于是没有日历账号时按钮会翻成「移出日历」但什么都没写进去。
     */
    static void finishCalendarChange(WebAppBridge.ResultCallback callback, Activity activity,
            Map<String, Object> payload, boolean inCalendar) {
        CalendarHelper.CalendarResult result = applyCalendarChange(activity, payload, inCalendar);
        if (!result.ok) {
            callback.failure(result.message);
            return;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("inCalendar", !inCalendar);
        data.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        data.put("message", result.message);
        callback.success(data);
    }

    static CalendarHelper.CalendarResult applyCalendarChange(Activity activity,
            Map<String, Object> payload, boolean inCalendar) {
        String title = WebAppBridge.text(payload, "title", "");
        String date = WebAppBridge.text(payload, "date", "");
        if (inCalendar) {
            return CalendarHelper.removeFromCalendar(activity, title, date);
        }
        return CalendarHelper.addToCalendar(activity, title, WebAppBridge.text(payload, "venue", ""),
                date, WebAppBridge.text(payload, "time", ""),
                WebAppBridge.text(payload, "description", ""));
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
            finishCalendarChange(pending.callback, activity, pending.context,
                    Boolean.TRUE.equals(pending.context.get("inCalendar")));
            return;
        }
        pending.callback.success(granted);
    }
}
