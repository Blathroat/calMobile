package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

import java.util.Map;

/**
 * 桥接动作分发入口。
 * <p>
 * 这里只做「动作名 → 处理类」的路由，实现按域拆到：
 * {@link SessionActions}（启动数据）、{@link ProfileActions}（认证与资料）、
 * {@link ExhibitionActions}（展会）、{@link RegistrationActions}（报名与核销）、
 * {@link AdminActions}（用户与搜索）、{@link MediaActions}（媒体与导出）、
 * {@link SystemActions}（设置与系统能力），共享工具在 {@link ActionSupport}。
 * <p>
 * 前端只认动作名，因此拆分不影响 {@code js/core/api.js} 的接口形状；
 * 接后端时按域替换对应处理类即可，不必再读一个两千行的文件。
 */
final class WebAppActions {

    private WebAppActions() {
    }

    static void handle(WebAppBridge bridge, String action, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        DatabaseHelper.init(activity);
        ExhibitionManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        switch (action) {
            case "bootstrap":
                callback.success(SessionActions.bootstrap(activity));
                return;
            case "auth.login":
                callback.success(ProfileActions.login(activity, payload));
                return;
            case "auth.register":
                callback.success(ProfileActions.register(activity, payload));
                return;
            case "auth.guest":
                callback.success(ProfileActions.enterAsGuest(activity));
                return;
            case "auth.logout":
                callback.success(ProfileActions.logout());
                return;
            case "profile.get":
                callback.success(SessionActions.userPayload(activity));
                return;
            case "profile.save":
                callback.success(ProfileActions.saveProfile(activity, payload));
                return;
            case "profile.password":
                callback.success(ProfileActions.changePassword(activity, payload));
                return;
            case "notify.preferences":
                callback.success(ProfileActions.notificationPreferences(activity));
                return;
            case "notify.savePreferences":
                ProfileActions.saveNotificationPreferences(activity, payload);
                return;
            case "exhibitions.list":
                callback.success(ExhibitionActions.exhibitions(activity, payload));
                return;
            case "exhibitions.month":
                callback.success(ExhibitionActions.monthPayload(activity, payload));
                return;
            case "exhibitions.get":
                callback.success(ExhibitionActions.findExhibition(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.save":
                callback.success(ExhibitionActions.saveExhibition(activity, payload));
                return;
            case "exhibitions.delete":
                callback.success(ExhibitionActions.remove(payload));
                return;
            case "exhibitions.status":
                callback.success(ExhibitionActions.updateStatus(payload));
                return;
            case "exhibitions.categories":
                callback.success(ExhibitionActions.categories(activity));
                return;
            case "exhibitions.fields":
                callback.success(ExhibitionActions.fieldsPayload(WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.saveFields":
                callback.success(ExhibitionActions.saveFields(WebAppBridge.text(payload, "id", ""), payload));
                return;
            case "registrations.list":
                callback.success(RegistrationActions.myRegistrations(activity));
                return;
            case "registrations.get":
                callback.success(RegistrationActions.findRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "registrations.submit":
                callback.success(RegistrationActions.submitRegistration(activity, payload));
                return;
            case "registrations.cancel":
                callback.success(RegistrationActions.cancelRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "review.list":
                callback.success(RegistrationActions.reviewList(payload));
                return;
            case "review.get":
                callback.success(RegistrationActions.reviewDetail(WebAppBridge.text(payload, "id", "")));
                return;
            case "review.updateStatus":
                callback.success(RegistrationActions.updateReviewStatus(activity, payload));
                return;
            case "checkin.scan":
                callback.success(RegistrationActions.checkIn(activity, payload));
                return;
            case "camera.ensurePermission":
                SystemActions.ensureCameraPermission(bridge, callback);
                return;
            case "users.list":
                callback.success(AdminActions.users(payload));
                return;
            case "users.get":
                callback.success(AdminActions.findUser(WebAppBridge.text(payload, "id", "")));
                return;
            case "users.status":
                callback.success(AdminActions.updateStatus(payload));
                return;
            case "users.public":
                callback.success(AdminActions.publicProfile(activity, payload));
                return;
            case "search.query":
                callback.success(AdminActions.search(activity, WebAppBridge.text(payload, "query", "")));
                return;
            case "settings.get":
                callback.success(SystemActions.settings(activity));
                return;
            case "settings.save":
                callback.success(SystemActions.saveSettings(activity, payload));
                return;
            case "settings.uiMode":
                callback.success(SystemActions.saveUiMode(activity, payload));
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
            case "media.imageData":
                callback.success(MediaActions.imageData(activity, WebAppBridge.text(payload, "uri", "")));
                return;
            case "media.pickImage":
                MediaActions.pickImage(bridge, callback);
                return;
            case "media.pickVideo":
                MediaActions.pickVideo(bridge, callback);
                return;
            case "media.import":
                MediaActions.importMedia(bridge, payload, callback);
                return;
            case "media.store":
                callback.success(MediaActions.storeDataUrl(activity, payload));
                return;
            case "share.text":
                MediaActions.shareText(activity, payload);
                return;
            case "export.csv":
                MediaActions.exportCsv(bridge, payload, callback);
                return;
            case "toast":
                callback.success(MediaActions.toast(activity, payload));
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

    /** 报名码：报名详情页展示、展商扫码核销共用同一份内容。 */
    static String registrationCode(String exhibitionId, String recordId) {
        return RegistrationActions.registrationCode(exhibitionId, recordId);
    }

    /** 展会结构：{@link ExhibitionActions} 输出给前端，测试也直接调用。 */
    static Map<String, Object> exhibitionPayload(Activity activity, ExhibitorExhibition exhibition) {
        return ExhibitionActions.exhibitionPayload(activity, exhibition);
    }
}
