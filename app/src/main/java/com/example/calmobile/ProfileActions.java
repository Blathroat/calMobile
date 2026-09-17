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
 * 登录注册、个人资料、密码与通知偏好。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class ProfileActions {

    private ProfileActions() {
    }

    static Map<String, Object> login(Activity activity, Map<String, Object> payload) {
        String error = AuthManager.getInstance().login(WebAppBridge.text(payload, "username", ""),
                WebAppBridge.text(payload, "password", ""));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error == null);
        result.put("error", error == null ? "" : error);
        result.put("user", SessionActions.userPayload(activity));
        return result;
    }

    static Map<String, Object> register(Activity activity, Map<String, Object> payload) {
        String username = WebAppBridge.text(payload, "username", "");
        String password = WebAppBridge.text(payload, "password", "");
        String confirm = WebAppBridge.text(payload, "confirmPassword", "");
        String email = WebAppBridge.text(payload, "email", "");
        Map<String, Object> result = new LinkedHashMap<>();
        String error = "";
        if (!confirm.isEmpty() && !confirm.equals(password)) {
            error = "两次输入的密码不一致";
        } else {
            error = validateUsername(activity, username);
            if (error.isEmpty()) {
                error = validatePassword(activity, password);
            }
            if (error.isEmpty() && !email.isEmpty() && !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                error = "邮箱格式不正确";
            }
        }
        if (error.isEmpty()) {
            error = AuthManager.getInstance().register(username, password, email);
        }
        if (error == null || error.isEmpty()) {
            UserProfileStore.save(activity, username.trim().toLowerCase(), username.trim(), email,
                    "", "", "", "", false);
            error = "";
        }        result.put("ok", error.isEmpty());
        result.put("error", error == null ? "" : error);
        result.put("user", SessionActions.userPayload(activity));
        return result;
    }

    static String validateUsername(Activity activity, String username) {
        String value = username == null ? "" : username.trim();
        int min = AppSettings.getUsernameMin(activity);
        int max = AppSettings.getUsernameMax(activity);
        if (value.isEmpty()) {
            return "请输入用户名";
        }
        if (value.length() < min) {
            return "用户名至少需要 " + min + " 个字符";
        }
        if (value.length() > max) {
            return "用户名最多 " + max + " 个字符";
        }
        if (!value.matches("[A-Za-z0-9_\\u4e00-\\u9fa5]+")) {
            return "用户名只能包含中英文、数字与下划线";
        }
        return "";
    }

    static String validatePassword(Activity activity, String password) {
        String value = password == null ? "" : password;
        int min = AppSettings.getPasswordMin(activity);
        int max = AppSettings.getPasswordMax(activity);
        if (value.isEmpty()) {
            return "请输入密码";
        }
        if (value.length() < min) {
            return "密码至少需要 " + min + " 个字符";
        }
        if (value.length() > max) {
            return "密码最多 " + max + " 个字符";
        }
        return "";
    }

    static String validateLength(Activity activity, String value, int limit, String label) {
        int length = value == null ? 0 : value.trim().length();
        return length > limit ? label + "最多 " + limit + " 个字符" : "";
    }

    static Map<String, Object> saveProfile(Activity activity, Map<String, Object> payload) {
        AuthManager auth = AuthManager.getInstance();
        String nickname = WebAppBridge.text(payload, "nickname", "").trim();
        String email = WebAppBridge.text(payload, "email", "").trim();
        String bio = WebAppBridge.text(payload, "bio", "").trim();
        String region = WebAppBridge.text(payload, "region", "").trim();
        String avatar = WebAppBridge.text(payload, "avatar", "").trim();
        String socialMedia = WebAppBridge.text(payload, "socialMedia", "").trim();
        boolean showRegistrations = WebAppBridge.flag(payload, "showRegistrations", false);
        String error = "";
        if (!auth.isLoggedIn()) {
            error = "请先登录";
        } else if (nickname.isEmpty()) {
            error = "昵称不能为空";
        }
        if (error.isEmpty()) {
            error = validateLength(activity, nickname, AppSettings.getNicknameLimit(activity), "昵称");
        }
        if (error.isEmpty() && !email.isEmpty()
                && !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            error = "邮箱格式不正确";
        }
        if (error.isEmpty()) {
            error = validateLength(activity, bio, AppSettings.getBioLimit(activity), "个人简介");
        }
        if (error.isEmpty()) {
            error = validateLength(activity, region, AppSettings.getRegionLimit(activity), "地区");
        }
        if (error.isEmpty()) {
            UserProfileStore.save(activity, auth.getCurrentUsername(), nickname, email, bio, region,
                    avatar, socialMedia, showRegistrations);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error.isEmpty());
        result.put("error", error);
        result.put("user", SessionActions.userPayload(activity));
        return result;
    }

    static Map<String, Object> changePassword(Activity activity, Map<String, Object> payload) {
        String current = WebAppBridge.text(payload, "currentPassword", "");
        String next = WebAppBridge.text(payload, "newPassword", "");
        String confirm = WebAppBridge.text(payload, "confirmPassword", "");
        String error = "";
        if (!AuthManager.getInstance().isLoggedIn()) {
            error = "请先登录";
        } else if (current.isEmpty() || next.isEmpty()) {
            error = "请填写完整密码";
        } else {
            error = validatePassword(activity, next);
        }
        if (error.isEmpty() && !next.equals(confirm)) {
            error = "两次输入的新密码不一致";
        }
        if (error.isEmpty() && current.equals(next)) {
            error = "新密码不能与当前密码相同";
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error.isEmpty());
        result.put("error", error);
        result.put("note", error.isEmpty() ? "演示环境不会修改密码，仅校验输入" : "");
        return result;
    }

    static Map<String, Object> notificationPreferences(Activity activity) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exhibitionReminder", helper.isExhibitionReminderEnabled());
        data.put("registrationUpdates", helper.isRegistrationUpdatesEnabled());
        data.put("granted", helper.hasNotificationPermission());
        return data;
    }

    static void saveNotificationPreferences(Activity activity, Map<String, Object> payload) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        helper.setExhibitionReminderEnabled(
                WebAppBridge.flag(payload, "exhibitionReminder", helper.isExhibitionReminderEnabled()));
        helper.setRegistrationUpdatesEnabled(
                WebAppBridge.flag(payload, "registrationUpdates", helper.isRegistrationUpdatesEnabled()));
    }
    /** 访客身份进入：不登录也能浏览公开展会。 */
    static Map<String, Object> enterAsGuest(Activity activity) {
        AuthManager.getInstance().enterAsGuest();
        return SessionActions.userPayload(activity);
    }

    /** 退出登录：清掉当前会话。 */
    static boolean logout() {
        AuthManager.getInstance().logout();
        return true;
    }
}
