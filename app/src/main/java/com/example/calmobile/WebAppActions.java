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
 * WebView 前端的业务动作实现。
 * <p>
 * 复用现有的 Manager、SQLite、SharedPreferences 与日历/通知辅助类，只把结果整理成前端可直接渲染的 JSON 结构。
 */
final class WebAppActions {

    private static final String TAG = "WebAppActions";

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
                callback.success(bootstrap(activity));
                return;
            case "auth.login":
                callback.success(login(activity, payload));
                return;
            case "auth.register":
                callback.success(register(activity, payload));
                return;
            case "auth.guest":
                AuthManager.getInstance().enterAsGuest();
                callback.success(userPayload(activity));
                return;
            case "auth.logout":
                AuthManager.getInstance().logout();
                callback.success(true);
                return;
            case "profile.get":
                callback.success(userPayload(activity));
                return;
            case "profile.save":
                callback.success(saveProfile(activity, payload));
                return;
            case "profile.password":
                callback.success(changePassword(activity, payload));
                return;
            case "notify.preferences":
                callback.success(notificationPreferences(activity));
                return;
            case "notify.savePreferences":
                saveNotificationPreferences(activity, payload);
                callback.success(notificationPreferences(activity));
                return;
            case "notify.requestPermission":
                requestNotificationPermission(bridge, callback);
                return;
            case "exhibitions.list":
                callback.success(exhibitions(activity, payload));
                return;
            case "exhibitions.month":
                callback.success(monthPayload(activity, payload));
                return;
            case "exhibitions.get":
                callback.success(findExhibition(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.save":
                callback.success(saveExhibition(activity, payload));
                return;
            case "exhibitions.delete":
                callback.success(ExhibitionManager.delete(WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.status":
                callback.success(ExhibitionManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                        WebAppBridge.text(payload, "status", "")));
                return;
            case "exhibitions.categories":
                callback.success(AppSettings.getCategories(activity));
                return;
            case "exhibitions.fields":
                callback.success(fieldsPayload(WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.saveFields":
                callback.success(saveFields(WebAppBridge.text(payload, "id", ""), payload));
                return;
            case "registrations.list":
                callback.success(myRegistrations(activity));
                return;
            case "registrations.get":
                callback.success(findRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "registrations.submit":
                callback.success(submitRegistration(activity, payload));
                return;
            case "registrations.cancel":
                callback.success(cancelRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "review.list":
                callback.success(reviewList(payload));
                return;
            case "review.get":
                callback.success(reviewDetail(WebAppBridge.text(payload, "id", "")));
                return;
            case "review.updateStatus":
                callback.success(updateReviewStatus(activity, payload));
                return;
            case "users.list":
                callback.success(users(payload));
                return;
            case "users.get":
                callback.success(findUser(WebAppBridge.text(payload, "id", "")));
                return;
            case "users.status":
                callback.success(AdminUserManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                        WebAppBridge.text(payload, "status", "")));
                return;
            case "users.public":
                callback.success(publicProfile(activity, payload));
                return;
            case "search.query":
                callback.success(search(activity, WebAppBridge.text(payload, "query", "")));
                return;
            case "settings.get":
                callback.success(settings(activity));
                return;
            case "settings.save":
                callback.success(saveSettings(activity, payload));
                return;
            case "calendar.status":
                callback.success(calendarStatus(activity, payload));
                return;
            case "calendar.toggle":
                toggleCalendar(bridge, payload, callback);
                return;
            case "media.imageData":
                callback.success(imageData(activity, WebAppBridge.text(payload, "uri", "")));
                return;
            case "media.pickImage":
                pickFile(bridge, "image/*", "选择图片", callback);
                return;
            case "media.pickVideo":
                pickFile(bridge, "video/*", "选择视频", callback);
                return;
            case "media.import":
                importMedia(bridge, payload, callback);
                return;
            case "media.store":
                callback.success(storeDataUrl(activity, payload));
                return;
            case "share.text":
                shareText(activity, payload);
                callback.success(true);
                return;
            case "export.csv":
                exportCsv(bridge, payload, callback);
                return;
            case "toast":
                toast(activity, WebAppBridge.text(payload, "message", ""));
                callback.success(true);
                return;
            default:
                callback.failure("未实现的动作：" + action);
        }
    }

    // ── 启动数据 ───────────────────────────────────────────────

    private static Map<String, Object> bootstrap(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", userPayload(activity));
        data.put("theme", themePayload(activity));
        data.put("capabilities", capabilities(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", reviewPolicy(activity));
        data.put("media", mediaLimits(activity));
        data.put("announcement", announcement(activity));
        data.put("limits", textLimits(activity));
        data.put("server", serverSettings(activity));
        Map<String, Object> calendar = new LinkedHashMap<>();
        calendar.put("available", CalendarHelper.hasCalendarPermissions(activity));
        data.put("calendar", calendar);
        return data;
    }

    /** 当前会话身份与角色权限，供导航和入口显隐使用。 */
    private static Map<String, Object> userPayload(Activity activity) {
        AuthManager auth = AuthManager.getInstance();
        boolean loggedIn = auth.isLoggedIn();
        String username = loggedIn ? safe(auth.getCurrentUsername()) : "";
        UserProfileStore.Profile stored = loggedIn ? UserProfileStore.get(activity, username) : null;
        AdminUser record = loggedIn ? findUserByNickname(username) : null;

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
                : safe(auth.getCurrentUserEmail()));
        user.put("bio", stored == null ? "" : stored.bio);
        user.put("region", stored == null ? "" : stored.region);
        user.put("avatar", stored == null ? "" : stored.avatar);
        user.put("socialMedia", stored == null ? "" : stored.socialMedia);
        user.put("showRegistrations", stored != null && stored.showRegistrations);
        user.put("role", roleKey(auth));
        user.put("roleLabel", roleLabel(auth));
        user.put("status", record == null ? "" : safe(record.getStatus()));
        user.put("lastLoginTime", record == null ? "" : safe(record.getLastLoginTime()));
        user.put("can", can);
        return user;
    }

    private static String roleKey(AuthManager auth) {
        if (auth.isAdmin()) {
            return "admin";
        }
        if (auth.isExhibitor()) {
            return "exhibitor";
        }
        return auth.isLoggedIn() ? "user" : "guest";
    }

    private static String roleLabel(AuthManager auth) {
        if (auth.isAdmin()) {
            return "管理员";
        }
        if (auth.isExhibitor()) {
            return "展商";
        }
        return auth.isLoggedIn() ? "普通用户" : "访客";
    }

    private static Map<String, Object> themePayload(Activity activity) {
        List<String> hex = new ArrayList<>();
        for (int color : AppSettings.getAccentColors()) {
            hex.add(String.format(java.util.Locale.US, "#%06X", 0xFFFFFF & color));
        }
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("index", AppSettings.getThemeIndex(activity));
        theme.put("colors", hex);
        return theme;
    }

    private static Map<String, Object> capabilities(Activity activity) {
        Map<String, Object> caps = new LinkedHashMap<>();
        caps.put("calendar", CalendarHelper.hasCalendarPermissions(activity));
        caps.put("notifications", NotificationHelper.getInstance(activity).hasNotificationPermission());
        caps.put("richText", true);
        caps.put("export", true);
        return caps;
    }

    private static Map<String, Object> reviewPolicy(Activity activity) {
        Map<String, Object> review = new LinkedHashMap<>();
        review.put("canRevise", AppSettings.canReviseReviewedRegistration(activity));
        review.put("statuses", Arrays.asList(RegistrationReviewStore.STATUS_PENDING,
                RegistrationReviewStore.STATUS_APPROVED, RegistrationReviewStore.STATUS_REJECTED));
        return review;
    }

    private static Map<String, Object> mediaLimits(Activity activity) {
        Map<String, Object> media = new LinkedHashMap<>();
        media.put("imageCount", AppSettings.getMediaImageLimit(activity));
        media.put("imageSizeMb", AppSettings.getMediaImageSizeMb(activity));
        media.put("videoCount", AppSettings.getMediaVideoLimit(activity));
        return media;
    }

    /** 服务器设置：头像与上传格式限制，管理员保存后对所有用户生效。 */
    private static Map<String, Object> serverSettings(Activity activity) {
        Map<String, Object> server = new LinkedHashMap<>();
        server.put("avatarSizeMb", AppSettings.getMediaAvatarSizeMb(activity));
        server.put("imageFormats", AppSettings.getImageFormats(activity));
        server.put("videoFormats", AppSettings.getVideoFormats(activity));
        return server;
    }

    /** 服务器设置：普通用户与展商可自由填写的表单字符数上限。 */
    private static Map<String, Object> textLimits(Activity activity) {
        Map<String, Object> limits = new LinkedHashMap<>();
        limits.put("exhibitionTitle", AppSettings.getExhibitionTitleLimit(activity));
        limits.put("exhibitionVenue", AppSettings.getExhibitionVenueLimit(activity));
        limits.put("category", AppSettings.getCategoryLimit(activity));
        limits.put("fieldTitle", AppSettings.getFieldTitleLimit(activity));
        limits.put("usernameMin", AppSettings.getUsernameMin(activity));
        limits.put("usernameMax", AppSettings.getUsernameMax(activity));
        limits.put("passwordMin", AppSettings.getPasswordMin(activity));
        limits.put("passwordMax", AppSettings.getPasswordMax(activity));
        limits.put("nickname", AppSettings.getNicknameLimit(activity));
        limits.put("bio", AppSettings.getBioLimit(activity));
        limits.put("region", AppSettings.getRegionLimit(activity));
        limits.put("answer", AppSettings.getAnswerLimit(activity));
        return limits;
    }

    private static Map<String, Object> announcement(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", AppSettings.isAnnouncementEnabled(activity));
        data.put("text", AppSettings.getAnnouncement(activity));
        return data;
    }

    // ── 认证与个人资料 ─────────────────────────────────────────

    private static Map<String, Object> login(Activity activity, Map<String, Object> payload) {
        String error = AuthManager.getInstance().login(WebAppBridge.text(payload, "username", ""),
                WebAppBridge.text(payload, "password", ""));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error == null);
        result.put("error", error == null ? "" : error);
        result.put("user", userPayload(activity));
        return result;
    }

    private static Map<String, Object> register(Activity activity, Map<String, Object> payload) {
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
        result.put("user", userPayload(activity));
        return result;
    }

    // ── 表单字符数校验（与前端校验保持一致，避免绕过页面直接调用桥接） ──

    private static String validateUsername(Activity activity, String username) {
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

    private static String validatePassword(Activity activity, String password) {
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

    private static String validateLength(Activity activity, String value, int limit, String label) {
        int length = value == null ? 0 : value.trim().length();
        return length > limit ? label + "最多 " + limit + " 个字符" : "";
    }

    private static Map<String, Object> saveProfile(Activity activity, Map<String, Object> payload) {
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
        result.put("user", userPayload(activity));
        return result;
    }

    private static Map<String, Object> changePassword(Activity activity, Map<String, Object> payload) {
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

    private static Map<String, Object> notificationPreferences(Activity activity) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exhibitionReminder", helper.isExhibitionReminderEnabled());
        data.put("registrationUpdates", helper.isRegistrationUpdatesEnabled());
        data.put("granted", helper.hasNotificationPermission());
        return data;
    }

    private static void saveNotificationPreferences(Activity activity, Map<String, Object> payload) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        helper.setExhibitionReminderEnabled(
                WebAppBridge.flag(payload, "exhibitionReminder", helper.isExhibitionReminderEnabled()));
        helper.setRegistrationUpdatesEnabled(
                WebAppBridge.flag(payload, "registrationUpdates", helper.isRegistrationUpdatesEnabled()));
    }

    private static void requestNotificationPermission(WebAppBridge bridge,
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

    // ── 展会数据 ───────────────────────────────────────────────

    /** 展会统一结构：数据库记录与首页样例数据合并后的结果。 */
    static Map<String, Object> exhibitionPayload(Activity activity, ExhibitorExhibition exhibition) {
        ExhibitionCatalog.Entry sample = ExhibitionCatalog.findByTitle(exhibition.getTitle());
        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibition.getId());
        String date = ExhibitionConfiguration.displayDate(exhibition.getId(), exhibition.getDay());
        int month = monthOf(date, sample == null ? 6 : sample.month);
        int day = dayOf(date, exhibition.getDay());

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", exhibition.getId());
        item.put("title", exhibition.getTitle());
        item.put("venue", exhibition.getVenue());
        item.put("time", exhibition.getTime());
        item.put("category", safe(exhibition.getCategory()));
        item.put("description", safe(exhibition.getDescription()));
        item.put("descriptionFormat", descriptionFormatOf(config, exhibition.getDescription()));
        item.put("status", exhibition.getStatus());
        item.put("mode", registrationMode(exhibition.getStatus()));
        item.put("modeLabel", modeLabel(exhibition.getStatus()));
        item.put("openForRegistration", exhibition.isOpenForRegistration());
        item.put("year", yearOf(date, 2026));
        item.put("month", month);
        item.put("day", day);
        item.put("date", date);
        item.put("dateLabel", month + "月" + day + "日");
        item.put("exhibitor", sample == null ? "主办方" : sample.exhibitor);
        item.put("exhibitorNote", sample == null ? "主办方公开信息" : sample.exhibitorNote);
        item.put("highlights", sample == null ? new ArrayList<String>() : sample.highlights);
        item.put("imageUri", safe(config.imageUri));
        item.put("registrationStart", safe(config.registrationStart));
        item.put("registrationEnd", safe(config.registrationEnd));
        item.put("registrationCount", RegistrationReviewStore.countByStatus(exhibition.getId(), null));
        item.put("fieldCount", config.fields.size());
        return item;
    }

    private static List<Map<String, Object>> exhibitions(Activity activity, Map<String, Object> payload) {
        String query = WebAppBridge.text(payload, "query", "");
        String category = WebAppBridge.text(payload, "category", "");
        List<ExhibitorExhibition> source = query.isEmpty()
                ? ExhibitionManager.listAll()
                : ExhibitionManager.search(query);
        List<Map<String, Object>> items = new ArrayList<>();
        for (ExhibitorExhibition exhibition : source) {
            Map<String, Object> item = exhibitionPayload(activity, exhibition);
            if (!category.isEmpty() && !category.equals(item.get("category"))) {
                continue;
            }
            items.add(item);
        }
        return items;
    }

    private static Map<String, Object> findExhibition(Activity activity, String id) {
        ExhibitorExhibition exhibition = ExhibitionManager.findById(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (exhibition == null) {
            result.put("found", false);
            result.put("error", "展会不存在或已删除");
            return result;
        }
        result.put("found", true);
        result.put("exhibition", exhibitionPayload(activity, exhibition));
        result.put("fields", fieldsPayload(id));
        return result;
    }

    private static Map<String, Object> monthPayload(Activity activity, Map<String, Object> payload) {
        int year = WebAppBridge.number(payload, "year", 2026);
        int month = WebAppBridge.number(payload, "month", 6);
        int selectedDay = WebAppBridge.number(payload, "day", 0);
        // 用户主动翻月（滑动或箭头）时不再回退到有数据的月份，空月份如实展示。
        boolean explicit = WebAppBridge.flag(payload, "explicit", false);
        List<Map<String, Object>> all = exhibitions(activity, new LinkedHashMap<String, Object>());

        // 请求的月份没有展会时落到最早有展会的月份，避免首页首次进入是空列表。
        List<int[]> months = new ArrayList<>();
        for (Map<String, Object> item : all) {
            int itemYear = ((Number) item.get("year")).intValue();
            int itemMonth = ((Number) item.get("month")).intValue();
            boolean known = false;
            for (int[] entry : months) {
                if (entry[0] == itemYear && entry[1] == itemMonth) {
                    known = true;
                    break;
                }
            }
            if (!known) {
                months.add(new int[] { itemYear, itemMonth });
            }
        }
        boolean matched = false;
        for (Map<String, Object> item : all) {
            if (((Number) item.get("year")).intValue() == year
                    && ((Number) item.get("month")).intValue() == month) {
                matched = true;
                break;
            }
        }
        if (!matched && !months.isEmpty() && !explicit) {
            year = months.get(0)[0];
            month = months.get(0)[1];
            selectedDay = 0;
        }

        List<Map<String, Object>> days = new ArrayList<>();
        List<Map<String, Object>> selected = new ArrayList<>();
        for (Map<String, Object> item : all) {
            if (((Number) item.get("year")).intValue() != year
                    || ((Number) item.get("month")).intValue() != month) {
                continue;
            }
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("id", item.get("id"));
            summary.put("day", item.get("day"));
            summary.put("title", item.get("title"));
            summary.put("time", item.get("time"));
            summary.put("venue", item.get("venue"));
            summary.put("status", item.get("status"));
            summary.put("modeLabel", item.get("modeLabel"));
            summary.put("openForRegistration", item.get("openForRegistration"));
            summary.put("imageUri", item.get("imageUri"));
            summary.put("category", item.get("category"));
            days.add(summary);
            if (selectedDay <= 0 || Integer.valueOf(selectedDay).equals(item.get("day"))) {
                selected.add(summary);
            }
        }
        if (selectedDay <= 0 && !days.isEmpty()) {
            Integer first = (Integer) days.get(0).get("day");
            selectedDay = first == null ? 0 : first;
            selected.clear();
            for (Map<String, Object> item : days) {
                if (Integer.valueOf(selectedDay).equals(item.get("day"))) {
                    selected.add(item);
                }
            }
        }
        List<Integer> eventDays = new ArrayList<>();
        for (Map<String, Object> item : days) {
            Integer day = (Integer) item.get("day");
            if (day != null && !eventDays.contains(day)) {
                eventDays.add(day);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("year", year);
        result.put("month", month);
        result.put("day", selectedDay);
        result.put("monthLabel", year + " 年 " + month + " 月");
        result.put("eventDays", eventDays);
        result.put("exhibitions", days);
        result.put("selected", selected);
        return result;
    }

    private static Map<String, Object> saveExhibition(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String title = WebAppBridge.text(payload, "title", "").trim();
        String venue = WebAppBridge.text(payload, "venue", "").trim();
        String time = WebAppBridge.text(payload, "time", "").trim();
        String status = WebAppBridge.text(payload, "status", ExhibitorExhibition.STATUS_OPEN);
        String description = WebAppBridge.text(payload, "description", "");
        String descriptionFormat = WebAppBridge.text(payload, "descriptionFormat", "md");
        String category = WebAppBridge.text(payload, "category", "");
        String date = WebAppBridge.text(payload, "date", "");
        String registrationStart = WebAppBridge.text(payload, "registrationStart", "");
        String registrationEnd = WebAppBridge.text(payload, "registrationEnd", "");
        int day = dayOf(date, WebAppBridge.number(payload, "day", 1));

        Map<String, Object> result = new LinkedHashMap<>();
        if (title.isEmpty()) {
            result.put("ok", false);
            result.put("error", "展会名称不能为空");
            return result;
        }
        String lengthError = validateLength(activity, title, AppSettings.getExhibitionTitleLimit(activity), "展会名称");
        if (lengthError.isEmpty()) {
            lengthError = validateLength(activity, venue, AppSettings.getExhibitionVenueLimit(activity), "展会地点");
        }
        if (lengthError.isEmpty()) {
            lengthError = validateLength(activity, category, AppSettings.getCategoryLimit(activity), "展会分类");
        }
        if (!lengthError.isEmpty()) {
            result.put("ok", false);
            result.put("error", lengthError);
            return result;
        }
        if (day <= 0) {
            result.put("ok", false);
            result.put("error", "请选择展会日期");
            return result;
        }
        if (!registrationStart.isEmpty() && !registrationEnd.isEmpty()
                && registrationEnd.compareTo(registrationStart) < 0) {
            result.put("ok", false);
            result.put("error", "报名截止日期不能早于开始日期");
            return result;
        }
        // 长简介里的内联图片改写成本地文件 URL，避免 base64 撑大正文。
        description = inlineDataUrlsToFiles(activity, description);

        ExhibitorExhibition saved;
        if (id.isEmpty()) {
            saved = ExhibitionManager.add(day, title, venue, time, status, description, category);
        } else {
            boolean updated = ExhibitionManager.update(id, day, title, venue, time, status, description, category);
            saved = updated ? ExhibitionManager.findById(id) : null;
        }
        if (saved == null) {
            result.put("ok", false);
            result.put("error", "保存失败，请稍后重试");
            return result;
        }

        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(saved.getId());
        ExhibitionConfiguration.save(saved.getId(), date.isEmpty() ? config.exhibitionDate : date,
                registrationStart.isEmpty() ? config.registrationStart : registrationStart,
                registrationEnd.isEmpty() ? config.registrationEnd : registrationEnd,
                WebAppBridge.text(payload, "imageUri", config.imageUri),
                config.fields);
        config.descriptionFormat = "html".equals(descriptionFormat) ? "html" : "md";
        saveExhibitionFields(saved.getId(), payload);

        result.put("ok", true);
        result.put("error", "");
        result.put("exhibition", exhibitionPayload(activity, saved));
        return result;
    }

    /** 表单携带的报名收集项，缺省时保留原配置。 */
    private static void saveExhibitionFields(String exhibitionId, Map<String, Object> payload) {
        List<Object> rawFields = WebAppBridge.list(payload, "fields");
        if (rawFields.isEmpty()) {
            return;
        }
        List<RegistrationField> fields = new ArrayList<>();
        for (Object raw : rawFields) {
            if (!(raw instanceof Map)) {
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> item = (Map<String, Object>) raw;
            String title = WebAppBridge.text(item, "title", "").trim();
            if (title.isEmpty()) {
                continue;
            }
            fields.add(new RegistrationField(title, WebAppBridge.text(item, "type", RegistrationField.TYPE_TEXT),
                    WebAppBridge.flag(item, "required", false), optionsText(item.get("options"))));
        }
        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibitionId);
        ExhibitionConfiguration.save(exhibitionId, config.exhibitionDate, config.registrationStart,
                config.registrationEnd, config.imageUri, fields);
    }

    /** 选项兼容两种前端结构：字符串（逗号分隔）与字符串数组。 */
    private static String optionsText(Object raw) {
        if (raw instanceof List) {
            StringBuilder builder = new StringBuilder();
            for (Object item : (List<?>) raw) {
                String value = String.valueOf(item).trim();
                if (value.isEmpty()) {
                    continue;
                }
                if (builder.length() > 0) {
                    builder.append(',');
                }
                builder.append(value);
            }
            return builder.toString();
        }
        return raw == null ? "" : String.valueOf(raw);
    }

    /** 选项在桥接层统一输出为数组，前端可直接增删条目。 */
    private static List<String> optionsList(String options) {
        List<String> result = new ArrayList<>();
        if (options == null) {
            return result;
        }
        for (String item : options.split(",")) {
            String value = item.trim();
            if (!value.isEmpty()) {
                result.add(value);
            }
        }
        return result;
    }

    private static List<Map<String, Object>> fieldsPayload(String exhibitionId) {
        List<RegistrationField> fields = ExhibitionConfiguration.get(exhibitionId).fields;
        return fields.isEmpty() ? defaultFields() : fieldPayloads(fields);
    }

    /** 展会未配置报名项时，按 newUI 报名页的默认字段渲染。 */
    private static List<Map<String, Object>> defaultFields() {
        List<Map<String, Object>> fields = new ArrayList<>();
        fields.add(field("姓名 / 公司名称", RegistrationField.TYPE_TEXT, true, new ArrayList<String>()));
        fields.add(field("参观身份", RegistrationField.TYPE_SINGLE, true,
                Arrays.asList("专业观众", "采购负责人", "媒体伙伴")));
        fields.add(field("报名需求", RegistrationField.TYPE_MULTI, false,
                Arrays.asList("希望安排展商洽谈", "开展前一天提醒")));
        return fields;
    }

    private static List<Map<String, Object>> fieldPayloads(List<RegistrationField> fields) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (RegistrationField item : fields) {
            result.add(field(item.getTitle(), item.getType(), item.isRequired(), optionsList(item.getOptions())));
        }
        return result;
    }

    private static Map<String, Object> field(String title, String type, boolean required, List<String> options) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("title", title);
        field.put("type", type);
        field.put("required", required);
        field.put("options", options == null ? new ArrayList<String>() : options);
        return field;
    }

    /** 简介格式：旧数据没有格式标记时按内容特征推断，避免把 HTML 当作 Markdown 渲染。 */
    private static String descriptionFormatOf(ExhibitionConfiguration.Data config, String description) {
        if ("html".equals(config.descriptionFormat)) {
            return "html";
        }
        String text = description == null ? "" : description.trim();
        if (text.matches("(?s)^\\s*<(p|div|h[1-6]|ul|ol|blockquote|br|strong|em)\\b.*")) {
            return "html";
        }
        return "md";
    }

    private static Map<String, Object> saveFields(String exhibitionId, Map<String, Object> payload) {
        saveExhibitionFields(exhibitionId, payload);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fields", fieldsPayload(exhibitionId));
        return result;
    }

    // ── 报名记录 ───────────────────────────────────────────────

    /**
     * 报名状态文字。
     * <p>
     * SQLite 里的 Registration 只保存 PENDING / CANCELLED，审核结果记录在
     * {@link RegistrationReviewStore}，因此优先取审核记录里的状态，前端与展商后台保持一致。
     */
    private static String registrationStatusLabel(Registration registration) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(registration.getId());
        if (record != null && record.status != null && !record.status.isEmpty()) {
            return record.status;
        }
        return registration.getStatus() == Registration.Status.CANCELLED ? "已撤销" : "待审核";
    }

    private static Map<String, Object> registrationPayload(Registration registration) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", registration.getId());
        item.put("exhibitionTitle", registration.getExhibitionTitle());
        item.put("exhibitionDay", registration.getExhibitionDay());
        item.put("exhibitionTime", safe(registration.getExhibitionTime()));
        item.put("exhibitionVenue", safe(registration.getExhibitionVenue()));
        item.put("visitorName", registration.getVisitorName());
        item.put("visitorType", safe(registration.getVisitorType()));
        item.put("answers", safe(registration.getNeedsSummary()));
        item.put("status", registration.getStatus().name());
        item.put("statusLabel", registrationStatusLabel(registration));
        return item;
    }

    private static List<Map<String, Object>> myRegistrations(Activity activity) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Registration registration : new RegistrationManager().list()) {
            result.add(registrationPayload(registration));
        }
        return result;
    }

    private static Map<String, Object> findRegistration(Activity activity, String id) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Registration registration : new RegistrationManager().list()) {
            if (registration.getId().equals(id)) {
                result.put("found", true);
                result.put("registration", registrationPayload(registration));
                return result;
            }
        }
        result.put("found", false);
        result.put("error", "报名记录不存在");
        return result;
    }

    private static Map<String, Object> submitRegistration(Activity activity, Map<String, Object> payload) {
        String exhibitionId = WebAppBridge.text(payload, "exhibitionId", "");
        String title = WebAppBridge.text(payload, "title", "");
        String venue = WebAppBridge.text(payload, "venue", "");
        String time = WebAppBridge.text(payload, "time", "");
        int day = WebAppBridge.number(payload, "day", 1);
        String visitorName = WebAppBridge.text(payload, "visitorName", "");
        String visitorType = WebAppBridge.text(payload, "visitorType", "自定义报名");
        String answers = WebAppBridge.text(payload, "answers", "");

        Map<String, Object> result = new LinkedHashMap<>();
        AuthManager auth = AuthManager.getInstance();
        if (!auth.canRegisterForExhibitions()) {
            result.put("ok", false);
            result.put("error", "请先登录后再报名");
            return result;
        }
        if (visitorName.isEmpty()) {
            visitorName = safe(auth.getCurrentUsername());
            if (visitorName.isEmpty()) {
                visitorName = "报名用户";
            }
        }
        int answerLimit = AppSettings.getAnswerLimit(activity);
        for (String line : answers.split("\n")) {
            int separator = line.indexOf('：');
            String value = (separator >= 0 ? line.substring(separator + 1) : line).trim();
            if (value.length() > answerLimit && !"未填写".equals(value)) {
                result.put("ok", false);
                result.put("error", "报名填写内容最多 " + answerLimit + " 个字符");
                return result;
            }
        }
        RegistrationManager manager = new RegistrationManager();
        if (manager.hasActiveRegistration(title)) {
            result.put("ok", false);
            result.put("error", "已提交过该展会的报名");
            return result;
        }
        Registration registration = manager.submit(title, day, time, venue, visitorName, visitorType, answers);
        if (registration == null) {
            result.put("ok", false);
            result.put("error", "提交失败，请稍后重试");
            return result;
        }
        RegistrationReviewStore.Record record = RegistrationReviewStore.add(exhibitionId, visitorName, answers);
        // “无需审核”的展会提交即视为通过，展商仍可在报名管理中调整结果。
        boolean autoApproved = autoApprove(activity, exhibitionId, record);
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        if (autoApproved) {
            helper.sendRegistrationStatusNotification(title, visitorName, RegistrationReviewStore.STATUS_APPROVED);
        } else {
            helper.sendRegistrationConfirmation(title, visitorName);
        }
        result.put("ok", true);
        result.put("error", "");
        result.put("autoApproved", autoApproved);
        result.put("statusLabel", autoApproved ? RegistrationReviewStore.STATUS_APPROVED
                : RegistrationReviewStore.STATUS_PENDING);
        result.put("registration", registrationPayload(registration));
        return result;
    }

    /**
     * 无需审核的展会：报名记录直接置为已通过。
     *
     * @return 是否发生了自动通过
     */
    private static boolean autoApprove(Activity activity, String exhibitionId,
            RegistrationReviewStore.Record record) {
        if (record == null) {
            return false;
        }
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        if (exhibition == null || !ExhibitorExhibition.STATUS_REVIEW_OPTIONAL.equals(exhibition.getStatus())) {
            return false;
        }
        RegistrationReviewStore.updateStatus(record.id, RegistrationReviewStore.STATUS_APPROVED);
        DatabaseHelper database = DatabaseHelper.getInstance();
        if (database != null) {
            database.updateRegistrationStatus(record.id, RegistrationReviewStore.STATUS_APPROVED);
        }
        return true;
    }

    private static Map<String, Object> cancelRegistration(Activity activity, String id) {
        Map<String, Object> result = new LinkedHashMap<>();
        RegistrationManager manager = new RegistrationManager();
        String title = "";
        String visitor = "";
        for (Registration registration : manager.list()) {
            if (registration.getId().equals(id)) {
                title = registration.getExhibitionTitle();
                visitor = registration.getVisitorName();
                break;
            }
        }
        boolean cancelled = manager.cancel(id);
        if (cancelled) {
            RegistrationReviewStore.updateStatus(id, RegistrationReviewStore.STATUS_CANCELLED);
            NotificationHelper.getInstance(activity).sendRegistrationStatusNotification(title, visitor,
                    RegistrationReviewStore.STATUS_CANCELLED);
        }
        result.put("ok", cancelled);
        result.put("error", cancelled ? "" : "撤销失败，请稍后重试");
        return result;
    }

    // ── 报名审核 ───────────────────────────────────────────────

    private static Map<String, Object> reviewList(Map<String, Object> payload) {
        String exhibitionId = WebAppBridge.text(payload, "exhibitionId", "");
        String status = WebAppBridge.text(payload, "status", "全部");
        RegistrationReviewStore.ensureSeeded(exhibitionId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (RegistrationReviewStore.Record record : RegistrationReviewStore.listByExhibition(exhibitionId)) {
            if (!"全部".equals(status) && !status.isEmpty() && !status.equals(record.status)) {
                continue;
            }
            items.add(reviewPayload(record));
        }
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("total", RegistrationReviewStore.countByStatus(exhibitionId, null));
        counts.put(RegistrationReviewStore.STATUS_PENDING,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_PENDING));
        counts.put(RegistrationReviewStore.STATUS_APPROVED,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_APPROVED));
        counts.put(RegistrationReviewStore.STATUS_REJECTED,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_REJECTED));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exhibitionId", exhibitionId);
        result.put("status", status);
        result.put("records", items);
        result.put("counts", counts);
        return result;
    }

    private static Map<String, Object> reviewPayload(RegistrationReviewStore.Record record) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", record.id);
        item.put("exhibitionId", record.exhibitionId);
        item.put("visitorName", record.visitorName);
        item.put("registrationTime", record.registrationTime);
        item.put("answers", record.formAnswers == null ? "" : record.formAnswers);
        item.put("summary", summarize(record.formAnswers));
        item.put("status", record.status);
        return item;
    }

    private static Map<String, Object> reviewDetail(String id) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (record == null) {
            result.put("found", false);
            result.put("error", "报名记录不存在");
            return result;
        }
        result.put("found", true);
        result.put("record", reviewPayload(record));
        return result;
    }

    private static Map<String, Object> updateReviewStatus(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String status = WebAppBridge.text(payload, "status", "");
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (record == null) {
            result.put("ok", false);
            result.put("error", "报名记录不存在");
            return result;
        }
        boolean revisable = RegistrationReviewStore.STATUS_PENDING.equals(record.status)
                || AppSettings.canReviseReviewedRegistration(activity);
        if (!revisable) {
            result.put("ok", false);
            result.put("error", "该报名已审核，管理员未开启允许重新审核");
            return result;
        }
        RegistrationReviewStore.updateStatus(id, status);
        DatabaseHelper database = DatabaseHelper.getInstance();
        if (database != null) {
            database.updateRegistrationStatus(id, status);
        }
        NotificationHelper.getInstance(activity).sendRegistrationStatusNotification(
                exhibitionTitleOf(record.exhibitionId), record.visitorName, status);
        result.put("ok", true);
        result.put("error", "");
        result.put("record", reviewPayload(RegistrationReviewStore.find(id)));
        return result;
    }

    private static String exhibitionTitleOf(String exhibitionId) {
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        return exhibition == null ? "展会报名" : exhibition.getTitle();
    }

    private static String summarize(String answers) {
        if (answers == null || answers.isEmpty()) {
            return "未收集额外信息";
        }
        String flat = answers.replace('\n', ' ').replace('\r', ' ').trim();
        return flat.length() > 46 ? flat.substring(0, 46) + "…" : flat;
    }

    // ── 用户管理 ───────────────────────────────────────────────

    private static List<Map<String, Object>> users(Map<String, Object> payload) {
        String query = WebAppBridge.text(payload, "query", "");
        String status = WebAppBridge.text(payload, "status", "");
        List<AdminUser> source = query.isEmpty() ? AdminUserManager.listAll() : AdminUserManager.search(query);
        List<Map<String, Object>> items = new ArrayList<>();
        for (AdminUser user : source) {
            if (!status.isEmpty() && !status.equals(user.getStatus())) {
                continue;
            }
            items.add(adminUserPayload(user));
        }
        return items;
    }

    private static Map<String, Object> adminUserPayload(AdminUser user) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", user.getId());
        item.put("nickname", safe(user.getNickname()));
        item.put("email", safe(user.getEmail()));
        item.put("status", safe(user.getStatus()));
        item.put("registrationTime", safe(user.getRegistrationTime()));
        item.put("lastLoginTime", safe(user.getLastLoginTime()));
        item.put("role", roleFromNickname(user.getNickname()));
        return item;
    }

    /** 演示数据没有独立角色字段，按约定昵称推断，与内置账号一致。 */
    private static String roleFromNickname(String nickname) {
        if ("demo".equalsIgnoreCase(nickname)) {
            return "管理员";
        }
        if ("exhibitor".equalsIgnoreCase(nickname)) {
            return "展商";
        }
        return "普通用户";
    }

    private static Map<String, Object> findUser(String id) {
        AdminUser user = AdminUserManager.findById(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (user == null) {
            result.put("found", false);
            result.put("error", "用户不存在");
            return result;
        }
        result.put("found", true);
        result.put("user", adminUserPayload(user));
        return result;
    }

    private static AdminUser findUserByNickname(String nickname) {
        if (nickname == null || nickname.isEmpty()) {
            return null;
        }
        for (AdminUser user : AdminUserManager.listAll()) {
            if (user.getNickname() != null && user.getNickname().equalsIgnoreCase(nickname)) {
                return user;
            }
        }
        return null;
    }

    private static Map<String, Object> publicProfile(Activity activity, Map<String, Object> payload) {
        String nickname = WebAppBridge.text(payload, "nickname", "");
        String userId = WebAppBridge.text(payload, "userId", "");
        AdminUser user = userId.isEmpty() ? findUserByNickname(nickname) : AdminUserManager.findById(userId);
        Map<String, Object> profile = new LinkedHashMap<>();
        if (user == null) {
            profile.put("found", false);
            profile.put("error", "用户不存在或未公开");
            return profile;
        }
        UserProfileStore.Profile stored = UserProfileStore.get(activity, user.getNickname());
        profile.put("found", true);
        profile.put("nickname", safe(user.getNickname()));
        profile.put("role", roleFromNickname(user.getNickname()));
        profile.put("bio", stored == null ? "" : stored.bio);
        profile.put("region", stored == null ? "" : stored.region);
        profile.put("avatar", stored == null ? "" : stored.avatar);
        profile.put("socialMedia", stored == null ? "" : stored.socialMedia);
        profile.put("showRegistrations", stored != null && stored.showRegistrations);

        List<Map<String, Object>> registrations = new ArrayList<>();
        if (stored != null && stored.showRegistrations) {
            for (Map<String, Object> registration : myRegistrations(activity)) {
                if (safe(user.getNickname()).equals(registration.get("visitorName"))) {
                    registrations.add(registration);
                }
            }
        }
        profile.put("registrations", registrations);
        return profile;
    }

    // ── 搜索 ───────────────────────────────────────────────────

    private static Map<String, Object> search(Activity activity, String query) {
        List<Map<String, Object>> exhibitions = new ArrayList<>();
        List<Map<String, Object>> people = new ArrayList<>();
        if (!query.trim().isEmpty()) {
            for (ExhibitorExhibition exhibition : ExhibitionManager.search(query)) {
                exhibitions.add(exhibitionPayload(activity, exhibition));
            }
            for (AdminUser user : AdminUserManager.search(query)) {
                people.add(adminUserPayload(user));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("query", query);
        result.put("exhibitions", exhibitions);
        result.put("users", people);
        result.put("count", exhibitions.size() + people.size());
        return result;
    }

    // ── 系统设置 ───────────────────────────────────────────────

    private static Map<String, Object> settings(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("theme", themePayload(activity));
        data.put("announcement", announcement(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", reviewPolicy(activity));
        data.put("media", mediaLimits(activity));
        data.put("upload", serverSettings(activity));
        data.put("limits", textLimits(activity));
        data.put("notify", notificationPreferences(activity));
        return data;
    }

    private static Map<String, Object> saveSettings(Activity activity, Map<String, Object> payload) {
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
        AppSettings.saveMediaLimits(activity,
                WebAppBridge.number(payload, "imageCount", AppSettings.getMediaImageLimit(activity)),
                WebAppBridge.number(payload, "imageSizeMb", AppSettings.getMediaImageSizeMb(activity)),
                WebAppBridge.number(payload, "videoCount", AppSettings.getMediaVideoLimit(activity)));
        AppSettings.saveUploadLimits(activity,
                WebAppBridge.number(payload, "avatarSizeMb", AppSettings.getMediaAvatarSizeMb(activity)),
                WebAppBridge.text(payload, "imageFormats", ""),
                WebAppBridge.text(payload, "videoFormats", ""));
        AppSettings.saveTextLimits(activity, new int[] {
                WebAppBridge.number(payload, "exhibitionTitle", 0),
                WebAppBridge.number(payload, "exhibitionVenue", 0),
                WebAppBridge.number(payload, "category", 0),
                WebAppBridge.number(payload, "fieldTitle", 0),
                WebAppBridge.number(payload, "usernameMin", 0),
                WebAppBridge.number(payload, "usernameMax", 0),
                WebAppBridge.number(payload, "passwordMin", 0),
                WebAppBridge.number(payload, "passwordMax", 0),
                WebAppBridge.number(payload, "nickname", 0),
                WebAppBridge.number(payload, "bio", 0),
                WebAppBridge.number(payload, "region", 0),
                WebAppBridge.number(payload, "answer", 0),
        });
        if (payload.containsKey("notify")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> notify = payload.get("notify") instanceof Map
                    ? (Map<String, Object>) payload.get("notify")
                    : new LinkedHashMap<String, Object>();
            saveNotificationPreferences(activity, notify);
        }
        AppSettings.applyWindowColors(activity);

        result.put("ok", true);
        result.put("error", "");
        result.put("settings", settings(activity));
        return result;
    }

    // ── 系统日历 ───────────────────────────────────────────────

    private static Map<String, Object> calendarStatus(Activity activity, Map<String, Object> payload) {
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        data.put("inCalendar", !title.isEmpty() && CalendarHelper.isInCalendar(activity, title, day));
        return data;
    }

    /** 加入或移出系统日历；缺少权限时先申请，授权后继续执行。 */
    private static void toggleCalendar(WebAppBridge bridge, Map<String, Object> payload,
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

    private static Map<String, Object> applyCalendarChange(Activity activity, Map<String, Object> payload,
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

    // ── 媒体与分享 ─────────────────────────────────────────────

    private static void pickFile(WebAppBridge bridge, String mimeType, String chooserTitle,
            WebAppBridge.ResultCallback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        bridge.startForResult(Intent.createChooser(intent, chooserTitle), bridge.nextRequestCode(),
                new WebAppBridge.PendingResult("media.pick", callback));
    }

    /** 读取图片并转成 data URL，供 WebView 直接展示系统选择器返回的图片。 */
    private static String imageData(Context context, String uri) {
        if (uri == null || uri.isEmpty() || context == null) {
            return "";
        }
        try (InputStream input = context.getContentResolver().openInputStream(Uri.parse(uri))) {
            if (input == null) {
                return "";
            }
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            if (bitmap == null) {
                return "";
            }
            int max = 1080;
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            if (width > max || height > max) {
                float ratio = Math.min(max / (float) width, max / (float) height);
                bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio),
                        Math.round(height * ratio), true);
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output);
            return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } catch (Exception error) {
            Log.w(TAG, "图片读取失败: " + uri, error);
            return "";
        }
    }

    // ── 上传文件落盘（长简介与头像统一改用短 URL 引用） ──────────

    /** 打开系统选择器并直接把所选文件存进应用私有目录，返回可引用的 URL。 */
    private static void importMedia(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String kind = WebAppBridge.text(payload, "kind", "image");
        boolean video = "video".equals(kind);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(video ? "video/*" : "image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("media.import", callback);
        pending.context.put("kind", kind);
        pending.context.put("avatar", Boolean.valueOf("avatar".equals(kind)));
        bridge.startForResult(Intent.createChooser(intent, video ? "选择视频" : "选择图片"),
                bridge.nextRequestCode(), pending);
    }

    /** 把前端裁剪好的 data URL 落盘，返回短 URL。 */
    private static Map<String, Object> storeDataUrl(Context context, Map<String, Object> payload) {
        String dataUrl = WebAppBridge.text(payload, "dataUrl", "");
        String kind = WebAppBridge.text(payload, "kind", "image");
        Map<String, Object> result = new LinkedHashMap<>();
        java.util.regex.Matcher matcher = DATA_URL.matcher(dataUrl);
        if (!matcher.matches()) {
            result.put("ok", false);
            result.put("error", "无法识别的图片数据");
            return result;
        }
        String mime = matcher.group(1).toLowerCase(java.util.Locale.US);
        String extension = mime.contains("png") ? "png" : "jpg";
        boolean avatar = "avatar".equals(kind);
        List<String> formats = imageFormatsFor(context, kind);
        boolean allowedFormat = formats.contains(extension)
                || ("jpg".equals(extension) && formats.contains("jpeg"));
        if (!allowedFormat) {
            result.put("ok", false);
            result.put("error", "服务器设置不允许上传 ." + extension + " 格式，允许："
                    + String.join("、", formats));
            return result;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(matcher.group(2), Base64.DEFAULT);
        } catch (Exception error) {
            result.put("ok", false);
            result.put("error", "图片数据解析失败");
            return result;
        }
        int limitMb = avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context);
        if (bytes.length > limitMb * 1024L * 1024L) {
            result.put("ok", false);
            result.put("error", (avatar ? "头像" : "图片") + "超过 " + limitMb + " MB 限制");
            return result;
        }
        String fileName = nextFileName(context, avatar ? "avatar" : "image", extension);
        if (!writeFile(context, fileName, bytes)) {
            result.put("ok", false);
            result.put("error", "文件写入失败");
            return result;
        }
        result.put("ok", true);
        result.put("error", "");
        result.put("url", WebShellActivity.MEDIA_URL + fileName);
        result.put("bytes", bytes.length);
        result.put("fileName", fileName);
        return result;
    }

    private static List<String> imageFormatsFor(Context context, String kind) {
        return AppSettings.getImageFormats(context);
    }

    /** 所选文件按格式与大小限制落盘；图片过大时先等比缩放再写 JPEG。 */
    private static Map<String, Object> storeUri(Context context, Uri uri, boolean avatar) {
        Map<String, Object> result = new LinkedHashMap<>();
        String mime = context.getContentResolver().getType(uri);
        boolean video = mime != null && mime.startsWith("video/");
        List<String> formats = video ? AppSettings.getVideoFormats(context)
                : AppSettings.getImageFormats(context);
        String extension = extensionOf(context, uri, mime);
        if (extension.isEmpty() || !formats.contains(extension)) {
            result.put("ok", false);
            result.put("error", "服务器设置不允许上传 ." + (extension.isEmpty() ? "未知" : extension)
                    + " 格式，允许：" + String.join("、", formats));
            return result;
        }
        int limitMb = video ? 0 : (avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context));
        try {
            if (video) {
                String fileName = nextFileName(context, "video", extension);
                long bytes = copyToFile(context, uri, fileName);
                if (bytes <= 0) {
                    result.put("ok", false);
                    result.put("error", "视频读取失败");
                    return result;
                }
                result.put("ok", true);
                result.put("error", "");
                result.put("url", WebShellActivity.MEDIA_URL + fileName);
                result.put("mimeType", mime == null ? "" : mime);
                result.put("bytes", bytes);
                result.put("fileName", fileName);
                return result;
            }
            byte[] raw = readBytes(context, uri);
            if (raw == null || raw.length == 0) {
                result.put("ok", false);
                result.put("error", "图片读取失败");
                return result;
            }
            boolean small = raw.length <= limitMb * 1024L * 1024L;
            Bitmap bitmap = small ? null : decodeScaled(raw, avatar ? 640 : 1920);
            if (bitmap == null) {
                // 未超限或无法解码时保持原文件，保留 GIF/PNG 等格式的原始数据。
                String fileName = nextFileName(context, avatar ? "avatar" : "image", extension);
                if (!writeFile(context, fileName, raw)) {
                    result.put("ok", false);
                    result.put("error", "文件写入失败");
                    return result;
                }
                result.put("ok", true);
                result.put("error", "");
                result.put("url", WebShellActivity.MEDIA_URL + fileName);
                result.put("mimeType", mime == null ? "" : mime);
                result.put("bytes", raw.length);
                result.put("fileName", fileName);
                return result;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 86, output);
            byte[] compressed = output.toByteArray();
            String fileName = nextFileName(context, avatar ? "avatar" : "image", "jpg");
            if (!writeFile(context, fileName, compressed)) {
                result.put("ok", false);
                result.put("error", "文件写入失败");
                return result;
            }
            result.put("ok", true);
            result.put("error", "");
            result.put("url", WebShellActivity.MEDIA_URL + fileName);
            result.put("mimeType", "image/jpeg");
            result.put("bytes", compressed.length);
            result.put("fileName", fileName);
            result.put("compressed", true);
            return result;
        } catch (Exception error) {
            Log.w(TAG, "上传文件处理失败: " + uri, error);
            result.put("ok", false);
            result.put("error", "上传失败：" + error.getMessage());
            return result;
        }
    }

    private static final java.util.regex.Pattern DATA_URL = java.util.regex.Pattern.compile(
            "^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\\s]+)$",
            java.util.regex.Pattern.DOTALL);

    private static final java.util.regex.Pattern INLINE_IMAGE = java.util.regex.Pattern.compile(
            "data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+");

    private static final java.util.concurrent.atomic.AtomicInteger FILE_SEQUENCE =
            new java.util.concurrent.atomic.AtomicInteger(1);

    /**
     * 把简介里的内联 base64 图片改写成落盘后的短 URL。
     * <p>
     * 历史内容与外部粘贴的 Markdown 都可能带内联图片，保存时统一转换，
     * 长简介因此不再因为 base64 体积过大而拖慢编辑器与详情页。
     */
    static String inlineDataUrlsToFiles(Context context, String description) {
        if (description == null || !description.contains("data:image/")) {
            return description;
        }
        java.util.regex.Matcher matcher = INLINE_IMAGE.matcher(description);
        StringBuilder builder = new StringBuilder();
        int count = 0;
        while (matcher.find()) {
            String dataUrl = matcher.group();
            java.util.regex.Matcher parts = DATA_URL.matcher(dataUrl);
            if (!parts.matches()) {
                continue;
            }
            byte[] bytes;
            try {
                bytes = Base64.decode(parts.group(2), Base64.DEFAULT);
            } catch (Exception error) {
                continue;
            }
            int maxBytes = AppSettings.getMediaImageSizeMb(context) * 1024 * 1024;
            String extension = parts.group(1).contains("png") ? "png" : "jpg";
            byte[] payload = bytes;
            String usedExtension = extension;
            if (bytes.length > maxBytes) {
                Bitmap bitmap = decodeScaled(bytes, 1920);
                if (bitmap != null) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 86, output);
                    payload = output.toByteArray();
                    usedExtension = "jpg";
                }
            }
            String fileName = nextFileName(context, "desc", usedExtension);
            if (!writeFile(context, fileName, payload)) {
                continue;
            }
            matcher.appendReplacement(builder,
                    java.util.regex.Matcher.quoteReplacement(WebShellActivity.MEDIA_URL + fileName));
            count += 1;
        }
        matcher.appendTail(builder);
        if (count > 0) {
            Log.d(TAG, "简介内联图片已改写为本地 URL，共 " + count + " 张");
        }
        return builder.toString();
    }

    private static String nextFileName(Context context, String prefix, String extension) {
        String safePrefix = prefix == null || prefix.isEmpty() ? "file" : prefix;
        return safePrefix + "-" + System.currentTimeMillis() + "-" + FILE_SEQUENCE.getAndIncrement()
                + "." + extension;
    }

    private static boolean writeFile(Context context, String fileName, byte[] bytes) {
        try (java.io.FileOutputStream output =
                     new java.io.FileOutputStream(new java.io.File(WebShellActivity.mediaDir(context), fileName))) {
            output.write(bytes);
            output.flush();
            return true;
        } catch (Exception error) {
            Log.w(TAG, "文件写入失败: " + fileName, error);
            return false;
        }
    }

    private static long copyToFile(Context context, Uri uri, String fileName) throws Exception {
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             java.io.FileOutputStream output =
                     new java.io.FileOutputStream(new java.io.File(WebShellActivity.mediaDir(context), fileName))) {
            if (input == null) {
                return -1;
            }
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
                total += read;
            }
            output.flush();
            return total;
        }
    }

    private static byte[] readBytes(Context context, Uri uri) {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) {
                return null;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } catch (Exception error) {
            Log.w(TAG, "文件读取失败: " + uri, error);
            return null;
        }
    }

    /** 按长边上限等比缩小解码，避免超大图片直接进入内存。 */
    private static Bitmap decodeScaled(byte[] bytes, int maxSide) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) {
            return null;
        }
        int longSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (longSide <= maxSide) {
            return bitmap;
        }
        float ratio = maxSide / (float) longSide;
        return Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)),
                Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
    }

    /** 从 Uri 推断后缀：优先取显示名，其次按 MIME 映射。 */
    private static String extensionOf(Context context, Uri uri, String mime) {
        String name = null;
        try (android.database.Cursor cursor = context.getContentResolver()
                .query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    name = cursor.getString(index);
                }
            }
        } catch (Exception ignored) {
            // 查询失败时退回 MIME 推断
        }
        if (name != null && name.contains(".")) {
            return name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.US);
        }
        if (mime == null) {
            return "";
        }
        String lower = mime.toLowerCase(java.util.Locale.US);
        if (lower.startsWith("image/")) {
            String subtype = lower.substring("image/".length());
            return "jpeg".equals(subtype) ? "jpg" : subtype;
        }
        if (lower.startsWith("video/")) {
            String subtype = lower.substring("video/".length());
            if ("quicktime".equals(subtype)) {
                return "mov";
            }
            return subtype;
        }
        return "";
    }

    private static void shareText(Activity activity, Map<String, Object> payload) {        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_SUBJECT, WebAppBridge.text(payload, "title", ""));
        share.putExtra(Intent.EXTRA_TEXT, WebAppBridge.text(payload, "text", ""));
        activity.startActivity(Intent.createChooser(share, "分享展会"));
    }

    /** 导出 CSV：交给系统文件选择器写入，避免依赖存储权限。 */
    private static void exportCsv(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String type = WebAppBridge.text(payload, "type", "exhibitions");
        String csv;
        String fileName;
        if ("registrations".equals(type)) {
            csv = ExportManager.exportRegistrations(bridge.activity());
            fileName = "calmobile-registrations.csv";
        } else if ("users".equals(type)) {
            csv = ExportManager.exportUsers(bridge.activity());
            fileName = "calmobile-users.csv";
        } else {
            csv = ExportManager.exportExhibitions(bridge.activity());
            fileName = "calmobile-exhibitions.csv";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending = new WebAppBridge.PendingResult("export.csv", callback);
        pending.context.put("csv", csv);
        pending.context.put("fileName", fileName);
        bridge.startForResult(intent, requestCode, pending);
    }

    private static void toast(Activity activity, String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_SHORT).show();
    }

    // ── 系统界面与权限回调 ─────────────────────────────────────

    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        Activity activity = bridge.activity();
        if (pending.context.containsKey("csv")) {
            writeCsv(activity, pending, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消选择");
            return;
        }
        Uri uri = data.getData();
        if ("media.import".equals(pending.action)) {
            Map<String, Object> stored = storeUri(activity, uri, Boolean.TRUE.equals(pending.context.get("avatar")));
            if (Boolean.TRUE.equals(stored.get("ok"))) {
                pending.callback.success(stored);
            } else {
                pending.callback.failure(String.valueOf(stored.get("error")));
            }
            return;
        }
        String mime = activity.getContentResolver().getType(uri);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("uri", uri.toString());
        result.put("mimeType", mime == null ? "" : mime);
        result.put("dataUrl", mime != null && mime.startsWith("image/")
                ? imageData(activity, uri.toString()) : "");
        pending.callback.success(result);
    }

    private static void writeCsv(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消导出");
            return;
        }
        String csv = String.valueOf(pending.context.get("csv"));
        try (java.io.OutputStream output =
                     activity.getContentResolver().openOutputStream(data.getData())) {
            if (output == null) {
                pending.callback.failure("无法写入所选文件");
                return;
            }
            output.write(csv.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception error) {
            pending.callback.failure("导出失败：" + error.getMessage());
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fileName", String.valueOf(pending.context.get("fileName")));
        result.put("rows", Math.max(0, csv.split("\n").length - 1));
        pending.callback.success(result);
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
    }

    // ── 工具方法 ───────────────────────────────────────────────

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    /** 报名方式：线框的“需审核 / 无需审核 / 仅展示”与现有状态字段的映射。 */
    static String registrationMode(String status) {
        if (ExhibitorExhibition.STATUS_DISPLAY_ONLY.equals(status)) {
            return "display";
        }
        if (ExhibitorExhibition.STATUS_CLOSED.equals(status)) {
            return "closed";
        }
        if (ExhibitorExhibition.STATUS_ENDED.equals(status)) {
            return "ended";
        }
        return "review";
    }

    static String modeLabel(String status) {
        switch (registrationMode(status)) {
            case "display":
                return "仅展示";
            case "closed":
                return "截止报名";
            case "ended":
                return "已结束";
            default:
                return ExhibitorExhibition.STATUS_REVIEW_OPTIONAL.equals(status)
                        ? "报名中 · 无需审核" : "报名中 · 需审核";
        }
    }

    private static int yearOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(0, 4));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static int monthOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(5, 7));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static int dayOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(8, 10));
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
