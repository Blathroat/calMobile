package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

import java.util.Map;

/**
 * 桥接动作分发入口。
 *
 * **只保留系统能力**：数据（展会、报名、用户、设置、认证）全部由 `server/` 的
 * Hono + PostgreSQL 后端提供，前端通过 Vue 的类型化 API client 走 HTTP，
 * 原生不再持有任何业务数据的实现。
 *
 * 留在原生的是「只有设备能做」的事：
 *
 * | 动作 | 为什么必须在原生 |
 * | --- | --- |
 * | `ui.sync` | 状态栏配色、图片压缩上限只能在设备上生效 |
 * | `camera.ensurePermission` | 运行时权限 |
 * | `calendar.status` / `calendar.toggle` | 写系统日历（CalendarContract） |
 * | `notify.requestPermission` | 通知运行时权限 |
 * | `media.pickImage` / `media.import` / `media.store` / `media.discard` | 系统选择器、私有目录落盘与删掉临时文件 |
 * | `share.text` | 系统分享面板 |
 * | `export.csv` | 系统「另存为」面板 |
 * | `session.save` / `session.load` / `session.clear` / `session.device` | 会话与可信设备凭据属于设备状态，存应用私有目录（{@link SessionStore}） |
 *
 * 数据行由前端传进来（它已经从后端拿到数据），原生只负责落盘与格式。
 */
final class WebAppActions {

    private WebAppActions() {
    }

    static void handle(WebAppBridge bridge, String action, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();

        switch (action) {
            case "ui.sync":
                callback.success(SystemActions.syncDeviceMirror(activity, payload));
                return;
            case "camera.ensurePermission":
                SystemActions.ensureCameraPermission(bridge, callback);
                return;
            case "calendar.status":
                callback.success(SystemActions.calendarStatus(activity, payload));
                return;
            case "calendar.toggle":
                SystemActions.toggleCalendar(bridge, payload, callback);
                return;
            case "notify.requestPermission":
                SystemActions.requestNotificationPermission(bridge, callback);
                return;
            case "media.pickImage":
                MediaActions.pickImage(bridge, callback);
                return;
            case "media.import":
                MediaActions.importMedia(bridge, payload, callback);
                return;
            case "media.store":
                callback.success(MediaActions.storeDataUrl(activity, payload));
                return;
            case "media.discard":
                callback.success(MediaActions.discard(activity, payload));
                return;
            case "share.text":
                MediaActions.shareText(activity, payload, callback);
                return;
            case "export.csv":
                MediaActions.exportCsv(bridge, payload, callback);
                return;
            case "session.save":
                callback.success(SessionActions.save(activity, payload));
                return;
            case "session.load":
                callback.success(SessionActions.load(activity));
                return;
            case "session.clear":
                callback.success(SessionActions.clear(activity));
                return;
            case "session.device":
                callback.success(SessionActions.device(activity));
                return;
            default:
                callback.failure("未实现的动作：" + action);
        }
    }

    // ── 供 WebAppBridge 与测试直接调用 ─────────────────────────────

    /** 系统界面（文件选择、导出 CSV）返回结果。 */
    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        MediaActions.onActivityResult(bridge, pending, resultCode, data);
    }

    /** 权限申请结果：日历与摄像头在这里分流。 */
    static void onPermissionResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            boolean granted) {
        SystemActions.onPermissionResult(bridge, pending, granted);
    }

    /** 把简介里的内联 base64 图片改写成落盘后的短 URL。 */
    static String inlineDataUrlsToFiles(Context context, String description) {
        return MediaActions.inlineDataUrlsToFiles(context, description);
    }
}
