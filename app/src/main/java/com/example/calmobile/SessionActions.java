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
 * bootstrap 与启动数据：用户态、配色、外观、能力与服务器设置下发。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class SessionActions {

    private SessionActions() {
    }

    static Map<String, Object> bootstrap(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", userPayload(activity));
        data.put("theme", themePayload(activity));
        data.put("ui", uiPayload(activity));
        data.put("capabilities", capabilities(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", reviewPolicy(activity));
        data.put("media", mediaLimits(activity));
        data.put("announcement", announcement(activity));
        data.put("brand", brand(activity));
        data.put("limits", textLimits(activity));
        data.put("server", serverSettings(activity));
        Map<String, Object> calendar = new LinkedHashMap<>();
        calendar.put("available", CalendarHelper.hasCalendarPermissions(activity));
        data.put("calendar", calendar);
        return data;
    }

    static Map<String, Object> userPayload(Activity activity) {
        AuthManager auth = AuthManager.getInstance();
        boolean loggedIn = auth.isLoggedIn();
        String username = loggedIn ? ActionSupport.safe(auth.getCurrentUsername()) : "";
        UserProfileStore.Profile stored = loggedIn ? UserProfileStore.get(activity, username) : null;
        AdminUser record = loggedIn ? AdminActions.findUserByNickname(username) : null;

        Map<String, Object> can = new LinkedHashMap<>();
        can.put("register", auth.canRegisterForExhibitions());
        can.put("profile", auth.canAccessProfile());
        can.put("exhibitor", auth.canAccessExhibitor());
        can.put("admin", auth.canAccessAdmin());

        Map<String, Object> user = new LinkedHashMap<>();
        user.put("loggedIn", loggedIn);
        user.put("guest", auth.isGuest());
        user.put("username", username);
        user.put("nickname", stored != null && !stored.nickname.isEmpty() ? stored.nickname : username);
        user.put("email", stored != null && !stored.email.isEmpty() ? stored.email
                : ActionSupport.safe(auth.getCurrentUserEmail()));
        user.put("bio", stored == null ? "" : stored.bio);
        user.put("region", stored == null ? "" : stored.region);
        user.put("avatar", stored == null ? "" : stored.avatar);
        user.put("socialMedia", stored == null ? "" : stored.socialMedia);
        user.put("showRegistrations", stored != null && stored.showRegistrations);
        user.put("role", roleKey(auth));
        user.put("roleLabel", roleLabel(auth));
        user.put("status", record == null ? "" : ActionSupport.safe(record.getStatus()));
        user.put("lastLoginTime", record == null ? "" : ActionSupport.safe(record.getLastLoginTime()));
        user.put("can", can);
        return user;
    }

    static String roleKey(AuthManager auth) {
        if (auth.isAdmin()) {
            return "admin";
        }
        if (auth.isExhibitor()) {
            return "exhibitor";
        }
        return auth.isLoggedIn() ? "user" : "guest";
    }

    static String roleLabel(AuthManager auth) {
        if (auth.isAdmin()) {
            return "管理员";
        }
        if (auth.isExhibitor()) {
            return "展商";
        }
        return auth.isLoggedIn() ? "普通用户" : "访客";
    }

    static Map<String, Object> themePayload(Activity activity) {
        List<String> hex = new ArrayList<>();
        for (int color : AppSettings.getAccentColors()) {
            hex.add(String.format(java.util.Locale.US, "#%06X", 0xFFFFFF & color));
        }
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("index", AppSettings.getThemeIndex(activity));
        theme.put("colors", hex);
        return theme;
    }

    static Map<String, Object> uiPayload(Activity activity) {
        Map<String, Object> ui = new LinkedHashMap<>();
        ui.put("mode", AppSettings.getUiMode(activity));
        return ui;
    }

    static Map<String, Object> capabilities(Activity activity) {
        Map<String, Object> caps = new LinkedHashMap<>();
        caps.put("calendar", CalendarHelper.hasCalendarPermissions(activity));
        caps.put("notifications", NotificationHelper.getInstance(activity).hasNotificationPermission());
        caps.put("richText", true);
        caps.put("export", true);
        return caps;
    }

    static Map<String, Object> reviewPolicy(Activity activity) {
        Map<String, Object> review = new LinkedHashMap<>();
        review.put("canRevise", AppSettings.canReviseReviewedRegistration(activity));
        review.put("statuses", Arrays.asList(RegistrationReviewStore.STATUS_PENDING,
                RegistrationReviewStore.STATUS_APPROVED, RegistrationReviewStore.STATUS_REJECTED));
        return review;
    }

    static Map<String, Object> mediaLimits(Activity activity) {
        Map<String, Object> media = new LinkedHashMap<>();
        media.put("imageCount", AppSettings.getMediaImageLimit(activity));
        media.put("imageSizeMb", AppSettings.getMediaImageSizeMb(activity));
        media.put("videoCount", AppSettings.getMediaVideoLimit(activity));
        return media;
    }

    static Map<String, Object> serverSettings(Activity activity) {
        Map<String, Object> server = new LinkedHashMap<>();
        server.put("avatarSizeMb", AppSettings.getMediaAvatarSizeMb(activity));
        server.put("imageFormats", AppSettings.getImageFormats(activity));
        server.put("videoFormats", AppSettings.getVideoFormats(activity));
        return server;
    }

    /** 前端 limits：键名与取值范围由 {@link AppSettings.TextLimit} 单点维护。 */
    static Map<String, Object> textLimits(Activity activity) {
        Map<String, Object> limits = new LinkedHashMap<>();
        for (AppSettings.TextLimit limit : AppSettings.TextLimit.values()) {
            limits.put(limit.wireName, AppSettings.getTextLimit(activity, limit));
        }
        return limits;
    }

    static Map<String, Object> announcement(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", AppSettings.isAnnouncementEnabled(activity));
        data.put("text", AppSettings.getAnnouncement(activity));
        return data;
    }

    static Map<String, Object> brand(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("zh", AppSettings.getAppTitleZh(activity));
        data.put("en", AppSettings.getAppTitleEn(activity));
        return data;
    }}
